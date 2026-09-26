// Mirrors src/leadforge/pipeline/discovery.py: Socrata → Google Places → dedup → score → persist.
//
// Two deliberate divergences from Python, both ADR 030. Identity is the city's licence account, so
// dedup happens before anything billable rather than out of the lookup response; and the Find Place
// answer must corroborate the licence name before the Details call is paid for, because Google
// returns the nearest candidate whatever its name.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDiscovery, type DiscoveryEnv } from '../src/lib/discovery';
import { newPlacesHealth } from '../src/scrapers/google-places';
import { accessToken, adminUser, api, createBusiness, jsonResponse, resetDb, stubFetch, viewerUser } from './helpers';

afterEach(() => vi.unstubAllGlobals());
beforeEach(async () => {
  await resetDb();
});

const SOCRATA_ROW = {
  account_number: '478849',
  site_number: '1',
  latitude: '41.7514067334',
  longitude: '-87.6043524136',
  legal_name: 'JOHNS BARBERSHOP INC',
  doing_business_as_name: "John's Barbershop",
  address: '123 E 75TH ST',
  zip_code: '60619',
  license_number: '2874631',
  license_status: 'AAI',
  license_start_date: '2019-05-15T00:00:00.000',
  business_activity: 'Barber Shop',
};

// Find Place carries only the Basic fields — which is exactly enough to corroborate the name and
// apply the radius cut before paying for Details.
const FIND_PLACE = {
  status: 'OK',
  candidates: [
    {
      place_id: 'ChIJ_sample_place_id_123',
      name: "John's Barbershop",
      formatted_address: '123 E 75th St, Chicago, IL 60619',
      geometry: { location: { lat: 41.7515, lng: -87.6044 } },
    },
  ],
};

const DETAILS = {
  status: 'OK',
  result: {
    place_id: 'ChIJ_sample_place_id_123',
    name: "John's Barbershop",
    formatted_address: '123 E 75th St, Chicago, IL 60619',
    geometry: { location: { lat: 41.758, lng: -87.6055 } },
    formatted_phone_number: '(773) 555-1234',
    website: 'http://johnsbarbershop.com',
    rating: 4.5,
    user_ratings_total: 47,
    business_status: 'OPERATIONAL',
  },
};

const keyed: DiscoveryEnv = { DB: env.DB, GOOGLE_PLACES_API_KEY: 'TEST_KEY' };
const keyless: DiscoveryEnv = { DB: env.DB };

type Stub = unknown | (() => Response);
function routeGoogle(rows: unknown[] = [SOCRATA_ROW], find: Stub = FIND_PLACE, details: Stub = DETAILS) {
  const answer = (stub: Stub) => (typeof stub === 'function' ? (stub as () => Response)() : jsonResponse(stub));
  return stubFetch((url) => {
    if (url.startsWith('https://data.cityofchicago.org')) return jsonResponse(rows);
    if (url.includes('/place/findplacefromtext/json')) return answer(find);
    if (url.includes('/place/details/json')) return answer(details);
    throw new Error(`unrouted request: ${url}`);
  });
}

const findCalls = (calls: string[]) => calls.filter((u) => u.includes('findplacefromtext'));
const detailCalls = (calls: string[]) => calls.filter((u) => u.includes('/place/details/'));

const businessRow = (id: string) =>
  env.DB.prepare('SELECT * FROM businesses WHERE id = ?').bind(id).first<Record<string, unknown>>();

describe('runDiscovery', () => {
  it('persists the business, its digital presence and a first score', async () => {
    routeGoogle();
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(discovered).toHaveLength(1);

    const business = await businessRow(discovered[0].id);
    expect(business).toMatchObject({
      name: "John's Barbershop",
      address: '123 E 75th St, Chicago, IL 60619',
      zip_code: '60619',
      phone: '(773) 555-1234',
      niche: 'barbershops',
      license_number: '2874631',
      license_status: 'active',
      license_issue_date: '2019-05-15',
      // Identity, stored so the next run dedups before it pays for a lookup
      account_number: '478849',
      site_number: '1',
      // An enrichment attribute now, not identity
      google_place_id: 'ChIJ_sample_place_id_123',
      // Socrata's own geocode wins over the Details fixture's 41.758/-87.6055
      latitude: 41.7514067334,
      longitude: -87.6043524136,
    });

    const presence = await env.DB.prepare('SELECT * FROM digital_presences WHERE business_id = ?')
      .bind(discovered[0].id)
      .first<Record<string, unknown>>();
    expect(presence).toMatchObject({
      has_website: 1,
      website_url: 'http://johnsbarbershop.com',
      has_google_business_profile: 1,
      google_review_count: 47,
      // Google rates 0.0-5.0 already, so unlike Foursquare's 0.0-10.0 nothing is halved here
      google_avg_rating: 4.5,
      // 0 means "Google does not report social presence", not "this shop has none" — see ADR 030
      has_facebook_page: 0,
      has_instagram: 0,
    });

    // website (0) + GBP (0) + 47 reviews (0) + no social signal (12) + no ads (7) = 19.
    // Foursquare scored this same business 7, because social_media made those flags real signal.
    // The 12 is the cost of the Google-only interval and it lands on every business equally.
    const score = await env.DB.prepare('SELECT * FROM lead_scores WHERE business_id = ?')
      .bind(discovered[0].id)
      .first<Record<string, unknown>>();
    expect(score).toMatchObject({
      score_version: 1,
      digital_deficit_score: 19,
      composite_acquisition_score: 19,
    });
  });

  it('charges the zero-review penalty only for a business it actually looked up', async () => {
    // Google omits user_ratings_total for a place with no reviews, and having called Details we know
    // that is a measurement rather than an absence — so +10 is earned here, unlike under Foursquare
    // where `stats` was never entitled and the term had to be skipped for everyone.
    routeGoogle([SOCRATA_ROW], FIND_PLACE, {
      status: 'OK',
      result: { place_id: 'ChIJ_sample_place_id_123', name: "John's Barbershop", website: 'http://x.com' },
    });

    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    const presence = await env.DB.prepare(
      'SELECT google_review_count, google_avg_rating FROM digital_presences WHERE business_id = ?',
    )
      .bind(discovered[0].id)
      .first();
    expect(presence).toEqual({ google_review_count: 0, google_avg_rating: null });
    // website (0) + GBP (0) + zero reviews (10) + no social (12) + no ads (7) = 29
    expect(discovered[0].digital_deficit_score).toBe(29);
  });
});

describe('corroboration before the Details call', () => {
  it('does not pay for Details when the nearest place is a different business', async () => {
    // The failure mode this prevents: Google answers a text query with whatever is closest, so a
    // law firm at the salon's address would otherwise have its website imported as the salon's and
    // flip the deficit's 30-point website term on another business's evidence.
    const calls = routeGoogle([SOCRATA_ROW], {
      status: 'OK',
      candidates: [
        {
          place_id: 'ChIJ_unrelated',
          name: 'Goldberg Weisman Cairo Law Offices',
          geometry: { location: { lat: 41.7515, lng: -87.6044 } },
        },
      ],
    });

    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);

    expect(findCalls(calls)).toHaveLength(1);
    expect(detailCalls(calls)).toHaveLength(0);
    const business = await businessRow(discovered[0].id);
    expect(business).toMatchObject({ google_place_id: null, name: "John's Barbershop" });
    // Scored as a genuine no-match: website (30) + GBP (15) + no social (12) + no ads (7) = 64
    expect(discovered[0].digital_deficit_score).toBe(64);
  });

  it('does not pay for Details when the candidate is outside the radius', async () => {
    // locationbias is a bias, not a filter: Google answers outside the circle rather than returning
    // nothing, so the cut has to be enforced here. This candidate carries the right name but sits
    // in the Loop, ~15 km from the licence address.
    const calls = routeGoogle([SOCRATA_ROW], {
      status: 'OK',
      candidates: [
        {
          place_id: 'ChIJ_far_away',
          name: "John's Barbershop",
          geometry: { location: { lat: 41.8789, lng: -87.6359 } },
        },
      ],
    });

    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);

    expect(detailCalls(calls)).toHaveLength(0);
    expect(discovered[0].digital_deficit_score).toBe(64);
  });

  it('accepts a candidate whose name carries extra words', async () => {
    const calls = routeGoogle([SOCRATA_ROW], {
      status: 'OK',
      candidates: [
        {
          place_id: 'ChIJ_sample_place_id_123',
          name: "John's Barbershop and Beauty Supply",
          geometry: { location: { lat: 41.7515, lng: -87.6044 } },
        },
      ],
    });

    await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(detailCalls(calls)).toHaveLength(1);
  });

  it('sends the licence coordinates as a location bias', async () => {
    const calls = routeGoogle();
    await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(findCalls(calls)[0]).toContain('locationbias=circle%3A200%4041.7514067334%2C-87.6043524136');
  });

  it('still looks up a business the city failed to geocode', async () => {
    // ~8% of licence rows have no coordinates. Without them there is no bias to send and no distance
    // to check, so name corroboration carries the decision alone rather than the business being skipped.
    const calls = routeGoogle([{ ...SOCRATA_ROW, latitude: undefined, longitude: undefined }]);
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);

    expect(findCalls(calls)[0]).not.toContain('locationbias');
    expect(detailCalls(calls)).toHaveLength(1);
    expect(discovered[0].digital_deficit_score).toBe(19);
  });
});

describe('dedup on the licence account', () => {
  it('skips a business already stored under the same licence account', async () => {
    await env.DB.prepare(
      'INSERT INTO businesses (id, name, zip_code, niche, account_number, site_number) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), 'Existing', '60619', 'barbershops', '478849', '1')
      .run();
    routeGoogle();
    expect(await runDiscovery(keyed, '60619', 'barbershops', 5)).toHaveLength(0);
    const { count } = (await env.DB.prepare('SELECT COUNT(*) AS count FROM businesses').first<{ count: number }>())!;
    expect(count).toBe(1);
  });

  it('recognises the duplicate before spending a single Places call', async () => {
    // The point of moving identity off the place id. Under the old key the lookup had to be paid for
    // before the response could reveal that the business was already stored.
    await env.DB.prepare(
      'INSERT INTO businesses (id, name, zip_code, niche, account_number, site_number) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), 'Existing', '60619', 'barbershops', '478849', '1')
      .run();
    const calls = routeGoogle();
    await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(findCalls(calls)).toHaveLength(0);
    expect(detailCalls(calls)).toHaveLength(0);
  });

  it('dedups a business first stored without any place id, rather than duplicating it', async () => {
    // The trap ADR 030 exists to close. Dedup on a source id put a NULL in a UNIQUE index for every
    // business whose lookup missed, and NULLs stay distinct — so the next run inserted the business a
    // second time and nothing backfilled the first copy. The licence account is never NULL.
    routeGoogle();
    expect(await runDiscovery(keyless, '60619', 'barbershops', 5)).toHaveLength(1);
    expect(await runDiscovery(keyed, '60619', 'barbershops', 5)).toHaveLength(0);

    const rows = await env.DB.prepare('SELECT google_place_id FROM businesses WHERE name = ?')
      .bind("John's Barbershop")
      .all<{ google_place_id: string | null }>();
    expect(rows.results).toHaveLength(1);
    // Still unenriched: dedup protects identity, it does not backfill. lib/enrichment.ts has no
    // caller, so the first run's null place id persists until one exists.
    expect(rows.results[0].google_place_id).toBeNull();
  });

  it('falls back to name and zip when a licence carries no account number', async () => {
    await createBusiness({ name: "John's Barbershop", zip_code: '60619' });
    routeGoogle([{ ...SOCRATA_ROW, account_number: undefined }]);
    expect(await runDiscovery(keyed, '60619', 'barbershops', 5)).toHaveLength(0);
  });
});

describe('runDiscovery, unchanged behaviour', () => {
  it('stores no deficit at all for a business it never looked up', async () => {
    const calls = routeGoogle();
    const discovered = await runDiscovery(keyless, '60619', 'barbershops', 5);

    expect(findCalls(calls)).toHaveLength(0);
    // Scoring this 74 (see scoring.test.ts) would put a constant in lead_scores that looks like a
    // measurement, ranks nothing, and earns the business a NOF property-need bonus on no evidence.
    expect(discovered[0].digital_deficit_score).toBeNull();
    const score = await env.DB.prepare(
      'SELECT digital_deficit_score, composite_acquisition_score FROM lead_scores WHERE business_id = ?',
    )
      .bind(discovered[0].id)
      .first();
    expect(score).toEqual({ digital_deficit_score: null, composite_acquisition_score: null });

    const business = await businessRow(discovered[0].id);
    expect(business).toMatchObject({
      name: "John's Barbershop",
      address: '123 E 75TH ST',
      google_place_id: null,
      // Coordinates survive with no API key at all, because the city supplies them
      latitude: 41.7514067334,
      longitude: -87.6043524136,
    });
  });

  it('records corridor membership at ingest, which Python never did', async () => {
    routeGoogle();
    const discovered = await runDiscovery(keyless, '60619', 'barbershops', 5);

    expect(discovered[0].nof_corridor).toMatch(/corridor \d+$/);
    const business = await businessRow(discovered[0].id);
    expect(business).toMatchObject({ in_nof_corridor: 1, nof_corridor_name: discovered[0].nof_corridor });
  });

  it('leaves a business off-corridor when its coordinates are downtown', async () => {
    routeGoogle([{ ...SOCRATA_ROW, latitude: '41.8789', longitude: '-87.6359' }]);
    const discovered = await runDiscovery(keyless, '60619', 'barbershops', 5);

    expect(discovered[0].nof_corridor).toBeNull();
    const business = await businessRow(discovered[0].id);
    expect(business).toMatchObject({ in_nof_corridor: 0, nof_corridor_name: null });
  });

  it('collapses licence renewals so one storefront costs one lookup', async () => {
    const renewals = [
      { ...SOCRATA_ROW, license_number: '111', license_start_date: '2019-05-15T00:00:00.000', license_status: 'AAC' },
      { ...SOCRATA_ROW, license_number: '333', license_start_date: '2025-11-16T00:00:00.000', license_status: 'AAI' },
      { ...SOCRATA_ROW, license_number: '222', license_start_date: '2022-07-01T00:00:00.000', license_status: 'AAC' },
    ];
    const calls = routeGoogle(renewals);
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);

    expect(discovered).toHaveLength(1);
    expect(findCalls(calls)).toHaveLength(1);
    expect(detailCalls(calls)).toHaveLength(1);
    // The most recent licence describes the business today
    const business = await businessRow(discovered[0].id);
    expect(business).toMatchObject({ license_number: '333', license_status: 'active', license_issue_date: '2025-11-16' });
  });

  it('treats limit as a count of businesses rather than licence rows', async () => {
    const other = { ...SOCRATA_ROW, account_number: '999999', doing_business_as_name: 'Fresh Cuts', license_number: '2987654' };
    routeGoogle([SOCRATA_ROW, SOCRATA_ROW, SOCRATA_ROW, SOCRATA_ROW, SOCRATA_ROW, other]);
    const discovered = await runDiscovery(keyless, '60619', 'barbershops', 2);
    expect(discovered.map((b) => b.name).sort()).toEqual(['Fresh Cuts', "John's Barbershop"]);
  });

  // A body that claims to be JSON and is not: response.json() throws inside fetchJson. A 200 with
  // an HTML body passes assertOk and only fails at JSON parsing, so it carries no HTTP status to
  // recover and takes the TRANSPORT_ERROR fallback rather than an HTTP_<status> label.
  // This test previously asserted that the business whose lookup broke vanished from the run
  // entirely -- the exact silent-drop bug this task removes -- rather than being stored unmeasured.
  it('stores a business whose lookup broke rather than dropping it, and keeps going', async () => {
    const second = { ...SOCRATA_ROW, account_number: '999999', doing_business_as_name: 'Fresh Cuts', license_number: '2987654' };
    stubFetch((url) => {
      if (url.startsWith('https://data.cityofchicago.org')) return jsonResponse([SOCRATA_ROW, second]);
      // A body that claims to be JSON and is not: response.json() throws inside the client
      if (url.includes('John')) return new Response('<html>gateway</html>', { status: 200 });
      if (url.includes('/place/findplacefromtext/json')) return jsonResponse({ status: 'ZERO_RESULTS', candidates: [] });
      throw new Error(`unrouted request: ${url}`);
    });

    const health = newPlacesHealth();
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5, health);

    expect(discovered.map((b) => b.name).sort()).toEqual(['Fresh Cuts', "John's Barbershop"]);
    expect(discovered.find((b) => b.name === "John's Barbershop")?.digital_deficit_score).toBeNull();
    // website (30) + GBP (15) + reviews SKIPPED + no social (12) + no ads (7) = 64
    expect(discovered.find((b) => b.name === 'Fresh Cuts')?.digital_deficit_score).toBe(64);
    expect(health).toEqual({ unavailable: 1, last_status: 'TRANSPORT_ERROR' });
  });

  it('returns nothing when Socrata has no rows', async () => {
    routeGoogle([]);
    expect(await runDiscovery(keyed, '60619', 'barbershops', 5)).toEqual([]);
  });

  // Google answers a denied key, an exhausted quota and a malformed request with HTTP 200 plus a
  // `status` field, so nothing throws and the payload merely lacks its results key. Without the
  // status check every such reply would read as "no such business" and store a maximal deficit for a
  // shop that was never actually looked up. The tally is what tells an operator which happened.
  it('reports a denied key rather than passing off an unlooked-up business as researched', async () => {
    const health = newPlacesHealth();
    routeGoogle([SOCRATA_ROW], { status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.' });

    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5, health);

    expect(discovered[0].digital_deficit_score).toBeNull();
    expect(health).toEqual({ unavailable: 1, last_status: 'REQUEST_DENIED' });
  });

  it('reports an exhausted quota separately from a denied key', async () => {
    const health = newPlacesHealth();
    routeGoogle([SOCRATA_ROW], { status: 'OVER_QUERY_LIMIT' });

    await runDiscovery(keyed, '60619', 'barbershops', 5, health);

    expect(health).toEqual({ unavailable: 1, last_status: 'OVER_QUERY_LIMIT' });
  });

  it('reports a healthy run when Google answers every lookup', async () => {
    const health = newPlacesHealth();
    routeGoogle();

    await runDiscovery(keyed, '60619', 'barbershops', 5, health);

    expect(health).toEqual({ unavailable: 0, last_status: null });
  });

  // A shop Google genuinely does not list is a measurement, not an outage: the deficit is computed
  // from its absence rather than withheld.
  it('scores a business Google has no record of rather than leaving it unmeasured', async () => {
    const health = newPlacesHealth();
    routeGoogle([SOCRATA_ROW], { status: 'ZERO_RESULTS', candidates: [] });

    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5, health);

    expect(health).toEqual({ unavailable: 0, last_status: null });
    // website (30) + GBP (15) + reviews SKIPPED + no social (12) + no ads (7) = 64
    expect(discovered[0].digital_deficit_score).toBe(64);
  });
});

describe('composition with the precomputed Overture matches', () => {
  const overtureRow = async (over: Record<string, unknown> = {}) => {
    const row = {
      account_number: '478849', site_number: '1', matched: 1, website: null,
      has_facebook: 0, has_instagram: 0, phone: null, ...over,
    };
    await env.DB.prepare(
      `INSERT INTO overture_matches (account_number, site_number, matched, website,
         has_facebook, has_instagram, phone, built_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-25T00:00:00Z')`,
    ).bind(row.account_number, row.site_number, row.matched, row.website,
           row.has_facebook, row.has_instagram, row.phone).run();
  };

  it('turns off the blanket social penalty when Overture has a social link', async () => {
    // Google reports no social presence at all, so before this every business paid
    // computeDigitalDeficit's +12 alike. 19 - 12 = 7.
    await overtureRow({ has_facebook: 1 });
    routeGoogle();
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(discovered[0].digital_deficit_score).toBe(7);

    const presence = await env.DB.prepare(
      'SELECT has_facebook_page, has_instagram FROM digital_presences WHERE business_id = ?',
    ).bind(discovered[0].id).first();
    expect(presence).toEqual({ has_facebook_page: 1, has_instagram: 0 });
  });

  it('credits a website Google missed', async () => {
    // Google finds no website here; Overture does. 64 - 30 (website) = 34.
    await overtureRow({ website: 'http://overture-found.com' });
    routeGoogle([SOCRATA_ROW], { status: 'ZERO_RESULTS', candidates: [] });
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(discovered[0].digital_deficit_score).toBe(34);

    const presence = await env.DB.prepare(
      'SELECT has_website, website_url FROM digital_presences WHERE business_id = ?',
    ).bind(discovered[0].id).first();
    expect(presence).toEqual({ has_website: 1, website_url: 'http://overture-found.com' });
  });

  it('keeps Google as the only source of rating and review count', async () => {
    await overtureRow({ website: 'http://overture-found.com', has_instagram: 1 });
    routeGoogle();
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    const presence = await env.DB.prepare(
      'SELECT google_avg_rating, google_review_count, website_url FROM digital_presences WHERE business_id = ?',
    ).bind(discovered[0].id).first();
    // Google's live URL wins over Overture's; the rating is Google's because Overture has none.
    expect(presence).toEqual({
      google_avg_rating: 4.5, google_review_count: 47, website_url: 'http://johnsbarbershop.com',
    });
  });

  it('scores a business the build found no Overture match for exactly as before', async () => {
    await overtureRow({ matched: 0 });
    routeGoogle();
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(discovered[0].digital_deficit_score).toBe(19);
  });

  it('scores a business the build has not covered exactly as before', async () => {
    routeGoogle();
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(discovered[0].digital_deficit_score).toBe(19);
  });

  it('still withholds a deficit when the live lookup never happened', async () => {
    // Overture data must not make an unlooked-up business look researched: a null deficit means
    // "not measured", and an offline match is not a measurement of the live source.
    await overtureRow({ website: 'http://overture-found.com', has_facebook: 1 });
    const health = newPlacesHealth();
    routeGoogle([SOCRATA_ROW], { status: 'REQUEST_DENIED' });
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5, health);
    expect(discovered[0].digital_deficit_score).toBeNull();
    expect(health.unavailable).toBe(1);
  });
});

describe('POST /api/discovery/run', () => {
  it('rejects an anonymous request', async () => {
    const res = await api('POST', '/discovery/run', { json: { zip_code: '60619', niche: 'barbershops' } });
    expect(res.status).toBe(401);
  });

  it('rejects a viewer', async () => {
    const token = await accessToken(await viewerUser());
    const res = await api('POST', '/discovery/run', { token, json: { zip_code: '60619', niche: 'barbershops' } });
    expect(res.status).toBe(403);
  });

  it('rejects an unknown niche and a limit above the subrequest budget', async () => {
    const token = await accessToken(await adminUser());
    const bad = await api('POST', '/discovery/run', { token, json: { zip_code: '60619', niche: 'coffee' } });
    expect(bad.status).toBe(422);
    const tooMany = await api('POST', '/discovery/run', {
      token,
      json: { zip_code: '60619', niche: 'barbershops', limit: 50 },
    });
    expect(tooMany.status).toBe(422);
  });

  it('runs the pipeline for an admin and reports what it stored', async () => {
    const token = await accessToken(await adminUser());
    routeGoogle();
    const res = await api('POST', '/discovery/run', {
      token,
      json: { zip_code: '60619', niche: 'barbershops', limit: 5 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { discovered: number; limit: number; businesses: { name: string }[] };
    expect(body.discovered).toBe(1);
    expect(body.limit).toBe(5);
    expect(body.businesses[0].name).toBe("John's Barbershop");
  });

  // The Worker env under test has no GOOGLE_PLACES_API_KEY, which is also the deployed Worker's
  // state: the route must say so rather than return a 200 that looks like a successful run.
  it('tells the operator the lookups never happened instead of reporting a clean run', async () => {
    const token = await accessToken(await adminUser());
    routeGoogle();

    const res = await api('POST', '/discovery/run', {
      token,
      json: { zip_code: '60619', niche: 'barbershops', limit: 5 },
    });

    const body = (await res.json()) as { discovered: number; places: { unavailable: number; last_status: string } };
    expect(body.discovered).toBe(1);
    expect(body.places).toEqual({ unavailable: 1, last_status: 'KEY_NOT_SET' });
  });
});

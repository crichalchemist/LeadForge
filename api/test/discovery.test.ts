// Mirrors src/leadforge/pipeline/discovery.py: Socrata → Foursquare → dedup → score → persist.
// Python enriches from Google Places; Workers diverges because that account is dead indefinitely.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDiscovery, type DiscoveryEnv } from '../src/lib/discovery';
import { newFoursquareHealth } from '../src/scrapers/foursquare';
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

// One search response carries everything Google needed a second details call for.
const FSQ_SEARCH = {
  results: [
    {
      fsq_place_id: 'fsq_sample_place_id_123',
      name: "John's Barbershop",
      location: { formatted_address: '123 E 75th St, Chicago, IL 60619' },
      latitude: 41.758,
      longitude: -87.6055,
      tel: '(773) 555-1234',
      website: 'http://johnsbarbershop.com',
      rating: 9.0,
      stats: { total_ratings: 47 },
      social_media: { facebook_id: '1234567890' },
    },
  ],
};

const keyed: DiscoveryEnv = { DB: env.DB, FOURSQUARE_API_KEY: 'TEST_KEY' };
const keyless: DiscoveryEnv = { DB: env.DB };

function routeFoursquare(rows: unknown[] = [SOCRATA_ROW], fsq: unknown = FSQ_SEARCH) {
  return stubFetch((url) => {
    if (url.startsWith('https://data.cityofchicago.org')) return jsonResponse(rows);
    if (url.startsWith('https://places-api.foursquare.com')) {
      return typeof fsq === 'function' ? (fsq as () => Response)() : jsonResponse(fsq);
    }
    throw new Error(`unrouted request: ${url}`);
  });
}

const businessRow = (id: string) =>
  env.DB.prepare('SELECT * FROM businesses WHERE id = ?').bind(id).first<Record<string, unknown>>();

describe('runDiscovery', () => {
  it('persists the business, its digital presence and a first score', async () => {
    routeFoursquare();
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
      fsq_place_id: 'fsq_sample_place_id_123',
      // Socrata's own geocode wins over the Foursquare fixture's 41.758/-87.6055
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
      // Foursquare's 9.0 on a 0-10 scale, stored on the 0-5 scale the scorers read
      google_avg_rating: 4.5,
      has_facebook_page: 1,
      has_instagram: 0,
    });

    // website (0) + GBP (0) + 47 reviews (0) + has a Facebook page (0) + no ads (7) = 7.
    // The Google port scored this same business 19: it hardcoded both social flags to 0 and so
    // charged every business on earth the same 12-point social penalty.
    const score = await env.DB.prepare('SELECT * FROM lead_scores WHERE business_id = ?')
      .bind(discovered[0].id)
      .first<Record<string, unknown>>();
    expect(score).toMatchObject({
      score_version: 1,
      digital_deficit_score: 7,
      composite_acquisition_score: 7,
    });
  });

  // The free Foursquare plan returns 429 limit=0 for `stats`, so a real free-tier response has no
  // review count at all. Storing 0 would charge every business computeDigitalDeficit's +10 "zero
  // reviews" penalty — a constant, the same bug as the 74. Null makes the scorer skip the term.
  it('records no review count rather than zero when the plan cannot see reviews', async () => {
    routeFoursquare([SOCRATA_ROW], {
      results: [
        {
          fsq_place_id: 'fsq_free_plan',
          name: "John's Barbershop",
          location: { formatted_address: '123 E 75th St, Chicago, IL 60619' },
          website: 'http://johnsbarbershop.com',
          // no `stats`, no `rating`, no `social_media` — exactly what the entitled field set returns
        },
      ],
    });

    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);

    const presence = await env.DB.prepare(
      'SELECT google_review_count, google_avg_rating FROM digital_presences WHERE business_id = ?',
    )
      .bind(discovered[0].id)
      .first();
    expect(presence).toEqual({ google_review_count: null, google_avg_rating: null });

    // website (0) + GBP (0) + reviews SKIPPED + no social (12) + no ads (7) = 19.
    // A zero review count instead of null would make this 29.
    expect(discovered[0].digital_deficit_score).toBe(19);
  });

  it('skips a business already stored under the same fsq_place_id', async () => {
    await env.DB.prepare('INSERT INTO businesses (id, name, zip_code, niche, fsq_place_id) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), 'Existing', '60619', 'barbershops', 'fsq_sample_place_id_123')
      .run();
    routeFoursquare();
    expect(await runDiscovery(keyed, '60619', 'barbershops', 5)).toHaveLength(0);
    const { count } = (await env.DB.prepare('SELECT COUNT(*) AS count FROM businesses').first<{ count: number }>())!;
    expect(count).toBe(1);
  });

  it('falls back to name and zip dedup when Foursquare finds nothing', async () => {
    await createBusiness({ name: "John's Barbershop", zip_code: '60619' });
    routeFoursquare([SOCRATA_ROW], { results: [] });
    expect(await runDiscovery(keyed, '60619', 'barbershops', 5)).toHaveLength(0);
  });

  it('stores no deficit at all for a business it never looked up', async () => {
    const calls = routeFoursquare();
    const discovered = await runDiscovery(keyless, '60619', 'barbershops', 5);

    expect(calls.some((url) => url.includes('places-api.foursquare.com'))).toBe(false);
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
      fsq_place_id: null,
      // Coordinates survive with no API key at all, because the city supplies them
      latitude: 41.7514067334,
      longitude: -87.6043524136,
    });
  });

  it('records corridor membership at ingest, which Python never did', async () => {
    routeFoursquare();
    const discovered = await runDiscovery(keyless, '60619', 'barbershops', 5);

    // 41.7514/-87.6044 is the city's own geocode for this licence, and it falls on a corridor
    expect(discovered[0].nof_corridor).toMatch(/corridor \d+$/);
    const business = await businessRow(discovered[0].id);
    expect(business).toMatchObject({ in_nof_corridor: 1, nof_corridor_name: discovered[0].nof_corridor });
  });

  it('leaves a business off-corridor when its coordinates are downtown', async () => {
    routeFoursquare([{ ...SOCRATA_ROW, latitude: '41.8789', longitude: '-87.6359' }]);
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
    const calls = routeFoursquare(renewals);
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);

    expect(discovered).toHaveLength(1);
    // One subrequest per business, where the Google port cost two: find-place *and* details
    expect(calls.filter((url) => url.includes('places-api.foursquare.com'))).toHaveLength(1);
    // The most recent licence describes the business today
    const business = await businessRow(discovered[0].id);
    expect(business).toMatchObject({ license_number: '333', license_status: 'active', license_issue_date: '2025-11-16' });
  });

  it('treats limit as a count of businesses rather than licence rows', async () => {
    const other = {
      ...SOCRATA_ROW,
      account_number: '999999',
      doing_business_as_name: 'Fresh Cuts',
      license_number: '2987654',
    };
    // Six rows, two businesses; a limit of 2 must yield both rather than stopping inside the renewals
    routeFoursquare([SOCRATA_ROW, SOCRATA_ROW, SOCRATA_ROW, SOCRATA_ROW, SOCRATA_ROW, other]);
    const discovered = await runDiscovery(keyless, '60619', 'barbershops', 2);
    expect(discovered.map((b) => b.name).sort()).toEqual(['Fresh Cuts', "John's Barbershop"]);
  });

  it('keeps going when one business fails', async () => {
    // A distinct account number, or dedup would fold this into the row above
    const second = {
      ...SOCRATA_ROW,
      account_number: '999999',
      doing_business_as_name: 'Fresh Cuts',
      license_number: '2987654',
    };
    stubFetch((url) => {
      if (url.startsWith('https://data.cityofchicago.org')) return jsonResponse([SOCRATA_ROW, second]);
      // A body that claims to be JSON and is not: response.json() throws inside the client
      if (url.includes('John%27s')) return new Response('<html>gateway</html>', { status: 200 });
      if (url.startsWith('https://places-api.foursquare.com')) return jsonResponse({ results: [] });
      throw new Error(`unrouted request: ${url}`);
    });

    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(discovered.map((b) => b.name)).toEqual(['Fresh Cuts']);
  });

  it('returns nothing when Socrata has no rows', async () => {
    routeFoursquare([]);
    expect(await runDiscovery(keyed, '60619', 'barbershops', 5)).toEqual([]);
  });

  // A run against a revoked key stores exactly what a run against shops Foursquare has never heard
  // of stores. The tally is the only thing that tells an operator which of those two happened.
  it('reports a denied key rather than passing off an unlooked-up business as researched', async () => {
    const health = newFoursquareHealth();
    routeFoursquare([SOCRATA_ROW], () => jsonResponse({ message: 'invalid token' }, 401));

    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5, health);

    expect(discovered[0].digital_deficit_score).toBeNull();
    expect(health).toEqual({ unavailable: 1, last_status: 'UNAUTHORIZED' });
  });

  it('reports an exhausted quota separately from a denied key', async () => {
    const health = newFoursquareHealth();
    routeFoursquare([SOCRATA_ROW], () => jsonResponse({ message: 'rate limited' }, 429));

    await runDiscovery(keyed, '60619', 'barbershops', 5, health);

    expect(health).toEqual({ unavailable: 1, last_status: 'RATE_LIMITED' });
  });

  // Unlike Google, Foursquare fails with a real HTTP status. base.ts's fetchJson throws on those,
  // and the throw would unwind past the health tally into the per-business catch above — dropping
  // the business AND reporting a clean run. The client reads status itself so neither happens.
  it('stores a business the source could not answer for instead of dropping it', async () => {
    const health = newFoursquareHealth();
    routeFoursquare([SOCRATA_ROW], () => jsonResponse({ message: 'upstream down' }, 500));

    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5, health);

    expect(discovered).toHaveLength(1);
    expect(discovered[0].digital_deficit_score).toBeNull();
    expect(health).toEqual({ unavailable: 1, last_status: 'SERVER_ERROR' });
  });

  // Why a discovery run with a dead key must not be pointed at production: the rows it writes carry
  // a null fsq_place_id, and the next run dedups on that column, so it matches nothing and inserts
  // the business a second time. Nothing backfills the first copy — lib/enrichment.ts has no caller
  // — so the unmeasured row and the enriched row coexist.
  it('duplicates rather than backfills a business first stored without a key', async () => {
    routeFoursquare();
    expect(await runDiscovery(keyless, '60619', 'barbershops', 5)).toHaveLength(1);

    expect(await runDiscovery(keyed, '60619', 'barbershops', 5)).toHaveLength(1);

    const rows = await env.DB.prepare('SELECT fsq_place_id FROM businesses WHERE name = ?')
      .bind("John's Barbershop")
      .all<{ fsq_place_id: string | null }>();
    expect(rows.results.map((r) => r.fsq_place_id)).toEqual([null, 'fsq_sample_place_id_123']);
  });

  it('reports a healthy run when Foursquare answers every lookup', async () => {
    const health = newFoursquareHealth();
    routeFoursquare();

    await runDiscovery(keyed, '60619', 'barbershops', 5, health);

    expect(health).toEqual({ unavailable: 0, last_status: null });
  });

  // A shop Foursquare genuinely does not list is a measurement, not an outage: the deficit is
  // computed from its absence rather than withheld. 64, not 74: the review term is unobservable on
  // this plan for every business, so counting a no-match as "zero reviews" would hand unmatched
  // businesses +10 that matched ones can never receive — a bias from the entitlement, not the shop.
  it('scores a business Foursquare has no record of rather than leaving it unmeasured', async () => {
    const health = newFoursquareHealth();
    routeFoursquare([SOCRATA_ROW], { results: [] });

    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5, health);

    expect(health).toEqual({ unavailable: 0, last_status: null });
    expect(discovered[0].digital_deficit_score).toBe(64);
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
    routeFoursquare();
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

  // The Worker env under test has no FOURSQUARE_API_KEY, which is also the deployed Worker's state:
  // the route must say so rather than return a 200 that looks like a successful run.
  it('tells the operator the lookups never happened instead of reporting a clean run', async () => {
    const token = await accessToken(await adminUser());
    routeFoursquare();

    const res = await api('POST', '/discovery/run', {
      token,
      json: { zip_code: '60619', niche: 'barbershops', limit: 5 },
    });

    const body = (await res.json()) as { discovered: number; places: { unavailable: number; last_status: string } };
    expect(body.discovered).toBe(1);
    expect(body.places).toEqual({ unavailable: 1, last_status: 'KEY_NOT_SET' });
  });
});

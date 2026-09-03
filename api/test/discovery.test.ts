// Mirrors src/leadforge/pipeline/discovery.py: Socrata → Google Places → dedup → score → persist.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDiscovery, type DiscoveryEnv } from '../src/lib/discovery';
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

const FIND_PLACE = {
  candidates: [{ place_id: 'ChIJ_sample_place_id_123', name: "John's Barbershop" }],
  status: 'OK',
};

const PLACE_DETAILS = {
  result: {
    place_id: 'ChIJ_sample_place_id_123',
    name: "John's Barbershop",
    formatted_address: '123 E 75th St, Chicago, IL 60619',
    formatted_phone_number: '(773) 555-1234',
    website: 'http://johnsbarbershop.com',
    rating: 4.5,
    user_ratings_total: 47,
    geometry: { location: { lat: 41.758, lng: -87.6055 } },
  },
  status: 'OK',
};

const keyed: DiscoveryEnv = { DB: env.DB, GOOGLE_PLACES_API_KEY: 'TEST_KEY' };
const keyless: DiscoveryEnv = { DB: env.DB };

function routeGoogle(rows: unknown[] = [SOCRATA_ROW], findPlace: unknown = FIND_PLACE) {
  return stubFetch((url) => {
    if (url.startsWith('https://data.cityofchicago.org')) return jsonResponse(rows);
    if (url.includes('findplacefromtext')) return jsonResponse(findPlace);
    if (url.includes('place/details')) return jsonResponse(PLACE_DETAILS);
    throw new Error(`unrouted request: ${url}`);
  });
}

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
      google_place_id: 'ChIJ_sample_place_id_123',
      // Socrata's own geocode wins over the Places fixture's 41.758/-87.6055
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
      google_avg_rating: 4.5,
    });

    // website (0) + GBP (0) + 47 reviews (0) + no social (12) + no ads (7) = 19
    const score = await env.DB.prepare('SELECT * FROM lead_scores WHERE business_id = ?')
      .bind(discovered[0].id)
      .first<Record<string, unknown>>();
    expect(score).toMatchObject({
      score_version: 1,
      digital_deficit_score: 19,
      composite_acquisition_score: 19,
    });
  });

  it('skips a business already stored under the same google_place_id', async () => {
    await env.DB.prepare(
      'INSERT INTO businesses (id, name, zip_code, niche, google_place_id) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), 'Existing', '60619', 'barbershops', 'ChIJ_sample_place_id_123')
      .run();
    routeGoogle();
    expect(await runDiscovery(keyed, '60619', 'barbershops', 5)).toHaveLength(0);
    const { count } = (await env.DB.prepare('SELECT COUNT(*) AS count FROM businesses').first<{ count: number }>())!;
    expect(count).toBe(1);
  });

  it('falls back to name and zip dedup when Google finds nothing', async () => {
    await createBusiness({ name: "John's Barbershop", zip_code: '60619' });
    routeGoogle([SOCRATA_ROW], { candidates: [], status: 'ZERO_RESULTS' });
    expect(await runDiscovery(keyed, '60619', 'barbershops', 5)).toHaveLength(0);
  });

  it('runs without a Google key and records the deficit that missing data produces', async () => {
    const calls = routeGoogle();
    const discovered = await runDiscovery(keyless, '60619', 'barbershops', 5);

    expect(calls.some((url) => url.includes('maps.googleapis.com'))).toBe(false);
    // no website (30) + no GBP (15) + zero reviews (10) + no social (12) + no ads (7) = 74,
    // every point of it from data the key would have supplied
    expect(discovered[0].digital_deficit_score).toBe(74);
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

    // 41.7514/-87.6044 is the city's own geocode for this licence, and it falls on a corridor
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

  it('collapses licence renewals so one storefront costs one Places lookup', async () => {
    const renewals = [
      { ...SOCRATA_ROW, license_number: '111', license_start_date: '2019-05-15T00:00:00.000', license_status: 'AAC' },
      { ...SOCRATA_ROW, license_number: '333', license_start_date: '2025-11-16T00:00:00.000', license_status: 'AAI' },
      { ...SOCRATA_ROW, license_number: '222', license_start_date: '2022-07-01T00:00:00.000', license_status: 'AAC' },
    ];
    const calls = routeGoogle(renewals);
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);

    expect(discovered).toHaveLength(1);
    expect(calls.filter((url) => url.includes('maps.googleapis.com'))).toHaveLength(2); // find + details, once
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
    routeGoogle([SOCRATA_ROW, SOCRATA_ROW, SOCRATA_ROW, SOCRATA_ROW, SOCRATA_ROW, other]);
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
      if (url.includes('John%27s')) return new Response('upstream down', { status: 500 });
      if (url.includes('findplacefromtext')) return jsonResponse({ candidates: [], status: 'ZERO_RESULTS' });
      throw new Error(`unrouted request: ${url}`);
    });

    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(discovered.map((b) => b.name)).toEqual(['Fresh Cuts']);
  });

  it('returns nothing when Socrata has no rows', async () => {
    routeGoogle([]);
    expect(await runDiscovery(keyed, '60619', 'barbershops', 5)).toEqual([]);
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
});

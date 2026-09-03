// Mirrors tests/unit/test_socrata.py and tests/unit/test_google_places.py, with the fixture
// payloads copied from tests/conftest.py.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchBusiness as angiSearch } from '../src/scrapers/angi';
import { getMetaAds } from '../src/scrapers/apify-meta';
import { getZipDemographics, safeFloat } from '../src/scrapers/census';
import { searchServices } from '../src/scrapers/craigslist';
import { checkDomain } from '../src/scrapers/domain';
import {
  extractEnrichment,
  findPlace,
  getPlaceDetails,
  type PlacesEnv,
} from '../src/scrapers/google-places';
import { searchBusiness as nextdoorSearch } from '../src/scrapers/nextdoor';
import { analyze } from '../src/scrapers/pagespeed';
import {
  dedupeLicenseRows,
  mapLicenseStatus,
  NICHE_MAPPING,
  normalizeResult,
  searchBusinesses,
  SOCRATA_PAGE_SIZE,
  type SocrataRow,
} from '../src/scrapers/socrata';
import { searchBusiness as thumbtackSearch } from '../src/scrapers/thumbtack';
import { searchBusiness as yelpSearch } from '../src/scrapers/yelp';
import { NICHES } from '../src/lib/stages';
import { jsonResponse, stubFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

// =py conftest.socrata_barbershop_response
const SOCRATA_BARBERSHOPS: SocrataRow[] = [
  {
    legal_name: 'JOHNS BARBERSHOP INC',
    doing_business_as_name: "John's Barbershop",
    address: '123 E 75TH ST',
    zip_code: '60619',
    license_number: '2874631',
    license_status: 'AAI',
    license_start_date: '2019-05-15T00:00:00.000',
    business_activity: 'Barber Shop',
  },
  {
    legal_name: 'FRESH CUTS LLC',
    doing_business_as_name: 'Fresh Cuts Barbershop',
    address: '456 S COTTAGE GROVE AVE',
    zip_code: '60619',
    license_number: '2987654',
    license_status: 'AAI',
    license_start_date: '2021-01-10T00:00:00.000',
    business_activity: 'Barber Shop',
  },
];

// =py conftest.google_find_place_response
const FIND_PLACE_RESPONSE = {
  candidates: [
    {
      place_id: 'ChIJ_sample_place_id_123',
      name: "John's Barbershop",
      formatted_address: '123 E 75th St, Chicago, IL 60619',
      geometry: { location: { lat: 41.758, lng: -87.6055 } },
    },
  ],
  status: 'OK',
};

// =py conftest.google_place_details_response
const PLACE_DETAILS_RESPONSE = {
  result: {
    place_id: 'ChIJ_sample_place_id_123',
    name: "John's Barbershop",
    formatted_address: '123 E 75th St, Chicago, IL 60619',
    formatted_phone_number: '(773) 555-1234',
    website: 'http://johnsbarbershop.com',
    rating: 4.5,
    user_ratings_total: 47,
    geometry: { location: { lat: 41.758, lng: -87.6055 } },
    business_status: 'OPERATIONAL',
  },
  status: 'OK',
};

describe('TestSocrataClient', () => {
  it('test_search_businesses_returns_results', async () => {
    stubFetch(() => jsonResponse(SOCRATA_BARBERSHOPS));
    const results = await searchBusinesses({}, '60619', 'barbershops');
    expect(results).toHaveLength(2);
    expect(results[0].doing_business_as_name).toBe("John's Barbershop");
  });

  it('test_search_businesses_with_limit', async () => {
    stubFetch(() => jsonResponse(SOCRATA_BARBERSHOPS));
    const results = await searchBusinesses({}, '60619', 'barbershops', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('test_search_businesses_empty_result', async () => {
    stubFetch(() => jsonResponse([]));
    expect(await searchBusinesses({}, '99999', 'barbershops')).toEqual([]);
  });

  it('parses the coordinates and identifiers the city supplies as text', () => {
    const normalized = normalizeResult(
      { ...SOCRATA_BARBERSHOPS[0], account_number: '478849', site_number: '1', latitude: '41.7514067334', longitude: '-87.6043524136' },
      'barbershops',
    );
    expect(normalized.latitude).toBe(41.7514067334);
    expect(normalized.longitude).toBe(-87.6043524136);
    expect(normalized.account_number).toBe('478849');
    // A row the city never geocoded yields null rather than NaN
    expect(normalizeResult(SOCRATA_BARBERSHOPS[0], 'barbershops').latitude).toBeNull();
  });

  it('collapses licence renewals onto the newest row per account and site', () => {
    const rows = [
      { ...SOCRATA_BARBERSHOPS[0], account_number: '1', site_number: '1', license_start_date: '2019-05-15T00:00:00.000' },
      { ...SOCRATA_BARBERSHOPS[0], account_number: '1', site_number: '1', license_start_date: '2025-11-16T00:00:00.000' },
      { ...SOCRATA_BARBERSHOPS[0], account_number: '1', site_number: '2', license_start_date: '2021-01-10T00:00:00.000' },
    ].map((row) => normalizeResult(row, 'barbershops'));

    const deduped = dedupeLicenseRows(rows);
    expect(deduped).toHaveLength(2); // two sites of one account survive
    expect(deduped[0].license_issue_date).toBe('2025-11-16T00:00:00.000');
  });

  it('falls back to name and zip when a row has no account number', () => {
    const rows = [SOCRATA_BARBERSHOPS[0], SOCRATA_BARBERSHOPS[0], SOCRATA_BARBERSHOPS[1]].map((row) =>
      normalizeResult(row, 'barbershops'),
    );
    expect(dedupeLicenseRows(rows)).toHaveLength(2);
  });

  it('test_normalize_result', () => {
    const normalized = normalizeResult(SOCRATA_BARBERSHOPS[0], 'barbershops');
    expect(normalized.name).toBe("John's Barbershop");
    expect(normalized.zip_code).toBe('60619');
    expect(normalized.niche).toBe('barbershops');
    expect(normalized.license_status).toBe('active'); // AAI means the license was issued
  });

  it('test_niche_mapping_covers_all_niches', () => {
    for (const niche of NICHES) expect(NICHE_MAPPING[niche]?.length).toBeGreaterThan(0);
  });

  it('test_license_status_mapping', () => {
    expect(mapLicenseStatus('AAI')).toBe('active');
    expect(mapLicenseStatus('ACTIVE')).toBe('active');
    expect(mapLicenseStatus('REV')).toBe('revoked');
    expect(mapLicenseStatus('REVOKED')).toBe('revoked');
    expect(mapLicenseStatus(null)).toBe('unknown');
    // Cancelled during its term; the enum has no closer value
    expect(mapLicenseStatus('AAC')).toBe('expired');
    expect(mapLicenseStatus('EXPIRED')).toBe('expired');
  });

  it('pages until a short page and advances the offset', async () => {
    const fullPage = Array.from({ length: SOCRATA_PAGE_SIZE }, () => SOCRATA_BARBERSHOPS[0]);
    let call = 0;
    const calls = stubFetch(() => jsonResponse(call++ === 0 ? fullPage : SOCRATA_BARBERSHOPS));
    const results = await searchBusinesses({}, '60619', 'barbershops');
    expect(results).toHaveLength(SOCRATA_PAGE_SIZE + 2);
    expect(calls[0]).toContain('%24offset=0');
    expect(calls[1]).toContain(`%24offset=${SOCRATA_PAGE_SIZE}`);
  });

  it('sends the app token only when one is configured', async () => {
    const withToken = stubFetch(() => jsonResponse([]));
    await searchBusinesses({ SOCRATA_APP_TOKEN: 'tok' }, '60619', 'barbershops');
    expect(withToken[0]).toContain('app_token=tok');

    const without = stubFetch(() => jsonResponse([]));
    await searchBusinesses({}, '60619', 'barbershops');
    expect(without[0]).not.toContain('app_token');
  });
});

describe('TestGooglePlacesClient', () => {
  const env: PlacesEnv = { GOOGLE_PLACES_API_KEY: 'TEST_KEY' };

  it('test_find_place_returns_candidate', async () => {
    stubFetch(() => jsonResponse(FIND_PLACE_RESPONSE));
    const result = await findPlace(env, "John's Barbershop", '123 E 75th St Chicago IL');
    expect(result?.place_id).toBe('ChIJ_sample_place_id_123');
  });

  it('test_find_place_no_results', async () => {
    stubFetch(() => jsonResponse({ candidates: [], status: 'ZERO_RESULTS' }));
    expect(await findPlace(env, 'Nonexistent Business', 'nowhere')).toBeNull();
  });

  it('test_get_place_details', async () => {
    stubFetch(() => jsonResponse(PLACE_DETAILS_RESPONSE));
    const result = await getPlaceDetails(env, 'ChIJ_sample_place_id_123');
    expect(result?.name).toBe("John's Barbershop");
    expect(result?.rating).toBe(4.5);
  });

  it('test_extract_enrichment', () => {
    const enrichment = extractEnrichment(PLACE_DETAILS_RESPONSE.result);
    expect(enrichment.google_place_id).toBe('ChIJ_sample_place_id_123');
    expect(enrichment.has_website).toBe(true);
    expect(enrichment.has_google_business_profile).toBe(true);
    expect(enrichment.google_review_count).toBe(47);
    expect(enrichment.google_avg_rating).toBe(4.5);
    expect(enrichment.latitude).toBe(41.758);
    expect(enrichment.longitude).toBe(-87.6055);
  });

  // Known-answer vector produced by running Python's _sign_url on the same inputs. Google rejects a
  // signature that differs by so much as its base64 padding, and no Python test covers this path.
  it('signs the request exactly as Python does', async () => {
    const calls = stubFetch(() => jsonResponse(FIND_PLACE_RESPONSE));
    await findPlace(
      { GOOGLE_PLACES_API_KEY: 'TEST_KEY', GOOGLE_PLACES_API_SECRET: 'aGVsbG8td29ybGQtc2VjcmV0LWtleS0xMjM=' },
      "John's Barbershop",
      '123 E 75th St, Chicago, IL 60619',
    );
    expect(calls[0]).toBe(
      'https://maps.googleapis.com/maps/api/place/findplacefromtext/json' +
        '?input=John%27s+Barbershop+123+E+75th+St%2C+Chicago%2C+IL+60619' +
        '&inputtype=textquery&fields=place_id%2Cname%2Cformatted_address%2Cgeometry' +
        '&key=TEST_KEY&signature=AbUMC_t56wmAahR3ZcoRnTyU-DY=',
    );
  });

  it('leaves the URL unsigned when no secret is configured', async () => {
    const calls = stubFetch(() => jsonResponse(FIND_PLACE_RESPONSE));
    await findPlace(env, 'Shop', 'Chicago');
    expect(calls[0]).not.toContain('signature=');
  });

  it('returns null without an API key instead of calling Google', async () => {
    const calls = stubFetch(() => jsonResponse(FIND_PLACE_RESPONSE));
    expect(await findPlace({}, 'Shop', 'Chicago')).toBeNull();
    expect(await getPlaceDetails({}, 'place')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('census', () => {
  const acsResponse = [
    ['NAME', 'B19013_001E', 'B01003_001E', 'B01001_001E', 'zip code tabulation area'],
    ['ZCTA5 60619', '38000', '25000', '25000', '60619'],
  ];

  it('reads median income and population for a zip', async () => {
    stubFetch(() => jsonResponse(acsResponse));
    const demographics = await getZipDemographics('60619');
    expect(demographics?.median_household_income).toBe(38000);
    expect(demographics?.total_population).toBe(25000);
    expect(demographics?.population_density).toBeNull();
  });

  it('returns null when the response has no data row', async () => {
    stubFetch(() => jsonResponse([['NAME']]));
    expect(await getZipDemographics('99999')).toBeNull();
  });

  it('returns null when the request fails', async () => {
    stubFetch(() => new Response('nope', { status: 500 }));
    expect(await getZipDemographics('60619')).toBeNull();
  });

  it('treats Census null markers and blanks as missing', () => {
    expect(safeFloat('-666666666')).toBeNull();
    expect(safeFloat('')).toBeNull();
    expect(safeFloat(null)).toBeNull();
    expect(safeFloat('not-a-number')).toBeNull();
    expect(safeFloat('0')).toBe(0);
  });
});

describe('pagespeed', () => {
  it('scales the Lighthouse performance score to 0-100', async () => {
    stubFetch(() =>
      jsonResponse({
        lighthouseResult: {
          categories: { performance: { score: 0.42 } },
          audits: { 'first-contentful-paint': { numericValue: 1800 } },
        },
      }),
    );
    const result = await analyze({}, 'https://example.com');
    expect(result?.website_quality_score).toBeCloseTo(42);
    expect(result?.first_contentful_paint).toBe(1800);
  });

  it('reads a null score as zero, as Python does', async () => {
    stubFetch(() => jsonResponse({ lighthouseResult: { categories: { performance: { score: null } } } }));
    const result = await analyze({}, 'https://example.com');
    expect(result?.website_quality_score).toBe(0);
  });

  it('returns null when the analysis fails', async () => {
    stubFetch(() => new Response('boom', { status: 500 }));
    expect(await analyze({}, 'https://example.com')).toBeNull();
  });

  it('sends the API key when one is configured', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    await analyze({ GOOGLE_PLACES_API_KEY: 'k' }, 'https://example.com');
    expect(calls[0]).toContain('key=k');
  });
});

describe('domain check', () => {
  it('reports SSL when the HTTPS request completes', async () => {
    const calls = stubFetch(() => new Response('', { status: 200 }));
    expect(await checkDomain('example.com')).toEqual({ has_ssl: true, domain: 'example.com', dns_resolves: true });
    expect(calls[0]).toBe('https://example.com');
  });

  it('still reports SSL for an HTTP error, since the handshake succeeded', async () => {
    stubFetch(() => new Response('forbidden', { status: 403 }));
    expect((await checkDomain('example.com')).has_ssl).toBe(true);
  });

  it('reports no SSL when the request throws', async () => {
    stubFetch(() => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    expect(await checkDomain('nope.invalid')).toEqual({ has_ssl: false, domain: 'nope.invalid', dns_resolves: false });
  });
});

describe('yelp', () => {
  it('returns null without an API key instead of calling Yelp', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    expect(await yelpSearch({}, 'Shop', 'Chicago')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('maps the first business and sends the bearer token', async () => {
    let auth: string | undefined;
    stubFetch((_url, init) => {
      auth = new Headers(init?.headers).get('Authorization') ?? undefined;
      return jsonResponse({
        businesses: [
          { id: 'abc', review_count: 12, rating: 4.0, price: '$$', categories: [{ title: 'Barbers' }] },
        ],
      });
    });
    const result = await yelpSearch({ YELP_API_KEY: 'yk' }, 'Shop', 'Chicago');
    expect(auth).toBe('Bearer yk');
    expect(result).toEqual({
      yelp_id: 'abc',
      yelp_review_count: 12,
      yelp_rating: 4.0,
      yelp_price: '$$',
      yelp_categories: ['Barbers'],
    });
  });

  it('returns null when Yelp has no match', async () => {
    stubFetch(() => jsonResponse({ businesses: [] }));
    expect(await yelpSearch({ YELP_API_KEY: 'yk' }, 'Shop', 'Chicago')).toBeNull();
  });
});

describe('apify meta', () => {
  it('reports no ads without a token instead of starting an actor run', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    expect(await getMetaAds({}, 'Shop')).toEqual({ has_meta_ads: false, meta_ads_count: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('html scrapers', () => {
  const ldJson = (body: unknown) =>
    new Response(`<html><script type="application/ld+json">${JSON.stringify(body)}</script></html>`, {
      headers: { 'Content-Type': 'text/html' },
    });

  it('reads the Thumbtack aggregate rating and never a hire count', async () => {
    stubFetch(() => ldJson({ name: 'Shop', aggregateRating: { ratingValue: 4.8, reviewCount: 30 } }));
    expect(await thumbtackSearch('Shop', '60619')).toEqual({
      thumbtack_name: 'Shop',
      thumbtack_rating: 4.8,
      thumbtack_review_count: 30,
      thumbtack_hires: null,
    });
  });

  it('returns null when a page carries no LD+JSON', async () => {
    stubFetch(() => new Response('<html>nothing</html>'));
    expect(await thumbtackSearch('Shop', '60619')).toBeNull();
    expect(await angiSearch('Shop', '60619')).toBeNull();
  });

  it('reads the Angi aggregate rating', async () => {
    stubFetch(() => ldJson({ name: 'Shop', aggregateRating: { ratingValue: 3.5, reviewCount: 8 } }));
    expect(await angiSearch('Shop', '60619')).toEqual({ angi_name: 'Shop', angi_rating: 3.5, angi_review_count: 8 });
  });

  it('counts only the Craigslist titles that name the business', async () => {
    stubFetch(
      () =>
        new Response(
          '<a class="result-title hdrlnk">SHOP haircuts</a><a class="result-title">Someone else</a>' +
            '<a class="result-title">shop mobile</a>',
        ),
    );
    expect(await searchServices('Shop')).toEqual({ craigslist_listing_count: 2, craigslist_has_presence: true });
  });

  it('skips Nextdoor without cookies', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    expect(await nextdoorSearch('Shop', '60619')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('sends the cookie header when cookies are supplied', async () => {
    let cookie: string | undefined;
    stubFetch((_url, init) => {
      cookie = new Headers(init?.headers).get('Cookie') ?? undefined;
      return jsonResponse({ results: [{ id: 'nd1', recommendation_count: 7, neighborhood: 'Chatham' }] });
    });
    const result = await nextdoorSearch('Shop', '60619', { session: 'abc' });
    expect(cookie).toBe('session=abc');
    expect(result?.nextdoor_recommendations).toBe(7);
  });
});

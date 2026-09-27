// ADR 031: a source is credited for a fact only when its recorded value equals the value the record
// displays, and every absent fact says whether anyone looked for it.
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveFacts, type Fact, type ProvenanceInput } from '../src/lib/provenance';
import type { OvertureMatch } from '../src/lib/overture';
import type { GoogleMatchRow } from '../src/types';
import { accessToken, adminUser, api, createBusiness, resetDb, viewerUser } from './helpers';

const GOOGLE_MATCHED: GoogleMatchRow = {
  business_id: 'b', status: 'matched', place_id: 'ChIJ_fixture', matched_name: 'Fixture Barbershop', score: 1,
  distance_m: 11, website: 'http://fixture-barbershop.test', phone: '(773) 555-0100', looked_up_at: '2026-09-26T00:00:00Z',
};
const OVERTURE_MATCHED: OvertureMatch = {
  account_number: '478849', site_number: '1', matched: 1, gers_id: 'gers-fixture', matched_name: 'Fixture Barbershop',
  score: 1, distance_m: 5, website: 'http://fixture-barbershop.test', has_facebook: 1, has_instagram: 0, phone: null,
  built_at: '2026-09-25T00:00:00Z',
};
const BUSINESS = { name: 'Fixture Barbershop', license_name: 'Fixture Barbershop', phone: '(773) 555-0100', license_status: 'active' };
const PRESENCE = {
  website_url: 'http://fixture-barbershop.test', has_google_business_profile: 1, google_avg_rating: 4.5,
  google_review_count: 47, has_facebook_page: 1, has_instagram: 0,
};

function facts(over: Partial<ProvenanceInput> = {}): Record<string, Fact> {
  const input: ProvenanceInput = { business: BUSINESS, presence: PRESENCE, google: GOOGLE_MATCHED, overture: OVERTURE_MATCHED, ...over };
  return Object.fromEntries(deriveFacts(input).map((f) => [f.key, f]));
}

describe('crediting a source', () => {
  it('credits only Google when Google and Overture found different websites, because the record shows Google’s', () => {
    const website = facts({ overture: { ...OVERTURE_MATCHED, website: 'http://someone-else.test' } }).website;
    expect(website).toMatchObject({ value: 'http://fixture-barbershop.test', sources: ['google'], state: 'found' });
  });

  it('credits both when Google and Overture found the same website', () => {
    expect(facts().website.sources).toEqual(['google', 'overture']);
  });

  it('credits Overture for a website Google did not find', () => {
    const website = facts({ google: { ...GOOGLE_MATCHED, website: null } }).website;
    expect(website.sources).toEqual(['overture']);
  });

  it('compares Overture’s value after the same trim the merge applied', () => {
    const website = facts({ overture: { ...OVERTURE_MATCHED, website: '  http://fixture-barbershop.test ' } }).website;
    expect(website.sources).toEqual(['google', 'overture']);
  });

  it('credits no source for a value stored before provenance was recorded', () => {
    const website = facts({ google: null, overture: null }).website;
    expect(website).toMatchObject({ sources: [], state: 'found' });
  });

  it('credits the licence for the name when Google did not rename the business', () => {
    expect(facts().name.sources).toEqual(['license']);
  });

  it('credits Google for the name when its name replaced the licence name', () => {
    const name = facts({ business: { ...BUSINESS, name: 'Fixture Barbershop & Shave' } }).name;
    expect(name.sources).toEqual(['google']);
  });

  it('credits Overture for a social link only when its match carries that link', () => {
    const f = facts();
    expect(f.facebook).toMatchObject({ value: true, sources: ['overture'], state: 'found' });
    expect(f.instagram).toMatchObject({ value: false, sources: [], state: 'none_found' });
  });
});

describe('saying whether an absent fact was looked for', () => {
  it('says none found when Google looked and found no profile', () => {
    const f = facts({
      google: { ...GOOGLE_MATCHED, status: 'no_candidate', place_id: null, website: null, phone: null },
      presence: { ...PRESENCE, has_google_business_profile: 0, google_avg_rating: null, google_review_count: null },
    });
    expect(f.google_business_profile).toMatchObject({ value: false, sources: [], state: 'none_found' });
    expect(f.rating.state).toBe('none_found');
  });

  it('says unknown when the Places lookup was refused', () => {
    const f = facts({
      google: { ...GOOGLE_MATCHED, status: 'unavailable', website: null, phone: null },
      overture: null,
      presence: { ...PRESENCE, website_url: null, has_google_business_profile: 0, google_avg_rating: null, google_review_count: null },
    });
    expect(f.google_business_profile.state).toBe('unknown');
    expect(f.review_count.state).toBe('unknown');
    expect(f.website.state).toBe('unknown');
  });

  it('keeps a missing website unknown when Places was refused, even though Overture looked', () => {
    const f = facts({
      google: { ...GOOGLE_MATCHED, status: 'unavailable', website: null, phone: null },
      overture: { ...OVERTURE_MATCHED, website: null },
      presence: { ...PRESENCE, website_url: null },
    });
    expect(f.website).toMatchObject({ value: null, sources: [], state: 'unknown' });
  });

  it('says not recorded for a business stored before migration 0005', () => {
    const f = facts({
      google: null,
      overture: null,
      presence: { ...PRESENCE, website_url: null, has_google_business_profile: 0, google_avg_rating: null, google_review_count: null },
    });
    expect(f.website.state).toBe('not_recorded');
    expect(f.google_business_profile.state).toBe('not_recorded');
  });

  it('says not recorded, not none found, for a missing website or phone when only Overture’s look was recorded', () => {
    // "None found" claims every source that could supply the fact looked; whether Google did was never kept.
    const f = facts({
      business: { ...BUSINESS, phone: null },
      google: null,
      overture: { ...OVERTURE_MATCHED, matched: 0, gers_id: null, matched_name: null, score: null, distance_m: null, website: null, has_facebook: 0 },
      presence: { ...PRESENCE, website_url: null },
    });
    expect(f.website).toMatchObject({ value: null, sources: [], state: 'not_recorded' });
    expect(f.phone).toMatchObject({ value: null, sources: [], state: 'not_recorded' });
  });

  it('still credits Overture alone for a website it found on a business stored before Google’s look was recorded', () => {
    const f = facts({ google: null, presence: { ...PRESENCE, website_url: 'http://fixture-barbershop.test' } });
    expect(f.website).toMatchObject({ value: 'http://fixture-barbershop.test', sources: ['overture'], state: 'found' });
  });

  it('treats zero reviews as a measurement, not an absence', () => {
    const reviews = facts({ presence: { ...PRESENCE, google_review_count: 0 } }).review_count;
    expect(reviews).toMatchObject({ value: 0, sources: ['google'], state: 'found' });
  });

  it('says unknown for social links when the Overture build never covered the business', () => {
    const f = facts({ overture: null, presence: { ...PRESENCE, has_facebook_page: 0 } });
    expect(f.facebook.state).toBe('unknown');
  });
});

describe('GET /api/businesses/:id/provenance', () => {
  let token: string;
  beforeEach(async () => {
    await resetDb();
    token = await accessToken(await adminUser());
  });

  async function seedMeasuredBusiness(): Promise<string> {
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO businesses (id, name, license_name, zip_code, niche, phone, license_number, license_status,
           license_issue_date, account_number, site_number)
         VALUES (?, 'Fixture Barbershop', 'Fixture Barbershop', '60619', 'barbershops', '(773) 555-0100', '2874631',
           'active', '2019-05-15', '478849', '1')`,
      ).bind(id),
      env.DB.prepare(
        `INSERT INTO digital_presences (id, business_id, has_website, website_url, has_google_business_profile,
           google_review_count, google_avg_rating, has_facebook_page, has_instagram)
         VALUES (?, ?, 1, 'http://fixture-barbershop.test', 1, 47, 4.5, 1, 0)`,
      ).bind(crypto.randomUUID(), id),
      env.DB.prepare(
        `INSERT INTO google_matches (business_id, status, place_id, matched_name, score, distance_m, website, phone, looked_up_at)
         VALUES (?, 'matched', 'ChIJ_fixture', 'Fixture Barbershop', 1, 11, 'http://fixture-barbershop.test',
           '(773) 555-0100', '2026-09-26T00:00:00Z')`,
      ).bind(id),
      env.DB.prepare(
        `INSERT INTO overture_matches (account_number, site_number, matched, website, has_facebook, has_instagram, phone, built_at)
         VALUES ('478849', '1', 1, 'http://fixture-barbershop.test', 1, 0, NULL, '2026-09-25T00:00:00Z')`,
      ),
    ]);
    return id;
  }

  it('returns the licence record, both source rows and each fact with its sources', async () => {
    const id = await seedMeasuredBusiness();
    const res = await api('GET', `/businesses/${id}/provenance`, { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { license: unknown; google: GoogleMatchRow; overture: Record<string, unknown>; facts: Fact[] };
    expect(body.license).toEqual({
      license_name: 'Fixture Barbershop', account_number: '478849', site_number: '1',
      license_number: '2874631', license_status: 'active', license_issue_date: '2019-05-15',
    });
    expect(body.google.status).toBe('matched');
    expect(body.overture).toMatchObject({ matched: 1, built_at: '2026-09-25T00:00:00Z' });
    const byKey = Object.fromEntries(body.facts.map((f) => [f.key, f]));
    expect(byKey.website.sources).toEqual(['google', 'overture']);
    expect(byKey.phone.sources).toEqual(['google']);
    expect(byKey.facebook.sources).toEqual(['overture']);
  });

  it('lets a viewer read where the facts came from', async () => {
    const id = await seedMeasuredBusiness();
    const viewer = await accessToken(await viewerUser());
    expect((await api('GET', `/businesses/${id}/provenance`, { token: viewer })).status).toBe(200);
  });

  it('answers 404 for a business that does not exist', async () => {
    expect((await api('GET', `/businesses/${crypto.randomUUID()}/provenance`, { token })).status).toBe(404);
  });

  it('returns no source rows for a business stored before provenance was recorded', async () => {
    const id = await createBusiness();
    const body = (await (await api('GET', `/businesses/${id}/provenance`, { token })).json()) as {
      google: unknown; overture: unknown; facts: Fact[];
    };
    expect(body.google).toBeNull();
    expect(body.overture).toBeNull();
    const byKey = Object.fromEntries(body.facts.map((f) => [f.key, f]));
    expect(byKey.website.state).toBe('not_recorded');
    expect(byKey.phone).toMatchObject({ value: '(773) 555-0001', sources: [], state: 'found' });
  });
});

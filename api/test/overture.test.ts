import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from './helpers';
import { applyOvertureMatch, fetchOvertureMatch, type OvertureMatch, type PresenceFacts } from '../src/lib/overture';

beforeEach(async () => {
  await resetDb();
});

const insert = (account: string, site: string | null, matched = 1) =>
  env.DB.prepare(
    `INSERT INTO overture_matches (account_number, site_number, matched, built_at)
     VALUES (?, ?, ?, '2026-09-25T00:00:00Z')`,
  ).bind(account, site, matched).run();

describe('overture_matches', () => {
  it('stores one row per licence account', async () => {
    await insert('478849', '1');
    const row = await env.DB.prepare('SELECT account_number, matched FROM overture_matches').first();
    expect(row).toEqual({ account_number: '478849', matched: 1 });
  });

  it('rejects a second row for the same licence account', async () => {
    await insert('478849', '1');
    await expect(insert('478849', '1')).rejects.toThrow();
  });

  it('keeps a no-match row distinguishable from no row at all', async () => {
    // A coverage gap and a genuine no-match must not look the same: the first means the build has
    // not run for this business, the second means Overture has nothing for it.
    await insert('478849', '1', 0);
    const looked = await env.DB.prepare(
      'SELECT matched FROM overture_matches WHERE account_number = ?',
    ).bind('478849').first<{ matched: number }>();
    const never = await env.DB.prepare(
      'SELECT matched FROM overture_matches WHERE account_number = ?',
    ).bind('999999').first();
    expect(looked?.matched).toBe(0);
    expect(never).toBeNull();
  });
});

const bare: PresenceFacts = {
  has_website: false, website_url: null, has_facebook_page: false, has_instagram: false, phone: null,
};
const match = (over: Partial<OvertureMatch> = {}): OvertureMatch => ({
  account_number: '478849', site_number: '1', matched: 1, gers_id: 'g1', matched_name: 'Shop',
  score: 0.9, distance_m: 12, website: null, has_facebook: 0, has_instagram: 0, phone: null, ...over,
});

describe('applyOvertureMatch', () => {
  it('adds a website Google did not find', () => {
    // Overture carries 55 websites to Google's 23 on the measured sample, 40 of them Overture-only,
    // and the website term is 30 of the deficit's 100 points.
    const out = applyOvertureMatch(bare, match({ website: 'http://shop.com' }));
    expect(out.has_website).toBe(true);
    expect(out.website_url).toBe('http://shop.com');
  });

  it('never downgrades a website Google did find', () => {
    const base = { ...bare, has_website: true, website_url: 'http://google-found.com' };
    const out = applyOvertureMatch(base, match({ website: null }));
    expect(out.has_website).toBe(true);
    expect(out.website_url).toBe('http://google-found.com');
  });

  it('prefers the live Google URL when both sources have one', () => {
    const base = { ...bare, has_website: true, website_url: 'http://google-found.com' };
    const out = applyOvertureMatch(base, match({ website: 'http://overture-found.com' }));
    expect(out.website_url).toBe('http://google-found.com');
  });

  it('supplies social presence, which Google never reports', () => {
    // This is what stops computeDigitalDeficit's +12 firing for every business alike: 60 of
    // Overture's 74 matches carry a social link where Google carries none at all.
    const out = applyOvertureMatch(bare, match({ has_facebook: 1, has_instagram: 1 }));
    expect(out.has_facebook_page).toBe(true);
    expect(out.has_instagram).toBe(true);
  });

  it('never downgrades a Facebook page already recorded', () => {
    const base = { ...bare, has_facebook_page: true };
    expect(applyOvertureMatch(base, match({ has_facebook: 0 })).has_facebook_page).toBe(true);
  });

  it('never downgrades an Instagram presence already recorded', () => {
    const base = { ...bare, has_instagram: true };
    expect(applyOvertureMatch(base, match({ has_instagram: 0 })).has_instagram).toBe(true);
  });

  it('does not credit a business with a website Overture recorded as blank', () => {
    // Measured against the real 23,969-row build: 82 matched rows carry website = '' rather than
    // null. An empty string is neither null nor undefined, so a naive !== null / ?? check would
    // flip the 30-point website term (scoring.ts:42) on zero evidence for every one of them.
    const out = applyOvertureMatch(bare, match({ website: '' }));
    expect(out.has_website).toBe(false);
    expect(out.website_url).toBeNull();
  });

  it('treats a whitespace-only website or phone as absent', () => {
    // This is the test that protects the trim(). Without it, overturePresent could be reduced to
    // `value ? value : null` and every other test would still pass while whitespace silently
    // regressed to being treated as evidence.
    const out = applyOvertureMatch(bare, match({ website: '   ', phone: '\t ' }));
    expect(out.has_website).toBe(false);
    expect(out.website_url).toBeNull();
    expect(out.phone).toBeNull();
  });

  it('adds nothing for a row the build found no match for', () => {
    expect(applyOvertureMatch(bare, match({ matched: 0, website: 'http://stale.com' }))).toEqual(bare);
  });

  it('adds nothing when the build has not covered the business', () => {
    expect(applyOvertureMatch(bare, null)).toEqual(bare);
  });

  it('fills a phone the live lookup missed', () => {
    expect(applyOvertureMatch(bare, match({ phone: '773-555-0000' })).phone).toBe('773-555-0000');
  });

  it('never downgrades a phone the live lookup found', () => {
    const base = { ...bare, phone: '773-555-1111' };
    expect(applyOvertureMatch(base, match({ phone: '773-555-0000' })).phone).toBe('773-555-1111');
  });
});

describe('fetchOvertureMatch', () => {
  it('finds the row for a licence account', async () => {
    await env.DB.prepare(
      `INSERT INTO overture_matches (account_number, site_number, matched, website, built_at)
       VALUES ('478849', '1', 1, 'http://shop.com', '2026-09-25T00:00:00Z')`,
    ).run();
    const found = await fetchOvertureMatch(env.DB, '478849', '1');
    expect(found?.website).toBe('http://shop.com');
  });

  it('returns null for an account with no row and for a licence with no account number', async () => {
    expect(await fetchOvertureMatch(env.DB, '999999', '1')).toBeNull();
    expect(await fetchOvertureMatch(env.DB, null, null)).toBeNull();
  });
});

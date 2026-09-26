// The backfill exists because a refresh of the Overture match table must improve businesses already
// stored, not only ones discovered afterwards. It runs inside the Worker so it calls the real
// computeDigitalDeficit: generating UPDATE statements offline would have meant a third copy of a
// scorer already pinned across Python and TypeScript.
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { accessToken, adminUser, api, resetDb, viewerUser } from './helpers';

// Cached per test (cleared in beforeEach) rather than created fresh on every run() call: adminUser()
// always inserts 'admin@test.com', so a test that calls run() more than once (the idempotency case
// below) would otherwise hit users.email's UNIQUE constraint on the second call.
let cachedToken: string | undefined;

beforeEach(async () => {
  await resetDb();
  cachedToken = undefined;
});

async function seed(opts: { website?: string | null; facebook?: number } = {}) {
  const businessId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO businesses (id, name, zip_code, niche, account_number, site_number)
     VALUES (?, 'Test Shop', '60619', 'barbershops', '478849', '1')`,
  ).bind(businessId).run();
  await env.DB.prepare(
    `INSERT INTO digital_presences (id, business_id, has_website, has_google_business_profile,
       google_review_count, has_facebook_page, has_instagram, created_at, updated_at)
     VALUES (?, ?, 0, 1, 47, 0, 0, '2026-09-25T00:00:00Z', '2026-09-25T00:00:00Z')`,
  ).bind(crypto.randomUUID(), businessId).run();
  await env.DB.prepare(
    `INSERT INTO lead_scores (id, business_id, score_version, digital_deficit_score,
       composite_acquisition_score, created_at, updated_at)
     VALUES (?, ?, 1, 49, 49, '2026-09-25T00:00:00Z', '2026-09-25T00:00:00Z')`,
  ).bind(crypto.randomUUID(), businessId).run();
  await env.DB.prepare(
    `INSERT INTO overture_matches (account_number, site_number, matched, website,
       has_facebook, has_instagram, built_at)
     VALUES ('478849', '1', 1, ?, ?, 0, '2026-09-25T00:00:00Z')`,
  ).bind(opts.website ?? null, opts.facebook ?? 0).run();
  return businessId;
}

const run = async (limit = 50) => {
  if (!cachedToken) cachedToken = await accessToken(await adminUser());
  const res = await api('POST', '/enrichment/overture-backfill', { token: cachedToken, json: { limit } });
  return { res, body: (await res.json()) as { examined: number; updated: number; skipped: number } };
};

describe('POST /api/enrichment/overture-backfill', () => {
  it('rejects an anonymous request and a viewer', async () => {
    expect((await api('POST', '/enrichment/overture-backfill', { json: {} })).status).toBe(401);
    const token = await accessToken(await viewerUser());
    expect((await api('POST', '/enrichment/overture-backfill', { token, json: {} })).status).toBe(403);
  });

  it('adds a website Overture has and the stored row lacks', async () => {
    const businessId = await seed({ website: 'http://found.com' });
    const { body } = await run();
    expect(body).toEqual({ examined: 1, updated: 1, skipped: 0 });

    const presence = await env.DB.prepare(
      'SELECT has_website, website_url FROM digital_presences WHERE business_id = ?',
    ).bind(businessId).first();
    expect(presence).toEqual({ has_website: 1, website_url: 'http://found.com' });
  });

  it('writes a NEW score version and leaves the old one intact', async () => {
    // Scores are append-only (ADR 014, 017), and both LATEST_SCORE_JOIN and sentiment-feedback read
    // score_version DESC, so a new row is what makes the improvement visible.
    const businessId = await seed({ website: 'http://found.com' });
    await run();

    const scores = await env.DB.prepare(
      'SELECT score_version, digital_deficit_score FROM lead_scores WHERE business_id = ? ORDER BY score_version',
    ).bind(businessId).all<{ score_version: number; digital_deficit_score: number }>();
    expect(scores.results.map((s) => s.score_version)).toEqual([1, 2]);
    expect(scores.results[0].digital_deficit_score).toBe(49);
    // website (0) + GBP (0) + 47 reviews (0) + no social (12) + no ads (7) = 19
    expect(scores.results[1].digital_deficit_score).toBe(19);
  });

  it('is idempotent: a second run finds nothing to do', async () => {
    await seed({ website: 'http://found.com' });
    expect((await run()).body.updated).toBe(1);
    expect((await run()).body).toEqual({ examined: 0, updated: 0, skipped: 0 });
  });

  // The candidate query's WHERE clause is the idempotency mechanism, and it is encoded twice: once in
  // SQL (this predicate), once in TypeScript (applyOvertureMatch's overturePresent). SQLite's
  // `IS NOT NULL` is true for an empty string, so a naive predicate would select a business whose
  // Overture row carries website = '' forever -- applyOvertureMatch would correctly decline to change
  // anything, and with no ORDER BY on this query's LIMIT, a run whose limit filled up with these
  // permanently-unfixable rows would do no useful work on every subsequent run either.
  it('never resurfaces a business whose only Overture offering is a blank website', async () => {
    const businessId = await seed({ website: '', facebook: 0 });
    expect((await run()).body).toEqual({ examined: 0, updated: 0, skipped: 0 });

    const presence = await env.DB.prepare(
      'SELECT has_website FROM digital_presences WHERE business_id = ?',
    ).bind(businessId).first();
    expect(presence).toEqual({ has_website: 0 });
  });

  it('never downgrades a website already stored', async () => {
    const businessId = await seed({ website: null, facebook: 1 });
    await env.DB.prepare(
      "UPDATE digital_presences SET has_website = 1, website_url = 'http://kept.com' WHERE business_id = ?",
    ).bind(businessId).run();

    await run();
    const presence = await env.DB.prepare(
      'SELECT has_website, website_url, has_facebook_page FROM digital_presences WHERE business_id = ?',
    ).bind(businessId).first();
    expect(presence).toEqual({ has_website: 1, website_url: 'http://kept.com', has_facebook_page: 1 });
  });

  it('ignores a business whose build found no match', async () => {
    const businessId = await seed({ website: 'http://found.com' });
    await env.DB.prepare('UPDATE overture_matches SET matched = 0').run();
    expect((await run()).body).toEqual({ examined: 0, updated: 0, skipped: 0 });
    const presence = await env.DB.prepare(
      'SELECT has_website FROM digital_presences WHERE business_id = ?',
    ).bind(businessId).first();
    expect(presence).toEqual({ has_website: 0 });
  });

  it('rejects a limit above the cap', async () => {
    const token = await accessToken(await adminUser());
    const res = await api('POST', '/enrichment/overture-backfill', { token, json: { limit: 5000 } });
    expect(res.status).toBe(422);
  });
});

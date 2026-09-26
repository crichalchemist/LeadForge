// Applies a refreshed Overture match table to businesses already stored (ADR 030 slice 2).
//
// Python has no HTTP route for this either — its equivalent work runs from the Typer CLI — so this
// is the Workers stand-in, exactly as POST /api/discovery/run is. It lives in the Worker rather than
// in the offline build script for one reason: it must call the real computeDigitalDeficit, and a
// scorer already pinned across Python and TypeScript must not get a third implementation.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { applyOvertureMatch, type OvertureMatch, type PresenceFacts } from '../lib/overture';
import { computeDigitalDeficit } from '../lib/scoring';
import { nowIso } from '../db/serialize';
import { jsonBody } from '../lib/validate';
import type { AppEnv } from '../types';

const router = new Hono<AppEnv>();

// Each candidate costs one query for the batch's three statements (UPDATE digital_presences, UPDATE
// businesses, INSERT lead_scores) plus a share of the one candidate SELECT, so one invocation costs
// 1 + 3*limit D1 queries in the worst case (every candidate actually changes something). Workers Free
// is documented elsewhere in this codebase (ADR 030) as capping Worker-invocation subrequests at 50,
// but that figure specifically for "D1 queries per invocation" was not re-verified here — treat it as
// unconfirmed and stay well clear of it regardless, because the idempotent predicate makes repeated
// small calls free: a partial run just gets picked up again. MAX_LIMIT = 15 puts the worst case at
// 1 + 3*15 = 46; the default of 10 is 1 + 3*10 = 31.
const MAX_LIMIT = 15;

const backfillSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(10),
});

interface Candidate extends OvertureMatch {
  business_id: string;
  presence_id: string;
  stored_has_website: number;
  stored_website_url: string | null;
  stored_has_facebook: number;
  stored_has_instagram: number;
  stored_phone: string | null;
  stored_gbp: number;
  stored_review_count: number | null;
  latest_version: number;
}

router.post('/overture-backfill', requireAuth, requireAdmin, jsonBody(backfillSchema), async (c) => {
  const { limit } = c.req.valid('json');

  // The WHERE clause is the idempotency mechanism: it selects only businesses the match would ADD
  // something to, so a second run finds nothing. `site_number IS` rather than `=` because `=` yields
  // NULL for a null site number and the join would silently miss those rows.
  //
  // `ls` follows the same "latest row per business" window-function shape as LATEST_SCORE_JOIN in
  // routes/businesses.ts (a multi-row candidate set, like this query, rather than the single-business
  // lookup sentiment-feedback.ts uses). `ls.digital_deficit_score IS NOT NULL` excludes a business
  // whose latest score is the deliberate NULL discovery.ts writes for a lookup that never completed
  // (lib/discovery.ts:207-219): that NULL means "never measured", not "measured at zero", and the
  // Google-only terms (GBP, review count) missing from an unmeasured row would make
  // computeDigitalDeficit charge +15 for "no GBP" on no evidence and land systematically lower than a
  // real measurement — an unmeasured business would then outrank a measured one. Re-enrichment from
  // Google, not Overture alone, is what turns such a business into a real candidate.
  //
  // `TRIM(om.website, char(9)||char(10)||char(13)||' ')` rather than one-argument `TRIM` or
  // `IS NOT NULL`: one-argument SQLite `TRIM` strips only U+0020, but applyOvertureMatch's
  // overturePresent() uses JS `.trim()`, which strips tab/newline/CR too. Passing the same four
  // characters explicitly is what makes the SQL and TypeScript blank-checks actually agree — the
  // pair of tests below ("blank website" and "whitespace-only website") hold that agreement in place,
  // since D1 cannot call the TypeScript function to check it directly.
  // A business whose latest score is the deliberate NULL is excluded OUTRIGHT, not merely scored
  // differently. Its stored has_google_business_profile = 0 means "never looked up", not "no profile", so
  // scoring it would charge computeDigitalDeficit's +15 on no evidence and overwrite the very marker
  // recording that nobody researched it. It needs Google first; Overture cannot substitute, because the
  // terms it cannot supply are exactly the Google-only ones.
  //
  // This is deliberately ASYMMETRIC with ingest, which stores the merged presence facts and withholds
  // only the score, where this writes nothing at all. Two reasons: the route's contract is score
  // improvement, and a business with no measured baseline is not improvable by it; and `updated` in the
  // response would otherwise mean two different things. No evidence is lost either way -- the match stays
  // in overture_matches, which is the source of record, and the business becomes eligible as soon as a
  // Google enrichment gives it a measured baseline.
  const candidates = await c.env.DB.prepare(
    `SELECT b.id AS business_id, dp.id AS presence_id,
            dp.has_website AS stored_has_website, dp.website_url AS stored_website_url,
            dp.has_facebook_page AS stored_has_facebook, dp.has_instagram AS stored_has_instagram,
            dp.has_google_business_profile AS stored_gbp,
            dp.google_review_count AS stored_review_count,
            b.phone AS stored_phone,
            om.account_number, om.site_number, om.matched, om.gers_id, om.matched_name,
            om.score, om.distance_m, om.website, om.has_facebook, om.has_instagram, om.phone,
            ls.score_version AS latest_version
       FROM businesses b
       JOIN digital_presences dp ON dp.business_id = b.id
       JOIN overture_matches om
         ON om.account_number = b.account_number AND om.site_number IS b.site_number
       LEFT JOIN (
         SELECT business_id, score_version, digital_deficit_score FROM (
           SELECT business_id, score_version, digital_deficit_score,
                  ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY score_version DESC) AS rn
           FROM lead_scores
         ) WHERE rn = 1
       ) ls ON ls.business_id = b.id
      WHERE om.matched = 1
        AND ls.digital_deficit_score IS NOT NULL
        AND ( (dp.has_website = 0 AND TRIM(COALESCE(om.website,''), char(9)||char(10)||char(13)||' ') <> '')
           OR (dp.has_facebook_page = 0 AND om.has_facebook = 1)
           OR (dp.has_instagram = 0 AND om.has_instagram = 1) )
      LIMIT ?`,
  )
    .bind(limit)
    .all<Candidate>();

  let updated = 0;
  let skipped = 0;
  const timestamp = nowIso();

  for (const row of candidates.results) {
    const stored: PresenceFacts = {
      has_website: row.stored_has_website === 1,
      website_url: row.stored_website_url,
      has_facebook_page: row.stored_has_facebook === 1,
      has_instagram: row.stored_has_instagram === 1,
      phone: row.stored_phone,
    };
    const facts = applyOvertureMatch(stored, row);
    if (
      facts.has_website === stored.has_website &&
      facts.has_facebook_page === stored.has_facebook_page &&
      facts.has_instagram === stored.has_instagram
    ) {
      skipped += 1;
      continue;
    }

    // Recomputed from the merged row, by the same function discovery uses. has_facebook_page and
    // has_instagram are the terms this backfill exists to correct: Google reports neither, so before
    // the overlay every business alike paid the +12 "no social presence" penalty.
    const deficit = computeDigitalDeficit({
      has_website: facts.has_website ? 1 : 0,
      website_url: facts.website_url,
      website_quality_score: null,
      has_ssl: null,
      has_google_business_profile: row.stored_gbp,
      gbp_completeness_score: null,
      google_review_count: row.stored_review_count,
      has_facebook_page: facts.has_facebook_page ? 1 : 0,
      has_instagram: facts.has_instagram ? 1 : 0,
      fb_last_post_days_ago: null,
      has_google_ads: 0,
      has_meta_ads: 0,
    } as Parameters<typeof computeDigitalDeficit>[0]);

    // Composite is the deficit alone: the other sub-scores need a competitive context that does not
    // exist yet, which is the same Phase 1 shape runDiscovery writes.
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE digital_presences SET has_website = ?, website_url = ?, has_facebook_page = ?,
           has_instagram = ?, updated_at = ? WHERE id = ?`,
      ).bind(
        facts.has_website ? 1 : 0,
        facts.website_url,
        facts.has_facebook_page ? 1 : 0,
        facts.has_instagram ? 1 : 0,
        timestamp,
        row.presence_id,
      ),
      c.env.DB.prepare('UPDATE businesses SET phone = ?, updated_at = ? WHERE id = ?').bind(
        facts.phone,
        timestamp,
        row.business_id,
      ),
      c.env.DB.prepare(
        `INSERT INTO lead_scores (id, business_id, score_version, digital_deficit_score,
           composite_acquisition_score, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        row.business_id,
        row.latest_version + 1,
        deficit,
        deficit,
        timestamp,
        timestamp,
      ),
    ]);
    updated += 1;
  }

  console.log('overture_backfill', { examined: candidates.results.length, updated, skipped });
  return c.json({ examined: candidates.results.length, updated, skipped });
});

export default router;

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

const MAX_LIMIT = 500;

const backfillSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
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
  // `TRIM(COALESCE(om.website,'')) <> ''` rather than `om.website IS NOT NULL`: SQLite's IS NOT NULL
  // is true for an empty string, but applyOvertureMatch's overturePresent() already treats a blank or
  // whitespace-only website as absent (measured: 82 of 23,969 rows carry website = ''). A predicate
  // that disagreed with that would select those rows as candidates forever — applyOvertureMatch would
  // correctly decline to change anything, they would never be updated, and with no ORDER BY on this
  // LIMIT query they could starve out every genuinely fixable candidate on every run.
  const candidates = await c.env.DB.prepare(
    `SELECT b.id AS business_id, dp.id AS presence_id,
            dp.has_website AS stored_has_website, dp.website_url AS stored_website_url,
            dp.has_facebook_page AS stored_has_facebook, dp.has_instagram AS stored_has_instagram,
            dp.has_google_business_profile AS stored_gbp,
            dp.google_review_count AS stored_review_count,
            b.phone AS stored_phone,
            om.account_number, om.site_number, om.matched, om.gers_id, om.matched_name,
            om.score, om.distance_m, om.website, om.has_facebook, om.has_instagram, om.phone,
            (SELECT COALESCE(MAX(score_version), 0) FROM lead_scores WHERE business_id = b.id)
              AS latest_version
       FROM businesses b
       JOIN digital_presences dp ON dp.business_id = b.id
       JOIN overture_matches om
         ON om.account_number = b.account_number AND om.site_number IS b.site_number
      WHERE om.matched = 1
        AND ( (dp.has_website = 0 AND TRIM(COALESCE(om.website,'')) <> '')
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

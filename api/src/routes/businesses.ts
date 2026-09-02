import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { jsonBody, queryParams } from '../lib/validate';
import { NICHES } from '../lib/stages';
import { nowIso, withBooleans, DIGITAL_PRESENCE_BOOLS, OUTREACH_BOOLS } from '../db/serialize';
import type { AppEnv, BusinessRow, DigitalPresenceRow, LeadScoreRow, OutreachRecordRow } from '../types';

const router = new Hono<AppEnv>();

/** Latest score per business (highest score_version). Alias: ls. Reused by leads and reports. */
export const LATEST_SCORE_JOIN = `
  LEFT JOIN (
    SELECT business_id, composite_acquisition_score, price_tier FROM (
      SELECT business_id, composite_acquisition_score, price_tier,
             ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY score_version DESC) AS rn
      FROM lead_scores
    ) WHERE rn = 1
  ) ls ON ls.business_id = b.id`;

/** Latest outreach record per business (newest created_at). Alias: lo. */
export const LATEST_OUTREACH_JOIN = `
  LEFT JOIN (
    SELECT business_id, status FROM (
      SELECT business_id, status,
             ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC, rowid DESC) AS rn
      FROM outreach_records
    ) WHERE rn = 1
  ) lo ON lo.business_id = b.id`;

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  zip_code: z.string().optional(),
  niche: z.enum(NICHES).optional(),
  min_score: z.coerce.number().optional(),
  max_score: z.coerce.number().optional(),
  stage: z.string().optional(),
  search: z.string().optional(),
  sort_by: z.enum(['name', 'zip_code', 'composite_acquisition_score', 'created_at']).default('composite_acquisition_score'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
});

const updateBody = z.object({
  name: z.string().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  owner_name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(), // accepted, ignored: no column (=py BusinessUpdate)
});

const SORT_COLUMNS = {
  name: 'b.name',
  zip_code: 'b.zip_code',
  composite_acquisition_score: 'ls.composite_acquisition_score',
  created_at: 'b.created_at',
} as const;

// =py routes/businesses.list_businesses
router.get('/', requireAuth, queryParams(listQuery), async (c) => {
  const q = c.req.valid('query');
  const db = c.env.DB;
  const where: string[] = [];
  const binds: unknown[] = [];

  if (q.zip_code) { where.push('b.zip_code = ?'); binds.push(q.zip_code); }
  if (q.niche) { where.push('b.niche = ?'); binds.push(q.niche); }
  if (q.search) { where.push('b.name LIKE ? COLLATE NOCASE'); binds.push(`%${q.search}%`); }
  if (q.min_score !== undefined) { where.push('ls.composite_acquisition_score >= ?'); binds.push(q.min_score); }
  if (q.max_score !== undefined) { where.push('ls.composite_acquisition_score <= ?'); binds.push(q.max_score); }
  if (q.stage) { where.push('EXISTS (SELECT 1 FROM outreach_records o WHERE o.business_id = b.id AND o.status = ?)'); binds.push(q.stage); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM businesses b ${LATEST_SCORE_JOIN} ${LATEST_OUTREACH_JOIN} ${whereSql}`;
  const nulls = q.sort_dir === 'desc' ? 'NULLS LAST' : 'NULLS FIRST';
  const orderSql = `ORDER BY ${SORT_COLUMNS[q.sort_by]} ${q.sort_dir.toUpperCase()} ${nulls}`;

  const count = await db.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...binds).first<{ n: number }>();
  const rows = await db
    .prepare(`SELECT b.id, b.name, b.address, b.zip_code, b.phone, b.niche, b.license_status, b.created_at,
                     ls.composite_acquisition_score, ls.price_tier, lo.status AS pipeline_stage
              ${from} ${orderSql} LIMIT ? OFFSET ?`)
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all();

  return c.json({ items: rows.results ?? [], total: count?.n ?? 0, page: q.page, page_size: q.page_size });
});

const DETAIL_COLUMNS = `id, name, address, zip_code, phone, email, owner_name, niche, license_number, license_status,
  license_issue_date, incorporation_date, employee_count_est, estimated_monthly_revenue, google_place_id,
  thumbtack_hires, nextdoor_recommendations, total_customer_ugc, created_at, updated_at`;

// =py schemas/business.BusinessDetail (with DigitalPresenceSummary, LeadScoreSummary, OutreachSummary)
async function loadDetail(db: D1Database, id: string) {
  const business = await db.prepare(`SELECT ${DETAIL_COLUMNS} FROM businesses WHERE id = ?`).bind(id).first<BusinessRow>();
  if (!business) return null;
  const [dp, scores, outreach] = await Promise.all([
    db.prepare(`SELECT has_website, website_url, website_quality_score, has_google_business_profile, gbp_completeness_score,
                       google_review_count, google_avg_rating, has_facebook_page, has_instagram, ig_follower_count,
                       has_google_ads, has_meta_ads, yelp_review_count, yelp_rating
                FROM digital_presences WHERE business_id = ?`).bind(id).first<DigitalPresenceRow>(),
    db.prepare(`SELECT id, score_version, digital_deficit_score, viability_score, competitive_pressure_score,
                       composite_acquisition_score, price_tier, sentiment_adjustment
                FROM lead_scores WHERE business_id = ? ORDER BY score_version DESC`).bind(id).all<LeadScoreRow>(),
    db.prepare(`SELECT id, status, retell_call_id, first_contact_date, last_contact_date, call_disposition,
                       call_attempts, meeting_scheduled, assigned_to, notes
                FROM outreach_records WHERE business_id = ? ORDER BY created_at DESC`).bind(id).all<OutreachRecordRow>(),
  ]);
  return {
    ...business,
    digital_presence: dp ? withBooleans(dp as unknown as Record<string, unknown>, DIGITAL_PRESENCE_BOOLS) as unknown as DigitalPresenceRow : null,
    lead_scores: scores.results ?? [],
    outreach_records: (outreach.results ?? []).map((r) => withBooleans(r as unknown as Record<string, unknown>, OUTREACH_BOOLS) as unknown as OutreachRecordRow),
  };
}

// =py routes/businesses.get_business
router.get('/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ detail: 'Business not found' }, 404);
  const detail = await loadDetail(c.env.DB, id);
  if (!detail) return c.json({ detail: 'Business not found' }, 404);
  return c.json(detail);
});

// =py routes/businesses.update_business
router.patch('/:id', requireAuth, requireAdmin, jsonBody(updateBody), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ detail: 'Business not found' }, 404);
  const db = c.env.DB;
  const exists = await db.prepare('SELECT id FROM businesses WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ detail: 'Business not found' }, 404);

  const body = c.req.valid('json');
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of ['name', 'address', 'phone', 'email', 'owner_name'] as const) {
    if (body[key] !== undefined) { sets.push(`${key} = ?`); binds.push(body[key]); }
  }
  if (sets.length) {
    sets.push('updated_at = ?'); binds.push(nowIso());
    await db.prepare(`UPDATE businesses SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  }
  return c.json(await loadDetail(db, id));
});

export default router;

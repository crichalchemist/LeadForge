import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { queryParams } from '../lib/validate';
import { NICHES } from '../lib/stages';
import { LATEST_OUTREACH_JOIN, LATEST_SCORE_JOIN } from './businesses';
import type { AppEnv, LeadScoreRow } from '../types';

const router = new Hono<AppEnv>();

const rankedQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  zip_code: z.string().optional(),
  niche: z.enum(NICHES).optional(),
  min_score: z.coerce.number().optional(),
  price_tier: z.coerce.number().int().optional(),
});

// =py routes/leads.get_ranked_leads
router.get('/ranked', requireAuth, queryParams(rankedQuery), async (c) => {
  const q = c.req.valid('query');
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.zip_code) { where.push('b.zip_code = ?'); binds.push(q.zip_code); }
  if (q.niche) { where.push('b.niche = ?'); binds.push(q.niche); }
  if (q.min_score !== undefined) { where.push('ls.composite_acquisition_score >= ?'); binds.push(q.min_score); }
  if (q.price_tier !== undefined) { where.push('ls.price_tier = ?'); binds.push(q.price_tier); }

  const from = `FROM businesses b ${LATEST_SCORE_JOIN} ${LATEST_OUTREACH_JOIN} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...binds).first<{ n: number }>();
  const rows = await c.env.DB
    .prepare(`SELECT b.id AS business_id, b.name AS business_name, b.zip_code, b.niche,
                     ls.composite_acquisition_score, ls.price_tier, lo.status AS pipeline_stage
              ${from}
              ORDER BY ls.composite_acquisition_score DESC NULLS LAST
              LIMIT ? OFFSET ?`)
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all();

  return c.json({ items: rows.results ?? [], total: count?.n ?? 0, page: q.page, page_size: q.page_size });
});

// =py routes/leads.get_score_history
router.get('/:business_id/score', requireAuth, async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT id, business_id, score_version, digital_deficit_score, viability_score,
                     competitive_pressure_score, composite_acquisition_score, price_tier, sentiment_adjustment
              FROM lead_scores WHERE business_id = ? ORDER BY score_version DESC`)
    .bind(c.req.param('business_id'))
    .all<Pick<LeadScoreRow, 'id' | 'business_id' | 'score_version' | 'digital_deficit_score' | 'viability_score' | 'competitive_pressure_score' | 'composite_acquisition_score' | 'price_tier' | 'sentiment_adjustment'>>();
  if (!rows.results?.length) return c.json({ detail: 'No scores found for this business' }, 404);
  return c.json(rows.results);
});

export default router;

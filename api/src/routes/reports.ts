import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { PIPELINE_STAGES } from '../lib/stages';
import { LATEST_OUTREACH_JOIN, LATEST_SCORE_JOIN } from './businesses';
import type { AppEnv } from '../types';

const router = new Hono<AppEnv>();

const CONTACTED = ['contacted', 'voicemail', 'engaged', 'meeting_scheduled', 'proposal_sent', 'negotiating', 'won'];
const ENGAGED = ['engaged', 'meeting_scheduled', 'proposal_sent', 'negotiating', 'won'];

function round(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// =py routes/reports.get_conversion_funnel
router.get('/funnel', requireAuth, async (c) => {
  const rows = await c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM outreach_records GROUP BY status').all<{ status: string; n: number }>();
  const counts = new Map((rows.results ?? []).map((r) => [r.status, r.n]));
  const stages = PIPELINE_STAGES.map((stage) => ({ stage, count: counts.get(stage) ?? 0 }));
  return c.json({ stages, total: stages.reduce((sum, s) => sum + s.count, 0) });
});

// =py routes/reports.get_score_distribution
router.get('/score-distribution', requireAuth, async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT ls.composite_acquisition_score AS score FROM businesses b ${LATEST_SCORE_JOIN}
              WHERE ls.composite_acquisition_score IS NOT NULL`)
    .all<{ score: number }>();
  const scores = (rows.results ?? []).map((r) => r.score).sort((a, b) => a - b);

  const buckets = [];
  for (let min = 0; min < 100; min += 10) {
    const max = min + 10;
    buckets.push({ range_min: min, range_max: max, count: scores.filter((s) => s >= min && (min < 90 ? s < max : s <= 100)).length });
  }
  let mean: number | null = null;
  let median: number | null = null;
  if (scores.length) {
    mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const mid = Math.floor(scores.length / 2);
    median = scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
  }
  return c.json({ buckets, total: scores.length, mean: round(mean, 2), median: round(median, 2) });
});

// =py routes/reports.get_zip_performance
router.get('/zip-performance', requireAuth, async (c) => {
  const inList = (n: number) => Array(n).fill('?').join(', ');
  const rows = await c.env.DB
    .prepare(`SELECT b.zip_code,
                     COUNT(b.id) AS total_leads,
                     AVG(ls.composite_acquisition_score) AS avg_score,
                     SUM(CASE WHEN lo.status IN (${inList(CONTACTED.length)}) THEN 1 ELSE 0 END) AS contacted,
                     SUM(CASE WHEN lo.status IN (${inList(ENGAGED.length)}) THEN 1 ELSE 0 END) AS engaged,
                     SUM(CASE WHEN lo.status = 'won' THEN 1 ELSE 0 END) AS won
              FROM businesses b ${LATEST_SCORE_JOIN} ${LATEST_OUTREACH_JOIN}
              GROUP BY b.zip_code
              ORDER BY total_leads DESC`)
    .bind(...CONTACTED, ...ENGAGED)
    .all<{ zip_code: string; total_leads: number; avg_score: number | null; contacted: number; engaged: number; won: number }>();

  const items = (rows.results ?? []).map((r) => ({
    zip_code: r.zip_code,
    total_leads: r.total_leads,
    avg_composite_score: round(r.avg_score, 2),
    contacted_count: r.contacted,
    engaged_count: r.engaged,
    won_count: r.won,
    conversion_rate: r.total_leads > 0 ? round((r.won / r.total_leads) * 100, 1) : null,
  }));
  return c.json({ items });
});

export default router;

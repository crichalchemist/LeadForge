import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { Bindings, JwtPayload } from '../types';
import { PIPELINE_STAGES } from '../lib/stages';

type Env = {
  Bindings: Bindings;
  Variables: { user: JwtPayload };
};

const router = new Hono<Env>();

// Stage groupings for zip performance. A business counts as contacted once it
// leaves 'discovered', as engaged from 'qualified' onward, and as won at 'closed'.
const CONTACTED_STAGES = ['contacted', 'qualified', 'negotiating', 'committed', 'closed'];
const ENGAGED_STAGES = ['qualified', 'negotiating', 'committed', 'closed'];
const WON_STAGE = 'closed';

function round(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// GET /api/reports/funnel — count per pipeline stage, every stage present in order
router.get('/funnel', requireAuth, async (c) => {
  const db = c.env.DB;

  const rows = await db
    .prepare('SELECT stage, COUNT(*) as count FROM pipeline_items GROUP BY stage')
    .all<{ stage: string; count: number }>();

  const counts = new Map((rows.results ?? []).map((r) => [r.stage, r.count]));
  const stages = PIPELINE_STAGES.map((stage) => ({ stage, count: counts.get(stage) ?? 0 }));
  const total = stages.reduce((sum, s) => sum + s.count, 0);

  return c.json({ stages, total });
});

// GET /api/reports/score-distribution — histogram of composite scores (one score row per business)
router.get('/score-distribution', requireAuth, async (c) => {
  const db = c.env.DB;

  const rows = await db
    .prepare('SELECT composite_acquisition_score as score FROM lead_scores')
    .all<{ score: number }>();

  const scores = (rows.results ?? []).map((r) => r.score).sort((a, b) => a - b);

  // 10 buckets of width 10; the last bucket is inclusive of 100
  const buckets = [];
  for (let min = 0; min < 100; min += 10) {
    const max = min + 10;
    const count = scores.filter((s) => s >= min && (min < 90 ? s < max : s <= 100)).length;
    buckets.push({ range_min: min, range_max: max, count });
  }

  let mean: number | null = null;
  let median: number | null = null;
  if (scores.length > 0) {
    mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const mid = Math.floor(scores.length / 2);
    median = scores.length % 2 === 1 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
  }

  return c.json({
    buckets,
    total: scores.length,
    mean: round(mean, 2),
    median: round(median, 2),
  });
});

// GET /api/reports/zip-performance — per-zip lead counts, average score, and pipeline progress
router.get('/zip-performance', requireAuth, async (c) => {
  const db = c.env.DB;

  const contactedIn = CONTACTED_STAGES.map(() => '?').join(', ');
  const engagedIn = ENGAGED_STAGES.map(() => '?').join(', ');

  const rows = await db
    .prepare(
      `SELECT
         b.zip_code,
         COUNT(b.id) as total_leads,
         AVG(ls.composite_acquisition_score) as avg_score,
         SUM(CASE WHEN lp.stage IN (${contactedIn}) THEN 1 ELSE 0 END) as contacted,
         SUM(CASE WHEN lp.stage IN (${engagedIn}) THEN 1 ELSE 0 END) as engaged,
         SUM(CASE WHEN lp.stage = ? THEN 1 ELSE 0 END) as won
       FROM businesses b
       LEFT JOIN lead_scores ls ON ls.business_id = b.id
       LEFT JOIN (
         SELECT business_id, stage FROM (
           SELECT business_id, stage,
                  ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC) AS rn
           FROM pipeline_items
         ) WHERE rn = 1
       ) lp ON lp.business_id = b.id
       WHERE b.zip_code IS NOT NULL
       GROUP BY b.zip_code
       ORDER BY total_leads DESC`
    )
    .bind(...CONTACTED_STAGES, ...ENGAGED_STAGES, WON_STAGE)
    .all<{
      zip_code: string;
      total_leads: number;
      avg_score: number | null;
      contacted: number;
      engaged: number;
      won: number;
    }>();

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

// GET /api/reports/corridor — per-corridor lead scores and grant activity
router.get('/corridor', requireAuth, async (c) => {
  const db = c.env.DB;

  const rows = await db
    .prepare(
      `SELECT
         b.nof_corridor_name,
         COUNT(b.id) as business_count,
         AVG(ls.composite_acquisition_score) as avg_score,
         COALESCE(SUM(g.applications), 0) as grant_applications,
         COALESCE(SUM(g.funded), 0) as funded_count,
         COALESCE(SUM(g.requested), 0) as total_requested,
         COALESCE(SUM(g.approved), 0) as total_approved
       FROM businesses b
       LEFT JOIN lead_scores ls ON ls.business_id = b.id
       LEFT JOIN (
         SELECT business_id,
                COUNT(*) as applications,
                SUM(CASE WHEN stage = 'funding_disbursed' THEN 1 ELSE 0 END) as funded,
                SUM(amount_requested) as requested,
                SUM(COALESCE(amount_approved, 0)) as approved
         FROM grant_applications
         GROUP BY business_id
       ) g ON g.business_id = b.id
       WHERE b.in_nof_corridor = 1 AND b.nof_corridor_name IS NOT NULL
       GROUP BY b.nof_corridor_name
       ORDER BY total_requested DESC`
    )
    .all();

  return c.json(rows.results ?? []);
});

export default router;

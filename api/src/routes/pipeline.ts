import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { jsonBody } from '../lib/validate';
import { PIPELINE_STAGES, VALID_TRANSITIONS, type PipelineStage } from '../lib/stages';
import { nowIso } from '../db/serialize';
import type { AppEnv } from '../types';

const router = new Hono<AppEnv>();

interface Card {
  outreach_id: string; business_id: string; business_name: string; zip_code: string;
  niche: string | null; call_attempts: number; last_contact: string | null;
}

// =py routes/pipeline.get_pipeline_board
router.get('/board', requireAuth, async (c) => {
  const db = c.env.DB;
  const counts = await db.prepare('SELECT status, COUNT(*) AS n FROM outreach_records GROUP BY status').all<{ status: string; n: number }>();
  const countByStage = new Map((counts.results ?? []).map((r) => [r.status, r.n]));

  const cardStmt = db.prepare(`
    SELECT o.id AS outreach_id, o.business_id, b.name AS business_name, b.zip_code, b.niche,
           o.call_attempts, o.last_contact_date AS last_contact
    FROM outreach_records o JOIN businesses b ON b.id = o.business_id
    WHERE o.status = ? ORDER BY o.updated_at DESC LIMIT 10`);
  const cardResults = await db.batch<Card>(PIPELINE_STAGES.map((stage) => cardStmt.bind(stage)));

  const columns = PIPELINE_STAGES.map((stage, i) => ({
    stage,
    count: countByStage.get(stage) ?? 0,
    cards: cardResults[i].results ?? [],
  }));
  return c.json({ columns });
});

// =py routes/pipeline.transition_stage
router.patch('/:outreach_id/stage', requireAuth, requireAdmin, jsonBody(z.object({ new_stage: z.string() })), async (c) => {
  const id = c.req.param('outreach_id');
  const { new_stage } = c.req.valid('json');
  const db = c.env.DB;

  const row = await db.prepare('SELECT status FROM outreach_records WHERE id = ?').bind(id).first<{ status: PipelineStage }>();
  if (!row) return c.json({ detail: 'Outreach record not found' }, 404);
  if (!(PIPELINE_STAGES as readonly string[]).includes(new_stage)) return c.json({ detail: `Invalid stage: ${new_stage}` }, 400);

  const allowed = VALID_TRANSITIONS[row.status];
  if (!allowed.includes(new_stage as PipelineStage)) {
    return c.json({ detail: `Cannot transition from ${row.status} to ${new_stage}. Allowed: [${allowed.map((s) => `'${s}'`).join(', ')}]` }, 422);
  }

  await db.prepare('UPDATE outreach_records SET status = ?, updated_at = ? WHERE id = ?').bind(new_stage, nowIso(), id).run();
  return c.json({ status: 'ok', outreach_id: id, new_stage });
});

export default router;

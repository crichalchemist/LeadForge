import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { jsonBody } from '../lib/validate';
import { nowIso, withBooleans, OUTREACH_BOOLS } from '../db/serialize';
import type { AppEnv, OutreachRecordRow } from '../types';

const router = new Hono<AppEnv>();
const serialize = (row: OutreachRecordRow) => withBooleans<Pick<OutreachRecordRow, keyof OutreachRecordRow>>(row, OUTREACH_BOOLS);

// =py routes/outreach.get_outreach_history
router.get('/by-business/:business_id', requireAuth, async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM outreach_records WHERE business_id = ? ORDER BY created_at DESC')
    .bind(c.req.param('business_id')).all<OutreachRecordRow>();
  const items = (rows.results ?? []).map(serialize);
  return c.json({ items, total: items.length });
});

// =py routes/outreach.get_outreach
router.get('/:id', requireAuth, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM outreach_records WHERE id = ?').bind(c.req.param('id')).first<OutreachRecordRow>();
  if (!row) return c.json({ detail: 'Outreach record not found' }, 404);
  return c.json(serialize(row));
});

// =py routes/outreach.get_transcript
router.get('/:id/transcript', requireAuth, async (c) => {
  const row = await c.env.DB.prepare('SELECT call_transcript, retell_call_id FROM outreach_records WHERE id = ?')
    .bind(c.req.param('id')).first<{ call_transcript: string | null; retell_call_id: string | null }>();
  if (!row) return c.json({ detail: 'Outreach record not found' }, 404);
  return c.json({ transcript: row.call_transcript, retell_call_id: row.retell_call_id });
});

// =py routes/outreach.update_outreach
router.patch('/:id', requireAuth, requireAdmin, jsonBody(z.object({ notes: z.string().nullable().optional(), assigned_to: z.string().nullable().optional() })), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM outreach_records WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ detail: 'Outreach record not found' }, 404);

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of ['notes', 'assigned_to'] as const) {
    if (body[key] !== undefined) { sets.push(`${key} = ?`); binds.push(body[key]); }
  }
  if (sets.length) {
    sets.push('updated_at = ?'); binds.push(nowIso());
    await db.prepare(`UPDATE outreach_records SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  }
  const row = await db.prepare('SELECT * FROM outreach_records WHERE id = ?').bind(id).first<OutreachRecordRow>();
  return c.json(serialize(row!));
});

export default router;

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId } from '../lib/jwt';
import { getById, deleteById } from '../db/queries';
import { Bindings, JwtPayload, PipelineItem } from '../types';

type Env = {
  Bindings: Bindings;
  Variables: { user: JwtPayload };
};

const router = new Hono<Env>();

const PIPELINE_STAGES = ['discovered', 'contacted', 'qualified', 'negotiating', 'committed', 'closed', 'lost'] as const;

const createPipelineSchema = z.object({
  business_id: z.string(),
  stage: z.enum(PIPELINE_STAGES).default('discovered'),
  assigned_to: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updatePipelineSchema = z.object({
  stage: z.enum(PIPELINE_STAGES).optional(),
  assigned_to: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// GET /api/pipeline — kanban board view
router.get('/', requireAuth, async (c) => {
  const db = c.env.DB;
  const stage = c.req.query('stage');
  const assignedTo = c.req.query('assigned_to');

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (stage) { conditions.push('p.stage = ?'); bindings.push(stage); }
  if (assignedTo) { conditions.push('p.assigned_to = ?'); bindings.push(assignedTo); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Aggregated kanban counts per stage
  const stageCounts = await db
    .prepare(
      `SELECT stage, COUNT(*) as count FROM pipeline_items ${where} GROUP BY stage ORDER BY stage`
    )
    .bind(...bindings)
    .all<{ stage: string; count: number }>();

  // Data with business join
  const data = await db
    .prepare(
      `SELECT p.*, b.name as business_name, b.niche, b.zip_code, b.city, b.state
       FROM pipeline_items p
       JOIN businesses b ON p.business_id = b.id
       ${where}
       ORDER BY p.updated_at DESC`
    )
    .bind(...bindings)
    .all();

  return c.json({
    stages: stageCounts.results ?? [],
    items: data.results ?? [],
  });
});

// GET /api/pipeline/:id
router.get('/:id', requireAuth, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const item = await db
    .prepare(
      `SELECT p.*, b.name as business_name, b.niche, b.zip_code, b.city, b.state
       FROM pipeline_items p
       JOIN businesses b ON p.business_id = b.id
       WHERE p.id = ?`
    )
    .bind(id)
    .first();
  if (!item) return c.json({ error: 'Pipeline item not found' }, 404);
  return c.json(item);
});

// POST /api/pipeline — add item (often auto-added during enrichment)
router.post('/', requireAuth, requireAdmin, zValidator('json', createPipelineSchema), async (c) => {
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = generateId();

  await db
    .prepare(
      `INSERT INTO pipeline_items (id, business_id, stage, assigned_to, notes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, data.business_id, data.stage, data.assigned_to ?? null, data.notes ?? null)
    .run();

  const created = await getById<PipelineItem>(db, 'pipeline_items', id);
  return c.json(created, 201);
});

// PATCH /api/pipeline/:id — move stage (drag & drop)
router.patch('/:id', requireAuth, requireAdmin, zValidator('json', updatePipelineSchema), async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const data = c.req.valid('json');

  const existing = await getById<PipelineItem>(db, 'pipeline_items', id);
  if (!existing) return c.json({ error: 'Pipeline item not found' }, 404);

  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value ?? null);
    }
  }

  if (fields.length === 0) return c.json(existing);

  values.push(id);
  await db
    .prepare(`UPDATE pipeline_items SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await getById<PipelineItem>(db, 'pipeline_items', id);
  return c.json(updated);
});

// DELETE /api/pipeline/:id
router.delete('/:id', requireAuth, requireAdmin, async (c) => {
  const db = c.env.DB;
  const deleted = await deleteById(db, 'pipeline_items', c.req.param('id')!);
  if (!deleted) return c.json({ error: 'Pipeline item not found' }, 404);
  return c.json({ deleted: true });
});

export default router;

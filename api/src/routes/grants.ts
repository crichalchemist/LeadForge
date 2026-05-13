import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId } from '../lib/jwt';
import { getById, deleteById } from '../db/queries';
import { calculateGrantFunding } from '../lib/grants';
import { Bindings, Business, JwtPayload } from '../types';

type Env = {
  Bindings: Bindings;
  Variables: { user: JwtPayload };
};

const router = new Hono<Env>();

const GRANT_STAGES = [
  'identified', 'eligibility_check', 'documents_pending', 'documents_submitted',
  'under_review', 'additional_info', 'approved', 'funding_disbursed',
  'declined', 'withdrawn'
] as const;

const createGrantSchema = z.object({
  business_id: z.string(),
  corridor_name: z.string(),
  amount_requested: z.number().min(0),
});

const updateGrantSchema = z.object({
  stage: z.enum(GRANT_STAGES).optional(),
  amount_approved: z.number().optional().nullable(),
  status: z.string().optional(),
  amount_requested: z.number().optional(),
});

// GET /api/grants
router.get('/', requireAuth, async (c) => {
  const db = c.env.DB;
  const pageRaw = parseInt(c.req.query('page') ?? '1');
  const perPageRaw = parseInt(c.req.query('per_page') ?? '50');
  if (isNaN(pageRaw) || pageRaw < 1) return c.json({ error: 'Invalid page' }, 400);
  if (isNaN(perPageRaw) || perPageRaw < 1) return c.json({ error: 'Invalid per_page' }, 400);
  const page = pageRaw;
  const perPage = Math.min(perPageRaw, 200);
  const offset = (page - 1) * perPage;
  const businessId = c.req.query('business_id');
  const corridorName = c.req.query('corridor_name');
  const stage = c.req.query('stage');

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (businessId) { conditions.push('ga.business_id = ?'); bindings.push(businessId); }
  if (corridorName) { conditions.push('ga.corridor_name = ?'); bindings.push(corridorName); }
  if (stage) { conditions.push('ga.stage = ?'); bindings.push(stage); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const fromJoin = 'grant_applications ga JOIN businesses b ON b.id = ga.business_id';

  // Count
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM ${fromJoin} ${where}`);
  const countResult = bindings.length > 0
    ? await countStmt.bind(...bindings).first<{ count: number }>()
    : await countStmt.first<{ count: number }>();
  const total = countResult?.count ?? 0;

  // Data
  const data = await db
    .prepare(`SELECT ga.*, b.name as business_name, b.niche, b.in_nof_corridor FROM ${fromJoin} ${where} ORDER BY ga.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, perPage, offset)
    .all();

  return c.json({ data: data.results ?? [], total, page, perPage });
});

// GET /api/grants/board/summary — aggregate grant board overview
router.get('/board/summary', requireAuth, async (c) => {
  const db = c.env.DB;

  const byStage = await db.prepare(`
    SELECT stage, COUNT(*) as count, COALESCE(SUM(amount_requested), 0) as total_requested
    FROM grant_applications WHERE status = 'active'
    GROUP BY stage ORDER BY CASE stage
      WHEN 'identified' THEN 1 WHEN 'eligibility_check' THEN 2
      WHEN 'documents_pending' THEN 3 WHEN 'documents_submitted' THEN 4
      WHEN 'under_review' THEN 5 WHEN 'additional_info' THEN 6
      WHEN 'approved' THEN 7 WHEN 'funding_disbursed' THEN 8
      WHEN 'declined' THEN 9 WHEN 'withdrawn' THEN 10
      ELSE 99 END
  `).all();

  const total = await db.prepare(`
    SELECT COUNT(*) as total, COALESCE(SUM(amount_requested), 0) as total_requested,
           COALESCE(SUM(amount_approved), 0) as total_approved
    FROM grant_applications WHERE status = 'active'
  `).first<{ total: number; total_requested: number; total_approved: number }>();

  return c.json({
    by_stage: byStage.results ?? [],
    total: total?.total ?? 0,
    total_requested: total?.total_requested ?? 0,
    total_approved: total?.total_approved ?? 0,
  });
});

// GET /api/grants/:id
router.get('/:id', requireAuth, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const grant = await db.prepare(`
    SELECT ga.*, b.name as business_name, b.niche, b.address,
           b.latitude, b.longitude, b.in_nof_corridor
    FROM grant_applications ga
    JOIN businesses b ON b.id = ga.business_id
    WHERE ga.id = ?
  `).bind(id).first();

  if (!grant) return c.json({ error: 'Grant application not found' }, 404);
  return c.json(grant);
});

// POST /api/grants
router.post('/', requireAuth, requireAdmin, zValidator('json', createGrantSchema), async (c) => {
  const db = c.env.DB;
  const { business_id, corridor_name, amount_requested } = c.req.valid('json');
  const id = generateId();

  await db.prepare(`
    INSERT INTO grant_applications (id, business_id, corridor_name, amount_requested)
    VALUES (?, ?, ?, ?)
  `).bind(id, business_id, corridor_name, amount_requested).run();

  const created = await getById(db, 'grant_applications', id);
  return c.json(created, 201);
});

// PATCH /api/grants/:id
router.patch('/:id', requireAuth, requireAdmin, zValidator('json', updateGrantSchema), async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const data = c.req.valid('json');

  const existing = await getById(db, 'grant_applications', id);
  if (!existing) return c.json({ error: 'Grant not found' }, 404);

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
  await db.prepare(`UPDATE grant_applications SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...values).run();

  const updated = await getById(db, 'grant_applications', id);
  return c.json(updated);
});

// POST /api/grants/financial-calculator — estimate grant funding
router.post('/financial-calculator', requireAuth, zValidator('json', z.object({
  business_id: z.string(),
})), async (c) => {
  const db = c.env.DB;
  const { business_id } = c.req.valid('json');

  const business = await getById<Business>(db, 'businesses', business_id);
  if (!business) return c.json({ error: 'Business not found' }, 404);

  // Get latest score
  const score = await db.prepare(
    'SELECT * FROM lead_scores WHERE business_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(business_id).first<{ digital_deficit_score: number }>();

  const result = calculateGrantFunding({
    business_annual_revenue: null,
    employee_count: null,
    years_in_business: 3,
    in_corridor: (business as any).in_nof_corridor === 1,
    digital_deficit_score: score?.digital_deficit_score ?? 50,
  });

  return c.json(result);
});

// GET /api/grants/:id/documents
router.get('/:id/documents', requireAuth, async (c) => {
  const db = c.env.DB;
  const docs = await db.prepare(
    'SELECT * FROM grant_documents WHERE grant_application_id = ?'
  ).bind(c.req.param('id')!).all();

  return c.json(docs.results ?? []);
});

// POST /api/grants/:id/documents
router.post('/:id/documents', requireAuth, requireAdmin, zValidator('json', z.object({
  filename: z.string(),
  file_url: z.string().optional().nullable(),
})), async (c) => {
  const db = c.env.DB;
  const { filename, file_url } = c.req.valid('json');
  const id = generateId();
  const grantId = c.req.param('id')!;

  await db.prepare(
    'INSERT INTO grant_documents (id, grant_application_id, filename, file_url) VALUES (?, ?, ?, ?)'
  ).bind(id, grantId, filename, file_url ?? null).run();

  const doc = await getById(db, 'grant_documents', id);
  return c.json(doc, 201);
});

export default router;

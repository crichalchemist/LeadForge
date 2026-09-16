import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId } from '../lib/jwt';
import { jsonBody, queryParams } from '../lib/validate';
import { computeGrantFinancials } from '../lib/grants';
import { BOARD_GROUPS, NOF_STAGES, VALID_NOF_TRANSITIONS, type NofStage } from '../lib/stages';
import { nowIso, withBooleans, DOCUMENT_BOOLS, GRANT_BOOLS } from '../db/serialize';
import type { AppEnv, GrantApplicationRow, GrantDocumentRow } from '../types';

const router = new Hono<AppEnv>();
const serializeGrant = (row: GrantApplicationRow) => withBooleans<Pick<GrantApplicationRow, keyof GrantApplicationRow>>(row, GRANT_BOOLS);
const serializeDoc = (row: GrantDocumentRow) => withBooleans<Pick<GrantDocumentRow, keyof GrantDocumentRow>>(row, DOCUMENT_BOOLS);

async function loadGrant(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM grant_applications WHERE id = ?').bind(id).first<GrantApplicationRow>();
}

const listQuery = z.object({
  status: z.string().optional(),
  corridor_name: z.string().optional(),
  business_id: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createBody = z.object({
  business_id: z.string(),
  total_project_cost: z.number().nullable().optional(),
  acquisition_cost: z.number().nullable().optional(),
  project_description: z.string().nullable().optional(),
});

const UPDATE_FIELDS = [
  'total_project_cost', 'base_grant_amount', 'acquisition_cost', 'taf_amount', 'owner_contribution',
  'financing_amount', 'financing_verified', 'gc_bid_amount', 'project_description', 'exterior_work_pct',
  'has_site_control', 'site_control_type', 'assigned_to', 'ta_provider', 'notes',
] as const;
const num = z.number().nullable().optional();
const str = z.string().nullable().optional();
const bool = z.boolean().nullable().optional();
const updateBody = z.object({
  total_project_cost: num, base_grant_amount: num, acquisition_cost: num, taf_amount: num, owner_contribution: num,
  financing_amount: num, financing_verified: bool, gc_bid_amount: num, project_description: str, exterior_work_pct: num,
  has_site_control: bool, site_control_type: str, assigned_to: str, ta_provider: str, notes: str,
});

const docUpdateBody = z.object({ status: str, notes: str, received_date: str, reviewed_date: str });

// =py routes/grants.get_grant_board
router.get('/board', requireAuth, async (c) => {
  const db = c.env.DB;
  const counts = await db.prepare('SELECT status, COUNT(*) AS n FROM grant_applications GROUP BY status').all<{ status: string; n: number }>();
  const countByStage = new Map((counts.results ?? []).map((r) => [r.status, r.n]));

  const cardStmt = db.prepare(`
    SELECT g.id AS grant_id, g.business_id, b.name AS business_name, g.corridor_name,
           g.base_grant_amount AS estimated_grant, g.updated_at
    FROM grant_applications g JOIN businesses b ON b.id = g.business_id
    WHERE g.status = ? ORDER BY g.updated_at DESC LIMIT 10`);
  const results = await db.batch<{ grant_id: string; business_id: string; business_name: string; corridor_name: string | null; estimated_grant: number | null; updated_at: string }>(
    BOARD_GROUPS.map((stage) => cardStmt.bind(stage))
  );
  const now = Date.now();
  const columns = BOARD_GROUPS.map((stage, i) => ({
    stage,
    count: countByStage.get(stage) ?? 0,
    cards: (results[i].results ?? []).map(({ updated_at, ...card }) => ({
      ...card,
      days_in_stage: Math.max(0, Math.floor((now - Date.parse(updated_at)) / 86_400_000)),
    })),
  }));
  return c.json({ columns });
});

// =py routes/grants.get_grant_financials
router.get('/financials/:grant_id', requireAuth, async (c) => {
  const grant = await loadGrant(c.env.DB, c.req.param('grant_id')!);
  if (!grant) return c.json({ detail: 'Grant application not found' }, 404);
  return c.json(computeGrantFinancials(grant.total_project_cost ?? 0, grant.acquisition_cost ?? 0));
});

// =py routes/grants.get_grant
router.get('/:grant_id', requireAuth, async (c) => {
  const grant = await loadGrant(c.env.DB, c.req.param('grant_id')!);
  if (!grant) return c.json({ detail: 'Grant application not found' }, 404);
  return c.json(serializeGrant(grant));
});

// =py routes/grants.list_grants
router.get('/', requireAuth, queryParams(listQuery), async (c) => {
  const q = c.req.valid('query');
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status !== undefined) {
    if (!(NOF_STAGES as readonly string[]).includes(q.status)) return c.json({ detail: `Invalid status: ${q.status}` }, 400);
    where.push('status = ?'); binds.push(q.status);
  }
  if (q.corridor_name) { where.push('corridor_name = ?'); binds.push(q.corridor_name); }
  if (q.business_id) { where.push('business_id = ?'); binds.push(q.business_id); }
  const rows = await c.env.DB
    .prepare(`SELECT * FROM grant_applications ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all<GrantApplicationRow>();
  return c.json((rows.results ?? []).map(serializeGrant));
});

// =py routes/grants.create_grant
router.post('/', requireAuth, requireAdmin, jsonBody(createBody), async (c) => {
  const body = c.req.valid('json');
  const db = c.env.DB;
  const biz = await db.prepare('SELECT id FROM businesses WHERE id = ?').bind(body.business_id).first();
  if (!biz) return c.json({ detail: 'Business not found' }, 404);

  const id = generateId();
  await db.prepare(
    `INSERT INTO grant_applications (id, business_id, status, total_project_cost, acquisition_cost, project_description)
     VALUES (?, ?, 'eligibility_assessed', ?, ?, ?)`
  ).bind(id, body.business_id, body.total_project_cost ?? null, body.acquisition_cost ?? null, body.project_description ?? null).run();
  console.log('grant_application_created', { grant_id: id });
  return c.json(serializeGrant((await loadGrant(db, id))!), 201);
});

// =py routes/grants.update_grant
router.patch('/:grant_id', requireAuth, requireAdmin, jsonBody(updateBody), async (c) => {
  const id = c.req.param('grant_id');
  const db = c.env.DB;
  if (!(await loadGrant(db, id))) return c.json({ detail: 'Grant application not found' }, 404);

  const body = c.req.valid('json');
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of UPDATE_FIELDS) {
    const value = body[key];
    if (value !== undefined) { sets.push(`${key} = ?`); binds.push(typeof value === 'boolean' ? (value ? 1 : 0) : value); }
  }
  if (sets.length) {
    sets.push('updated_at = ?'); binds.push(nowIso());
    await db.prepare(`UPDATE grant_applications SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  }
  return c.json(serializeGrant((await loadGrant(db, id))!));
});

// =py routes/grants.transition_grant_stage
router.patch('/:grant_id/stage', requireAuth, requireAdmin, jsonBody(z.object({ new_stage: z.string() })), async (c) => {
  const id = c.req.param('grant_id');
  const { new_stage } = c.req.valid('json');
  const db = c.env.DB;
  const grant = await loadGrant(db, id);
  if (!grant) return c.json({ detail: 'Grant application not found' }, 404);
  if (!(NOF_STAGES as readonly string[]).includes(new_stage)) return c.json({ detail: `Invalid stage: ${new_stage}` }, 400);

  const allowed = VALID_NOF_TRANSITIONS[grant.status];
  if (!allowed.includes(new_stage as NofStage)) {
    return c.json({ detail: `Cannot transition from ${grant.status} to ${new_stage}. Allowed: [${allowed.map((s) => `'${s}'`).join(', ')}]` }, 422);
  }
  await db.prepare('UPDATE grant_applications SET status = ?, updated_at = ? WHERE id = ?').bind(new_stage, nowIso(), id).run();
  return c.json({ status: 'ok', grant_id: id, new_stage });
});

// =py routes/grants.list_grant_documents
router.get('/:grant_id/documents', requireAuth, async (c) => {
  const id = c.req.param('grant_id')!;
  const db = c.env.DB;
  if (!(await loadGrant(db, id))) return c.json({ detail: 'Grant application not found' }, 404);
  const rows = await db.prepare('SELECT * FROM grant_documents WHERE grant_application_id = ?').bind(id).all<GrantDocumentRow>();
  return c.json((rows.results ?? []).map(serializeDoc));
});

// =py routes/grants.update_grant_document
router.patch('/:grant_id/documents/:doc_id', requireAuth, requireAdmin, jsonBody(docUpdateBody), async (c) => {
  const grantId = c.req.param('grant_id');
  const docId = c.req.param('doc_id');
  const db = c.env.DB;
  const doc = await db.prepare('SELECT * FROM grant_documents WHERE id = ? AND grant_application_id = ?').bind(docId, grantId).first<GrantDocumentRow>();
  if (!doc) return c.json({ detail: 'Grant document not found' }, 404);

  const body = c.req.valid('json');
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of ['status', 'notes', 'received_date', 'reviewed_date'] as const) {
    if (body[key] !== undefined) { sets.push(`${key} = ?`); binds.push(body[key]); }
  }
  if (sets.length) {
    sets.push('updated_at = ?'); binds.push(nowIso());
    await db.prepare(`UPDATE grant_documents SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, docId).run();
  }
  const updated = await db.prepare('SELECT * FROM grant_documents WHERE id = ?').bind(docId).first<GrantDocumentRow>();
  return c.json(serializeDoc(updated!));
});

export default router;

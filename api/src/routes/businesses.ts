import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId } from '../lib/jwt';
import { paginatedList, getById, deleteById } from '../db/queries';
import { Bindings, Business, JwtPayload } from '../types';

const router = new Hono<{ Bindings: Bindings; Variables: { user: JwtPayload } }>();

const createBusinessSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip_code: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  phone: z.string().optional().nullable(),
  niche: z.string().optional().nullable(),
  license_status: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
});

const updateBusinessSchema = createBusinessSchema.partial();

// GET /api/businesses
router.get('/', requireAuth, async (c) => {
  const db = c.env.DB;
  const pageRaw = parseInt(c.req.query('page') ?? '1');
  const perPageRaw = parseInt(c.req.query('per_page') ?? '50');
  if (isNaN(pageRaw) || pageRaw < 1) return c.json({ error: 'Invalid page' }, 400);
  if (isNaN(perPageRaw) || perPageRaw < 1) return c.json({ error: 'Invalid per_page' }, 400);
  const page = pageRaw;
  const perPage = Math.min(perPageRaw, 200);
  const niche = c.req.query('niche');
  const zip = c.req.query('zip_code');
  const inCorridor = c.req.query('in_corridor');
  const search = c.req.query('search');

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (niche) { conditions.push('niche = ?'); bindings.push(niche); }
  if (zip) { conditions.push('zip_code = ?'); bindings.push(zip); }
  if (inCorridor !== undefined) { conditions.push('in_nof_corridor = ?'); bindings.push(inCorridor === 'true' ? 1 : 0); }
  if (search) { conditions.push('(name LIKE ? OR address LIKE ? OR phone LIKE ?)'); bindings.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const where = conditions.length > 0 ? conditions.join(' AND ') : undefined;

  const result = await paginatedList<Business>(db, 'businesses', '*', {
    page, perPage, where, orderBy: 'name ASC',
  });

  return c.json(result);
});

// GET /api/businesses/:id
router.get('/:id', requireAuth, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const business = await getById<Business>(db, 'businesses', id);
  if (!business) return c.json({ error: 'Business not found' }, 404);
  return c.json(business);
});

// POST /api/businesses
router.post('/', requireAuth, requireAdmin, zValidator('json', createBusinessSchema), async (c) => {
  const db = c.env.DB;
  const data = c.req.valid('json');
  const id = generateId();

  await db.prepare(`
    INSERT INTO businesses (id, name, address, city, state, zip_code, latitude, longitude, phone, niche, license_status, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, data.name, data.address ?? null, data.city ?? null,
    data.state ?? null, data.zip_code ?? null, data.latitude ?? null,
    data.longitude ?? null, data.phone ?? null, data.niche ?? null,
    data.license_status ?? null, data.source ?? null
  ).run();

  const created = await getById<Business>(db, 'businesses', id);
  return c.json(created, 201);
});

// PATCH /api/businesses/:id
router.patch('/:id', requireAuth, requireAdmin, zValidator('json', updateBusinessSchema), async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const data = c.req.valid('json');

  const existing = await getById<Business>(db, 'businesses', id);
  if (!existing) return c.json({ error: 'Business not found' }, 404);

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
  await db.prepare(`UPDATE businesses SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...values).run();

  const updated = await getById<Business>(db, 'businesses', id);
  return c.json(updated);
});

// DELETE /api/businesses/:id
router.delete('/:id', requireAuth, requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const deleted = await deleteById(db, 'businesses', id);
  if (!deleted) return c.json({ error: 'Business not found' }, 404);
  return c.json({ deleted: true });
});

export default router;

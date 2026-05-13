import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId } from '../lib/jwt';
import { paginatedList, getById } from '../db/queries';
import { Bindings, JwtPayload, OutreachRecord } from '../types';

type Env = {
  Bindings: Bindings;
  Variables: { user: JwtPayload };
};

const router = new Hono<Env>();

const createOutreachSchema = z.object({
  business_id: z.string(),
  call_id: z.string().optional().nullable(),
  status: z.string().default('pending'),
  disposition: z.string().optional().nullable(),
});

// GET /api/outreach
router.get('/', requireAuth, async (c) => {
  const db = c.env.DB;
  const page = parseInt(c.req.query('page') ?? '1');
  const perPage = Math.min(parseInt(c.req.query('per_page') ?? '50'), 200);
  const businessId = c.req.query('business_id');
  const status = c.req.query('status');

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (businessId) { conditions.push('outreach_records.business_id = ?'); bindings.push(businessId); }
  if (status) { conditions.push('outreach_records.status = ?'); bindings.push(status); }

  const where = conditions.length > 0 ? conditions.join(' AND ') : undefined;

  const result = await paginatedList<OutreachRecord>(
    db, 'outreach_records', 'outreach_records.*, b.name as business_name',
    {
      page, perPage, where,
      orderBy: 'outreach_records.created_at DESC',
    }
  );

  return c.json(result);
});

// GET /api/outreach/:id
router.get('/:id', requireAuth, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const record = await db.prepare(`
    SELECT o.*, b.name as business_name, b.phone, b.niche
    FROM outreach_records o
    JOIN businesses b ON b.id = o.business_id
    WHERE o.id = ?
  `).bind(id).first();

  if (!record) return c.json({ error: 'Outreach record not found' }, 404);
  return c.json(record);
});

// POST /api/outreach
router.post('/', requireAuth, requireAdmin, zValidator('json', createOutreachSchema), async (c) => {
  const db = c.env.DB;
  const { business_id, call_id, status, disposition } = c.req.valid('json');
  const id = generateId();

  await db.prepare(`
    INSERT INTO outreach_records (id, business_id, call_id, status, disposition)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, business_id, call_id ?? null, status, disposition ?? null).run();

  const created = await getById(db, 'outreach_records', id);
  return c.json(created, 201);
});

// PATCH /api/outreach/:id — update call result
router.patch('/:id', requireAuth, requireAdmin, zValidator('json', z.object({
  status: z.string().optional(),
  duration: z.number().optional(),
  transcript: z.string().optional().nullable(),
  disposition: z.string().optional().nullable(),
  sentiment_score: z.number().optional().nullable(),
})), async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const data = c.req.valid('json');

  const existing = await getById<OutreachRecord>(db, 'outreach_records', id);
  if (!existing) return c.json({ error: 'Outreach record not found' }, 404);

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
  await db.prepare(`UPDATE outreach_records SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await getById(db, 'outreach_records', id);
  return c.json(updated);
});

// Retell AI webhook handler — public (no auth, HMAC verified)
router.post('/webhook/retell', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  // Validate Retell HMAC signature
  const signature = c.req.header('X-Retell-Signature');
  const secret: string | undefined = (c.env as any).RETELL_WEBHOOK_SECRET;
  if (secret && signature) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const bodyText = JSON.stringify(body);
    const sigBytes = hexToBytes(signature);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(bodyText));
    if (!valid) return c.json({ error: 'Invalid signature' }, 401);
  }

  // Retell sends call completion events
  const { call_id, call_status, transcript, disposition, sentiment_score } = body;

  if (call_id) {
    await db.prepare(`
      UPDATE outreach_records
      SET status = ?, transcript = ?, disposition = ?, sentiment_score = ?,
          called_at = datetime('now')
      WHERE call_id = ?
    `).bind(call_status ?? 'completed', transcript ?? null, disposition ?? null,
           sentiment_score ?? null, call_id).run();

    // Queue sentiment analysis if we have transcript data
    if (transcript && sentiment_score === undefined) {
      try {
        await c.env.SENTIMENT_QUEUE.send({
          type: 'analyze_sentiment',
          call_id,
          transcript: transcript.slice(0, 10000),
        });
      } catch (e) {
        console.error('Failed to queue sentiment analysis:', e);
      }
    }
  }

  return c.json({ received: true });
});

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export default router;

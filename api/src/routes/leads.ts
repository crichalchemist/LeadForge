import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId } from '../lib/jwt';
import { calculateScores, ScoreInput } from '../lib/scoring';
import { getById, deleteById } from '../db/queries';
import {
  Bindings,
  JwtPayload,
  LeadScore,
  Business,
  DigitalPresence,
  CompetitiveContext,
} from '../types';

type Env = {
  Bindings: Bindings;
  Variables: { user: JwtPayload };
};

const router = new Hono<Env>();

// GET /api/leads — list all lead scores sorted by composite score descending
router.get('/', requireAuth, async (c) => {
  const db = c.env.DB;
  const page = parseInt(c.req.query('page') ?? '1');
  const perPage = Math.min(parseInt(c.req.query('per_page') ?? '50'), 200);
  const minScore = c.req.query('min_score');
  const maxScore = c.req.query('max_score');
  const niche = c.req.query('niche');
  const zip = c.req.query('zip_code');

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (minScore) {
    conditions.push('ls.composite_acquisition_score >= ?');
    bindings.push(parseInt(minScore));
  }
  if (maxScore) {
    conditions.push('ls.composite_acquisition_score <= ?');
    bindings.push(parseInt(maxScore));
  }
  if (niche) {
    conditions.push('b.niche = ?');
    bindings.push(niche);
  }
  if (zip) {
    conditions.push('b.zip_code = ?');
    bindings.push(zip);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * perPage;

  // Count
  const fromClause = 'lead_scores ls JOIN businesses b ON ls.business_id = b.id';
  const countStmt = db.prepare(
    `SELECT COUNT(*) as count FROM ${fromClause} ${where}`
  );
  const countResult = bindings.length > 0
    ? await countStmt.bind(...bindings).first<{ count: number }>()
    : await countStmt.first<{ count: number }>();
  const total = countResult?.count ?? 0;

  // Data
  const data = await db
    .prepare(
      `SELECT ls.*, b.name, b.niche, b.zip_code, b.city, b.state
       FROM ${fromClause}
       ${where}
       ORDER BY ls.composite_acquisition_score DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...bindings, perPage, offset)
    .all();

  return c.json({ data: data.results ?? [], total, page, perPage });
});

// GET /api/leads/:id — single lead score
router.get('/:id', requireAuth, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const score = await getById<LeadScore>(db, 'lead_scores', id);
  if (!score) return c.json({ error: 'Lead score not found' }, 404);
  return c.json(score);
});

// POST /api/leads/calculate/:businessId — calculate or recalculate score for a business
router.post('/calculate/:businessId', requireAuth, async (c) => {
  const db = c.env.DB;
  const businessId = c.req.param('businessId')!;

  const business = await getById<Business>(db, 'businesses', businessId);
  if (!business) return c.json({ error: 'Business not found' }, 404);

  // Fetch digital presence
  const dp = await db
    .prepare('SELECT * FROM digital_presence WHERE business_id = ?')
    .bind(businessId)
    .first<DigitalPresence>();

  // Fetch competitive context
  const ctx =
    business.zip_code && business.niche
      ? await db
          .prepare(
            'SELECT * FROM competitive_contexts WHERE zip_code = ? AND niche = ?'
          )
          .bind(business.zip_code, business.niche)
          .first<CompetitiveContext>()
      : null;

  const input: ScoreInput = {
    digitalPresence: dp ?? null,
    competitiveAvgRating: ctx?.avg_rating ?? null,
    competitiveReviewCount: ctx?.total_reviews ?? null,
    businessDensity: ctx?.business_density ?? null,
  };

  const scores = calculateScores(input);
  const id = generateId();
  const now = new Date().toISOString();

  // Upsert: delete existing score for this business, then insert (atomic batch)
  const deleteStmt = db
    .prepare('DELETE FROM lead_scores WHERE business_id = ?')
    .bind(businessId);
  const insertStmt = db
    .prepare(
      `INSERT INTO lead_scores (id, business_id, score_version, digital_deficit_score, viability_score, competitive_pressure_score, composite_acquisition_score, price_tier, calculated_at)
       VALUES (?, ?, 'v1', ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      businessId,
      scores.digital_deficit_score,
      scores.viability_score,
      scores.competitive_pressure_score,
      scores.composite_acquisition_score,
      scores.price_tier,
      now
    );
  await db.batch([deleteStmt, insertStmt]);

  return c.json(
    { id, business_id: businessId, ...scores, calculated_at: now },
    201
  );
});

// DELETE /api/leads/:id
router.delete('/:id', requireAuth, requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const deleted = await deleteById(db, 'lead_scores', id);
  if (!deleted) return c.json({ error: 'Lead score not found' }, 404);
  return c.json({ deleted: true });
});

export default router;

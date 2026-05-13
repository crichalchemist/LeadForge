import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { signToken, verifyToken, generateId, hashPassword, verifyPassword } from '../lib/jwt';
import { requireAuth } from '../middleware/auth';
import { Bindings, JwtPayload } from '../types';

const router = new Hono<{ Bindings: Bindings; Variables: { user: JwtPayload } }>();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

// POST /api/auth/login
router.post('/login', zValidator('json', loginSchema), async (c) => {
  const JWT_SECRET = (c.env as any).JWT_SECRET ?? 'dev-jwt-secret-change-in-production';
  const { email, password } = c.req.valid('json');
  const db = c.env.DB;

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<any>();
  if (!user) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const valid = await verifyPassword(password, user.id, user.password_hash);
  if (!valid) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const token = await signToken(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    3600
  );

  const refreshToken = await signToken(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    30 * 24 * 3600
  );

  return c.json({
    access_token: token,
    refresh_token: refreshToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

// POST /api/auth/refresh
router.post('/refresh', zValidator('json', z.object({ refresh_token: z.string() })), async (c) => {
  const JWT_SECRET = (c.env as any).JWT_SECRET ?? 'dev-jwt-secret-change-in-production';
  const { refresh_token } = c.req.valid('json');
  const payload = await verifyToken(refresh_token, JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }

  const token = await signToken(
    { sub: payload.sub, email: payload.email, role: payload.role },
    JWT_SECRET,
    3600
  );

  return c.json({ access_token: token });
});

// POST /api/auth/signup
router.post('/signup', zValidator('json', signupSchema), async (c) => {
  const JWT_SECRET = (c.env as any).JWT_SECRET ?? 'dev-jwt-secret-change-in-production';
  const { email, password, name } = c.req.valid('json');
  const db = c.env.DB;

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  const id = generateId();
  const passwordHash = await hashPassword(password, id);

  await db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').bind(id, email, passwordHash, name, 'viewer').run();

  return c.json({ id, email, name, role: 'viewer' }, 201);
});

// GET /api/auth/me
router.get('/me', requireAuth, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const record = await db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').bind(user.sub).first();
  if (!record) return c.json({ error: 'User not found' }, 404);

  return c.json(record);
});

export default router;

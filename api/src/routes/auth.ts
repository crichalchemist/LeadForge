import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId, requireSecret, signToken, verifyToken } from '../lib/jwt';
import { hashPassword, verifyPassword } from '../lib/password';
import { jsonBody } from '../lib/validate';
import { nowIso, withBooleans, USER_BOOLS } from '../db/serialize';
import type { AppEnv, UserRow } from '../types';

const ACCESS_TOKEN_EXPIRE_MINUTES = 60;
const REFRESH_TOKEN_EXPIRE_DAYS = 30;

const router = new Hono<AppEnv>();

const loginSchema = z.object({ email: z.string(), password: z.string() });
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  full_name: z.string().min(1),
  role: z.enum(['admin', 'viewer']).default('viewer'),
});

function publicUser(row: Pick<UserRow, 'id' | 'email' | 'full_name' | 'role' | 'is_active'>) {
  return withBooleans({ id: row.id, email: row.email, full_name: row.full_name, role: row.role, is_active: row.is_active }, USER_BOOLS);
}

// =py routes/auth.login
router.post('/login', jsonBody(loginSchema), async (c) => {
  const secret = requireSecret(c);
  if (secret instanceof Response) return secret;
  const { email, password } = c.req.valid('json');

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!user || !(await verifyPassword(password, user.password_hash))) return c.json({ detail: 'Invalid credentials' }, 401);
  if (user.is_active !== 1) return c.json({ detail: 'Invalid credentials' }, 401);

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), user.id).run();

  const access = await signToken({ sub: user.id, role: user.role, type: 'access' }, secret, ACCESS_TOKEN_EXPIRE_MINUTES * 60);
  const refresh = await signToken({ sub: user.id, role: user.role, type: 'refresh' }, secret, REFRESH_TOKEN_EXPIRE_DAYS * 86400);

  setCookie(c, 'refresh_token', refresh, {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: REFRESH_TOKEN_EXPIRE_DAYS * 86400,
  });
  return c.json({ access_token: access, token_type: 'bearer', user: publicUser(user) });
});

// =py routes/auth.refresh
router.post('/refresh', async (c) => {
  const secret = requireSecret(c);
  if (secret instanceof Response) return secret;
  const cookie = getCookie(c, 'refresh_token');
  if (!cookie) return c.json({ detail: 'No refresh token' }, 401);

  const payload = await verifyToken(cookie, secret);
  if (!payload) return c.json({ detail: 'Invalid refresh token' }, 401);
  if (payload.type !== 'refresh') return c.json({ detail: 'Invalid token type' }, 401);

  const user = await c.env.DB.prepare('SELECT id, role, is_active FROM users WHERE id = ?').bind(payload.sub)
    .first<Pick<UserRow, 'id' | 'role' | 'is_active'>>();
  if (!user || user.is_active !== 1) return c.json({ detail: 'User not found or inactive' }, 401);

  const access = await signToken({ sub: user.id, role: user.role, type: 'access' }, secret, ACCESS_TOKEN_EXPIRE_MINUTES * 60);
  return c.json({ access_token: access, token_type: 'bearer' });
});

// =py routes/auth.logout
router.post('/logout', (c) => {
  deleteCookie(c, 'refresh_token', { path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });
  return c.json({ status: 'ok' });
});

// =py routes/auth.me
router.get('/me', requireAuth, (c) => c.json(c.get('user')));

// ~signup: Python creates users with a CLI. Admin-only here.
router.post('/signup', requireAuth, requireAdmin, jsonBody(signupSchema), async (c) => {
  const { email, password, full_name, role } = c.req.valid('json');
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ detail: 'Email already registered' }, 409);

  const id = generateId();
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, full_name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)'
  ).bind(id, email, await hashPassword(password), full_name, role).run();
  return c.json({ id, email, full_name, role, is_active: true }, 201);
});

export default router;

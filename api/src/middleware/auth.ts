import type { Context, Next } from 'hono';
import { requireSecret, verifyToken } from '../lib/jwt';
import { withBooleans, USER_BOOLS } from '../db/serialize';
import type { AppEnv, AuthUser, UserRow } from '../types';

// =py deps.get_current_user
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const secret = requireSecret(c);
  if (secret instanceof Response) return secret;

  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) return c.json({ detail: 'Not authenticated' }, 401);

  const payload = await verifyToken(header.slice(7), secret);
  if (!payload) return c.json({ detail: 'Invalid token' }, 401);
  if (payload.type !== 'access') return c.json({ detail: 'Invalid token type' }, 401);

  const row = await c.env.DB
    .prepare('SELECT id, email, full_name, role, is_active FROM users WHERE id = ?')
    .bind(payload.sub)
    .first<Pick<UserRow, 'id' | 'email' | 'full_name' | 'role' | 'is_active'>>();
  if (!row || row.is_active !== 1) return c.json({ detail: 'User not found or inactive' }, 401);

  c.set('user', withBooleans(row, USER_BOOLS) as unknown as AuthUser);
  await next();
}

// =py deps.require_admin
export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const user = c.get('user');
  if (!user || user.role !== 'admin') return c.json({ detail: 'Admin access required' }, 403);
  await next();
}

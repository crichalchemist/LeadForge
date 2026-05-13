import { Context, Next } from 'hono';
import { verifyToken } from '../lib/jwt';
import { Bindings, JwtPayload } from '../types';

type AuthEnv = { Bindings: Bindings; Variables: { user: JwtPayload } };

export async function requireAuth(c: Context<AuthEnv>, next: Next) {
  const JWT_SECRET = c.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production';

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token, JWT_SECRET);

  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  c.set('user', payload);
  await next();
}

export async function requireAdmin(c: Context<AuthEnv>, next: Next) {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
}

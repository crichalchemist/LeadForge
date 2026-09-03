import type { Context } from 'hono';
import type { AppEnv, JwtPayload } from '../types';

const encoder = new TextEncoder();
const JWT_ALG = 'HS256';

function base64UrlEncode(data: BufferSource): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function createHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export function generateId(): string {
  return crypto.randomUUID();
}

export async function signToken(
  payload: Pick<JwtPayload, 'sub' | 'role' | 'type'>,
  secret: string,
  expiresInSec: number
): Promise<string> {
  const header = { alg: JWT_ALG, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = { ...payload, iat: now, exp: now + expiresInSec };
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(full)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await createHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const key = await createHmacKey(secret);
    const valid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(sigB64), encoder.encode(`${headerB64}.${payloadB64}`));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as JwtPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Returns the configured secret, or a 500 response. Callers: `const s = requireSecret(c); if (s instanceof Response) return s;` */
export function requireSecret(c: Context<AppEnv>): string | Response {
  const secret = c.env.JWT_SECRET;
  if (!secret) return c.json({ detail: 'JWT_SECRET not configured' }, 500);
  return secret;
}

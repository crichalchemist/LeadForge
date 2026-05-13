import { JwtPayload } from '../types';

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

export async function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, expiresInSec: number = 3600): Promise<string> {
  const header = { alg: JWT_ALG, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + expiresInSec };

  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await createHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  const sigB64 = base64UrlEncode(signature);

  return `${signingInput}.${sigB64}`;
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  try {
    const key = await createHmacKey(secret);
    const signature = base64UrlDecode(sigB64);
    const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(signingInput));
    if (!isValid) return null;

    const payloadStr = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload: JwtPayload = JSON.parse(payloadStr);

    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

export function generateId(): string {
  return crypto.randomUUID();
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password + salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const hash = await crypto.subtle.sign('HMAC', key, encoder.encode(password));
  return base64UrlEncode(hash);
}

export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(password, salt);
  return computed === hash;
}

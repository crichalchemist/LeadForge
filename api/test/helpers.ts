import { vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { signToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

type Json = Record<string, unknown>;

const TABLES = [
  'grant_documents', 'grant_applications', 'outreach_records', 'lead_scores',
  'digital_presences', 'competitive_contexts', 'businesses', 'nof_corridors', 'users',
];

export async function resetDb(): Promise<void> {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

export interface TestUser { id: string; email: string; full_name: string; role: 'admin' | 'viewer'; is_active: boolean }

export async function createUser(overrides: Partial<TestUser> & { password?: string } = {}): Promise<TestUser> {
  const user: TestUser = {
    id: crypto.randomUUID(),
    email: overrides.email ?? 'admin@test.com',
    full_name: overrides.full_name ?? 'Test Admin',
    role: overrides.role ?? 'admin',
    is_active: overrides.is_active ?? true,
  };
  const hash = await hashPassword(overrides.password ?? 'testpassword12');
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, full_name, role, is_active) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(user.id, user.email, hash, user.full_name, user.role, user.is_active ? 1 : 0).run();
  return user;
}

export const adminUser = () => createUser();
export const viewerUser = () => createUser({ email: 'viewer@test.com', full_name: 'Test Viewer', role: 'viewer' });

export function accessToken(user: TestUser): Promise<string> {
  return signToken({ sub: user.id, role: user.role, type: 'access' }, env.JWT_SECRET!, 3600);
}

export function refreshToken(user: TestUser): Promise<string> {
  return signToken({ sub: user.id, role: user.role, type: 'refresh' }, env.JWT_SECRET!, 30 * 86400);
}

export async function createBusiness(overrides: Json = {}): Promise<string> {
  const id = crypto.randomUUID();
  const row = {
    name: 'Test Barbershop', zip_code: '60619', niche: 'barbershops', address: '123 Test St',
    phone: '(773) 555-0001', license_status: 'active', ...overrides,
  };
  await env.DB.prepare(
    'INSERT INTO businesses (id, name, zip_code, niche, address, phone, license_status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, row.name, row.zip_code, row.niche, row.address, row.phone, row.license_status).run();
  return id;
}

export async function createScore(businessId: string, overrides: Json = {}): Promise<string> {
  const id = crypto.randomUUID();
  const row = {
    score_version: 1, digital_deficit_score: 65.0, viability_score: 45.0,
    competitive_pressure_score: 30.0, composite_acquisition_score: 48.25, price_tier: 2, ...overrides,
  };
  await env.DB.prepare(
    `INSERT INTO lead_scores (id, business_id, score_version, digital_deficit_score, viability_score,
       competitive_pressure_score, composite_acquisition_score, price_tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, businessId, row.score_version, row.digital_deficit_score, row.viability_score,
    row.competitive_pressure_score, row.composite_acquisition_score, row.price_tier).run();
  return id;
}

export async function createOutreach(businessId: string, overrides: Json = {}): Promise<string> {
  const id = crypto.randomUUID();
  const row = { status: 'scored', retell_call_id: null, ...overrides };
  await env.DB.prepare(
    'INSERT INTO outreach_records (id, business_id, status, retell_call_id) VALUES (?, ?, ?, ?)'
  ).bind(id, businessId, row.status, row.retell_call_id).run();
  return id;
}

export interface ApiOptions { token?: string; json?: unknown; headers?: Record<string, string> }

/** Issue a request to the Worker under test. Path is relative to /api. */
export async function api(method: string, path: string, opts: ApiOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  return exports.default.fetch(`http://test/api${path}`, {
    method,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
}

export type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Replace the global fetch for one test. Returns the URLs requested, in order. */
export function stubFetch(handler: FetchHandler): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return handler(url, init);
  });
  return calls;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

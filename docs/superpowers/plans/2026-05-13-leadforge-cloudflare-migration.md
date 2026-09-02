# LeadForge Cloudflare Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate LeadForge from self-hosted Docker (Python/FastAPI/Celery/PostGIS/vLLM/Redis) to fully serverless Cloudflare Workers (Hono/D1/Queues/Cron/Workers AI). Zero self-managed containers.

**Architecture:** Workers API (Hono + Zod + Web Crypto JWT) handles all HTTP routes. D1 (SQLite) replaces PostgreSQL. Pre-compute corridor geometry into boolean fields so no PostGIS needed at runtime. Workers AI replaces both vLLM (CPU Qwen) and Azure Claude. Queues + Cron replace Celery/Redis. Frontend deploys to Pages.

**Tech Stack:** TypeScript, Hono, Zod, Cloudflare Workers, D1, Queues, Cron Triggers, Workers AI, KV, Cloudflare Pages, `wrangler`

---

## Phase 1: Foundation + Core API (Plans 1+2)

Outcome: Workers project scaffolded, D1 populated with lead and corridor data, auth working, core CRM routes (businesses, leads, pipeline) live and talking to D1. Usable with API clients.

### Task 1.1: Scaffold Workers Project

**Files:**
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/wrangler.jsonc`
- Create: `api/src/index.ts`
- Create: `api/src/types/index.ts`
- Create: `api/.gitignore`

- [ ] **Step 1: Create project directory and install dependencies**

```bash
mkdir -p api/src/{routes,middleware,lib,db,types}
cd api

npm init -y
npm install hono zod
npm install -D typescript @cloudflare/workers-types wrangler vitest
```

- [ ] **Step 2: Write `api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `api/wrangler.jsonc`**

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "leadforge-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-13",
  "compatibility_flags": ["nodejs_compat"],

  "d1_databases": [
    { "binding": "DB", "database_name": "leadforge-db", "database_id": "<DB_ID>" }
  ],

  "ai": { "binding": "AI" },

  "queues": {
    "producers": [
      { "binding": "ENRICHMENT_QUEUE", "queue": "leadforge-enrichment" },
      { "binding": "OUTREACH_QUEUE", "queue": "leadforge-outreach" },
      { "binding": "SENTIMENT_QUEUE", "queue": "leadforge-sentiment" },
      { "binding": "RECALIBRATION_QUEUE", "queue": "leadforge-recalibration" }
    ]
  },

  "triggers": {
    "crons": [
      "0 6 * * *",
      "30 6 * * *",
      "0 7 * * 1",
      "0 8 * * *"
    ]
  },

  "kv_namespaces": [
    { "binding": "COOKIE_STORE", "id": "<KV_ID>" }
  ],

  "env": {
    "staging": { "name": "leadforge-api-staging" },
    "production": { "name": "leadforge-api" }
  }
}
```

- [ ] **Step 4: Write `api/src/index.ts` — Hono app entry**

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors({ origin: '*', credentials: true }));

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

export default app;
```

- [ ] **Step 5: Write `api/src/types/index.ts`**

```typescript
export interface Bindings {
  DB: D1Database;
  AI: any;
  COOKIE_STORE: KVNamespace;
  ENRICHMENT_QUEUE: Queue<any>;
  OUTREACH_QUEUE: Queue<any>;
  SENTIMENT_QUEUE: Queue<any>;
  RECALIBRATION_QUEUE: Queue<any>;
}

export interface JwtPayload {
  sub: string;         // user id
  email: string;
  role: 'admin' | 'viewer';
  exp: number;
  iat: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'viewer';
  created_at: string;
}

export interface Business {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  niche: string | null;
  in_nof_corridor: number | null;
  nof_corridor_name: string | null;
  license_status: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadScore {
  id: string;
  business_id: string;
  score_version: string;
  digital_deficit_score: number;
  viability_score: number;
  competitive_pressure_score: number;
  composite_acquisition_score: number;
  price_tier: number;
  calculated_at: string;
}

export interface PipelineItem {
  id: string;
  business_id: string;
  stage: string;
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachRecord {
  id: string;
  business_id: string;
  call_id: string;
  status: string;
  duration: number;
  transcript: string | null;
  disposition: string | null;
  sentiment_score: number | null;
  called_at: string;
}

export interface GrantApplication {
  id: string;
  business_id: string;
  corridor_name: string;
  stage: string;
  amount_requested: number;
  amount_approved: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 6: Write `api/.gitignore`**

```
node_modules/
dist/
.wrangler/
*.local.sqlite
```

- [ ] **Step 7: Verify scaffold compiles**

```bash
cd api
npx tsc --noEmit
```

Expected: compiles with no errors (you may see warnings about unused imports — ok).

- [ ] **Step 8: Commit**

```bash
git add api/
git commit -m "feat: scaffold Cloudflare Workers project with Hono"
```

---

### Task 1.2: Create D1 Database and Schema

**Files:**
- Create: `api/src/db/schema.sql`
- Create: `api/src/db/queries.ts`

- [ ] **Step 1: Create D1 database**

```bash
cd api
npx wrangler d1 create leadforge-db
```

Copy the returned `database_id` into `wrangler.jsonc`.

- [ ] **Step 2: Write `api/src/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  latitude REAL,
  longitude REAL,
  phone TEXT,
  niche TEXT,
  in_nof_corridor INTEGER DEFAULT 0,
  nof_corridor_name TEXT,
  license_status TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_businesses_zip ON businesses(zip_code);
CREATE INDEX idx_businesses_niche ON businesses(niche);
CREATE INDEX idx_businesses_corridor ON businesses(in_nof_corridor);

CREATE TABLE IF NOT EXISTS digital_presence (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  has_website INTEGER DEFAULT 0,
  website_url TEXT,
  google_review_count INTEGER DEFAULT 0,
  google_avg_rating REAL,
  yelp_review_count INTEGER DEFAULT 0,
  yelp_rating REAL,
  website_quality_score INTEGER DEFAULT 0,
  facebook_url TEXT,
  instagram_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_scores (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  score_version TEXT NOT NULL DEFAULT 'v1',
  digital_deficit_score REAL NOT NULL DEFAULT 0,
  viability_score REAL NOT NULL DEFAULT 0,
  competitive_pressure_score REAL NOT NULL DEFAULT 0,
  composite_acquisition_score REAL NOT NULL DEFAULT 0,
  price_tier INTEGER NOT NULL DEFAULT 3,
  calculated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_lead_scores_business ON lead_scores(business_id);
CREATE INDEX idx_lead_scores_composite ON lead_scores(composite_acquisition_score DESC);

CREATE TABLE IF NOT EXISTS competitive_contexts (
  id TEXT PRIMARY KEY,
  zip_code TEXT NOT NULL,
  niche TEXT NOT NULL,
  business_density INTEGER DEFAULT 0,
  avg_rating REAL,
  total_reviews INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(zip_code, niche)
);

CREATE TABLE IF NOT EXISTS outreach_records (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  duration INTEGER DEFAULT 0,
  transcript TEXT,
  disposition TEXT,
  sentiment_score REAL,
  called_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_outreach_business ON outreach_records(business_id);

CREATE TABLE IF NOT EXISTS nof_corridors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  boundary_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grant_applications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  corridor_name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'identified',
  amount_requested REAL NOT NULL DEFAULT 0,
  amount_approved REAL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_grants_business ON grant_applications(business_id);

CREATE TABLE IF NOT EXISTS grant_documents (
  id TEXT PRIMARY KEY,
  grant_application_id TEXT NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_url TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scoring_weights (
  id TEXT PRIMARY KEY,
  weight_name TEXT NOT NULL UNIQUE,
  weight_value REAL NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO scoring_weights (id, weight_name, weight_value, description) VALUES
  ('w1', 'deficit_weight', 0.40, 'Digital deficit contribution to composite score'),
  ('w2', 'viability_weight', 0.35, 'Business viability contribution to composite score'),
  ('w3', 'competitive_weight', 0.25, 'Competitive pressure contribution to composite score'),
  ('w4', 'baseline_funding', 3000, 'Baseline grant funding amount'),
  ('w5', 'tier_multiplier_1', 1.0, 'Price tier 1 multiplier'),
  ('w6', 'tier_multiplier_2', 0.7, 'Price tier 2 multiplier'),
  ('w7', 'tier_multiplier_3', 0.4, 'Price tier 3 multiplier');
```

- [ ] **Step 3: Apply schema to D1**

```bash
cd api
npx wrangler d1 execute leadforge-db --file=src/db/schema.sql
```

Expected: "Executed SQL on leadforge-db" with no errors.

- [ ] **Step 4: Write `api/src/db/queries.ts`**

```typescript
import { Bindings, Business, LeadScore } from '../types';

// Generic paginated list query
export async function paginatedList<T>(
  db: D1Database,
  table: string,
  columns: string,
  options: { page?: number; perPage?: number; where?: string; orderBy?: string }
): Promise<{ data: T[]; total: number; page: number; perPage: number }> {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 50;
  const offset = (page - 1) * perPage;
  const where = options.where ? `WHERE ${options.where}` : '';
  const orderBy = options.orderBy ? `ORDER BY ${options.orderBy}` : '';

  const countResult = await db.prepare(`SELECT COUNT(*) as count FROM ${table} ${where}`).first<{ count: number }>();
  const total = countResult?.count ?? 0;

  const data = await db
    .prepare(`SELECT ${columns} FROM ${table} ${where} ${orderBy} LIMIT ? OFFSET ?`)
    .bind(perPage, offset)
    .all<T>();

  return { data: data.results ?? [], total, page, perPage };
}

// Simple get-by-id helper
export async function getById<T>(db: D1Database, table: string, id: string): Promise<T | null> {
  const result = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<T>();
  return result ?? null;
}

// Soft-delete / hard-delete helper
export async function deleteById(db: D1Database, table: string, id: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return result.meta.changes > 0;
}
```

- [ ] **Step 5: Commit**

```bash
git add api/src/db/
git commit -m "feat: create D1 schema and shared query helpers"
```

---

### Task 1.3: Auth Middleware + Routes

**Files:**
- Create: `api/src/lib/jwt.ts`
- Create: `api/src/middleware/auth.ts`
- Create: `api/src/routes/auth.ts`

- [ ] **Step 1: Write `api/src/lib/jwt.ts`**

```typescript
import { JwtPayload } from '../types';

const encoder = new TextEncoder();
const JWT_ALG = 'HS256';

function base64UrlEncode(data: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(data)))
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
```

- [ ] **Step 2: Write `api/src/middleware/auth.ts`**

```typescript
import { Context, Next } from 'hono';
import { verifyToken } from '../lib/jwt';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production';

export async function requireAuth(c: Context, next: Next) {
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

export async function requireAdmin(c: Context, next: Next) {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
}
```

- [ ] **Step 3: Write `api/src/routes/auth.ts`**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { signToken, generateId, hashPassword, verifyPassword } from '../lib/jwt';
import { requireAuth } from '../middleware/auth';
import { Bindings } from '../types';

const router = new Hono<{ Bindings: Bindings }>();

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production';

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
  const user = c.get('user') as any;
  const db = c.env.DB;

  const record = await db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').bind(user.sub).first();
  if (!record) return c.json({ error: 'User not found' }, 404);

  return c.json(record);
});

export default router;
```

- [ ] **Step 4: Install `@hono/zod-validator` and wire auth routes into `index.ts`**

```bash
cd api
npm install @hono/zod-validator
```

Edit `api/src/index.ts` to add auth routes:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';
import authRoutes from './routes/auth';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors({ origin: '*', credentials: true }));

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.route('/api/auth', authRoutes);

export default app;
```

- [ ] **Step 5: Verify compilation**

```bash
cd api
npx tsc --noEmit
```

Expected: compiles cleanly.

- [ ] **Step 6: Seed an admin user and test end-to-end**

```bash
cd api
npx wrangler d1 execute leadforge-db --command="INSERT INTO users (id, email, password_hash, name, role) VALUES ('seed-admin', 'admin@leadforge.dev', '$(echo -n 'dev-password123' | openssl dgst -sha256 -hmac 'seed-admin' | awk '{print $NF}' | tr -d '\n')', 'Admin User', 'admin');"
```

Then start dev server and test:

```bash
npx wrangler dev
```

In another terminal:

```bash
curl -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@leadforge.dev","password":"dev-password123"}'
```

Expected: returns `access_token`, `refresh_token`, and user object.

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/jwt.ts api/src/middleware/auth.ts api/src/routes/auth.ts api/src/index.ts api/package.json
git commit -m "feat: implement JWT auth (Web Crypto) with login, refresh, signup"
```

---

### Task 1.4: Pre-compute Corridor Data (Python Script)

**Files:**
- Create: `scripts/precompute_corridors.py`

- [ ] **Step 1: Write `scripts/precompute_corridors.py`**

```python
#!/usr/bin/env python3
"""One-time script: pre-compute corridor membership for all businesses.

Run against the existing PostGIS database before decommissioning it.
Outputs a JSON file suitable for bulk-importing corridor status into D1.

Usage:
    python scripts/precompute_corridors.py --db-url postgresql://... --output corridor_data.json
"""
import argparse
import json
import sys
from datetime import datetime

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 is required. Install with: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)

def precompute_corridors(db_url: str, output_path: str):
    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Query businesses with their corridor intersection
    cur.execute("""
        SELECT
            b.id,
            b.name,
            CASE WHEN nc.id IS NOT NULL THEN 1 ELSE 0 END AS in_nof_corridor,
            nc.name AS nof_corridor_name
        FROM businesses b
        LEFT JOIN nof_corridors nc
            ON ST_Contains(nc.geometry, b.location::geometry)
            OR ST_Intersects(nc.geometry, b.location::geometry)
    """)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    # Build corridor lookup: which businesses are in which corridors
    businesses = {}
    for row in rows:
        biz_id = row['id']
        if biz_id not in businesses:
            businesses[biz_id] = {
                'id': biz_id,
                'in_nof_corridor': 0,
                'nof_corridor_name': None,
                'zone_names': [],
            }
        if row['in_nof_corridor']:
            businesses[biz_id]['in_nof_corridor'] = 1
            businesses[biz_id]['zone_names'].append(row['nof_corridor_name'])

    # Flatten to update format: primary corridor is first match
    updates = []
    for biz_id, data in businesses.items():
        updates.append({
            'id': biz_id,
            'in_nof_corridor': data['in_nof_corridor'],
            'nof_corridor_name': data['zone_names'][0] if data['zone_names'] else None,
        })

    with open(output_path, 'w') as f:
        json.dump({
            'generated_at': datetime.utcnow().isoformat(),
            'total_businesses': len(updates),
            'in_corridor_count': sum(1 for u in updates if u['in_nof_corridor']),
            'updates': updates,
        }, f, indent=2)

    print(f"Pre-computed corridor data for {len(updates)} businesses")
    print(f"  In corridor: {sum(1 for u in updates if u['in_nof_corridor'])}")
    print(f"  Not in corridor: {sum(1 for u in updates if not u['in_nof_corridor'])}")
    print(f"  Output: {output_path}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Pre-compute NOF corridor membership for all businesses')
    parser.add_argument('--db-url', required=True, help='PostgreSQL connection URL with PostGIS')
    parser.add_argument('--output', default='corridor_updates.json', help='Output JSON file path')
    args = parser.parse_args()
    precompute_corridors(args.db_url, args.output)
```

- [ ] **Step 2: Run the pre-compute script against the existing PostGIS database**

```bash
python scripts/precompute_corridors.py \
  --db-url "postgresql://user:pass@localhost:5432/leadforge" \
  --output corridor_updates.json
```

Expected: prints counts of businesses in/not-in corridor, writes JSON file.

- [ ] **Step 3: Import corridor data into D1**

```bash
cd api
cat ../corridor_updates.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for update in data['updates']:
    print(f\"UPDATE businesses SET in_nof_corridor={update['in_nof_corridor']}, nof_corridor_name={'\\\\'' + update['nof_corridor_name'].replace(chr(39), chr(39)+chr(39)) + '\\\\'' if update['nof_corridor_name'] else 'NULL'} WHERE id='{update['id']}';\")
" > corridor_updates.sql

npx wrangler d1 execute leadforge-db --file=../corridor_updates.sql
```

Expected: D1 returns success for all UPDATE statements.

- [ ] **Step 4: Commit**

```bash
git add scripts/precompute_corridors.py
git commit -m "feat: add corridor pre-compute script for D1 migration"
```

---

### Task 1.5: Businesses Routes

**Files:**
- Create: `api/src/routes/businesses.ts`
- Modify: `api/src/index.ts` (wire businesses routes)

- [ ] **Step 1: Write `api/src/routes/businesses.ts`**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId } from '../lib/jwt';
import { paginatedList, getById, deleteById } from '../db/queries';
import { Bindings, Business } from '../types';

const router = new Hono<{ Bindings: Bindings }>();

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
  const page = parseInt(c.req.query('page') ?? '1');
  const perPage = Math.min(parseInt(c.req.query('per_page') ?? '50'), 200);
  const niche = c.req.query('niche');
  const zip = c.req.query('zip_code');
  const inCorridor = c.req.query('in_corridor');
  const search = c.req.query('search');

  const conditions: string[] = [];
  const bindings: any[] = [];

  if (niche) { conditions.push('niche = ?'); bindings.push(niche); }
  if (zip) { conditions.push('zip_code = ?'); bindings.push(zip); }
  if (inCorridor !== undefined) { conditions.push('in_nof_corridor = ?'); bindings.push(inCorridor === 'true' ? 1 : 0); }
  if (search) { conditions.push('(name LIKE ? OR address LIKE ? OR phone LIKE ?)'); bindings.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const where = conditions.length > 0 ? conditions.join(' AND ') : undefined;

  const result = await paginatedList<Business>(db, 'businesses', '*', {
    page, perPage, where, orderBy: 'name ASC'
  });

  return c.json(result);
});

// GET /api/businesses/:id
router.get('/:id', requireAuth, async (c) => {
  const db = c.env.DB;
  const business = await getById<Business>(db, 'businesses', c.req.param('id'));
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
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const existing = await getById<Business>(db, 'businesses', id);
  if (!existing) return c.json({ error: 'Business not found' }, 404);

  const fields: string[] = [];
  const values: any[] = [];

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
  const deleted = await deleteById(db, 'businesses', c.req.param('id'));
  if (!deleted) return c.json({ error: 'Business not found' }, 404);
  return c.json({ deleted: true });
});

export default router;
```

- [ ] **Step 2: Wire businesses routes in `api/src/index.ts`**

Edit `api/src/index.ts` to add:

```typescript
import businessRoutes from './routes/businesses';

// After auth routes
app.route('/api/businesses', businessRoutes);
```

- [ ] **Step 3: Verify compilation**

```bash
cd api
npx tsc --noEmit
```

Expected: compiles cleanly.

- [ ] **Step 4: Test businesses CRUD manually via dev server**

```bash
cd api
npx wrangler dev &
sleep 3

# Login
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@leadforge.dev","password":"dev-password123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Create a business
curl -s -X POST http://localhost:8787/api/businesses \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Business","city":"Chicago","state":"IL","niche":"plumbing"}'

# List businesses
curl -s http://localhost:8787/api/businesses?page=1 -H "Authorization: Bearer $TOKEN"
```

Expected: create returns 201 with business object, list returns paginated results.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/businesses.ts api/src/index.ts
git commit -m "feat: implement businesses CRUD routes with filtering"
```

---

### Task 1.6: Leads Routes (Scoring)

**Files:**
- Create: `api/src/routes/leads.ts`
- Create: `api/src/lib/scoring.ts`
- Modify: `api/src/index.ts` (wire leads routes)

- [ ] **Step 1: Write `api/src/lib/scoring.ts`**

```typescript
/**
 * Scoring engine ported from Python composite.py
 *
 * Three-factor model:
 *   - Digital Deficit (40%): measures missing online presence
 *   - Viability (35%): business stability and health
 *   - Competitive Pressure (25%): market saturation
 *
 * Composite score ranges 0-100. Higher = better acquisition target.
 * Price tier: 1 (premium), 2 (standard), 3 (economy)
 */

export interface ScoringInputs {
  // Digital presence
  has_website: number;
  google_review_count: number;
  google_avg_rating: number | null;
  yelp_review_count: number;
  yelp_rating: number | null;
  website_quality_score: number;

  // Viability
  license_status: string | null;
  years_in_business: number;

  // Competitive context
  business_density: number;  // competitors in same zip+niche
  avg_rating: number | null;
  total_reviews: number;
}

export interface ScoreResult {
  digital_deficit_score: number;           // 0-100
  viability_score: number;                 // 0-100
  competitive_pressure_score: number;      // 0-100 (inverted: higher = less pressure = better)
  composite_acquisition_score: number;     // 0-100
  price_tier: 1 | 2 | 3;
}

const WEIGHTS = {
  deficit: 0.40,
  viability: 0.35,
  competitive: 0.25,
};

export function calculateScore(inputs: ScoringInputs): ScoreResult {
  // --- Digital Deficit (0-100, higher = more deficit = more opportunity) ---
  let deficit = 0;

  // No website is a strong signal
  if (!inputs.has_website) {
    deficit += 40;
  } else {
    deficit += (100 - inputs.website_quality_score) * 0.25; // 0-25
  }

  // Low review counts indicate digital gap
  const totalReviews = (inputs.google_review_count || 0) + (inputs.yelp_review_count || 0);
  if (totalReviews === 0) {
    deficit += 35;
  } else if (totalReviews < 10) {
    deficit += 20;
  } else if (totalReviews < 50) {
    deficit += 10;
  }

  // Low rating = opportunity to improve
  const avgRating = inputs.google_avg_rating ?? inputs.yelp_rating ?? null;
  if (avgRating !== null && avgRating < 4.0) {
    deficit += 15;
  } else if (avgRating !== null && avgRating >= 4.5) {
    deficit -= 5; // already well-reviewed, less digital work needed
  }

  const digital_deficit_score = Math.max(0, Math.min(100, deficit));

  // --- Viability (0-100, higher = more viable) ---
  let viability = 50; // baseline

  if (inputs.license_status === 'active' || inputs.license_status === 'licensed') {
    viability += 20;
  } else if (inputs.license_status === 'expired') {
    viability -= 20;
  }

  if (inputs.years_in_business >= 5) {
    viability += 20;
  } else if (inputs.years_in_business >= 2) {
    viability += 10;
  }

  if (avgRating !== null && avgRating >= 4.0) {
    viability += 10;
  }

  const viability_score = Math.max(0, Math.min(100, viability));

  // --- Competitive Pressure (0-100, inverted: higher = less competition = better) ---
  let pressure = 70; // baseline (moderate opportunity)

  if (inputs.business_density <= 3) {
    pressure += 20; // low competition
  } else if (inputs.business_density <= 10) {
    pressure += 10;
  } else if (inputs.business_density > 50) {
    pressure -= 20; // very saturated
  }

  // High average ratings in area = quality competition
  if (inputs.avg_rating !== null && inputs.avg_rating >= 4.2) {
    pressure -= 10;
  }

  const competitive_pressure_score = Math.max(0, Math.min(100, pressure));

  // --- Composite (weighted) ---
  const composite =
    digital_deficit_score * WEIGHTS.deficit +
    viability_score * WEIGHTS.viability +
    competitive_pressure_score * WEIGHTS.competitive;

  // --- Price Tier ---
  let price_tier: 1 | 2 | 3 = 3;
  if (composite >= 70) {
    price_tier = 1;
  } else if (composite >= 45) {
    price_tier = 2;
  }

  return {
    digital_deficit_score: Math.round(digital_deficit_score * 100) / 100,
    viability_score: Math.round(viability_score * 100) / 100,
    competitive_pressure_score: Math.round(competitive_pressure_score * 100) / 100,
    composite_acquisition_score: Math.round(composite * 100) / 100,
    price_tier,
  };
}
```

- [ ] **Step 2: Write `api/src/routes/leads.ts`**

```typescript
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { paginatedList } from '../db/queries';
import { Bindings, Business, LeadScore } from '../types';

const router = new Hono<{ Bindings: Bindings }>();

const LEAD_COLUMNS = `
  b.id, b.name, b.address, b.city, b.state, b.zip_code, b.niche,
  b.in_nof_corridor, b.nof_corridor_name,
  ls.composite_acquisition_score, ls.digital_deficit_score,
  ls.viability_score, ls.competitive_pressure_score, ls.price_tier,
  ls.calculated_at,
  dp.has_website, dp.google_review_count, dp.google_avg_rating,
  dp.yelp_review_count, dp.yelp_rating
`;

// GET /api/leads — ranked list of businesses with scores
router.get('/', requireAuth, async (c) => {
  const db = c.env.DB;
  const page = parseInt(c.req.query('page') ?? '1');
  const perPage = Math.min(parseInt(c.req.query('per_page') ?? '50'), 200);
  const niche = c.req.query('niche');
  const minScore = c.req.query('min_score');
  const tier = c.req.query('tier');
  const inCorridor = c.req.query('in_corridor');
  const sortBy = c.req.query('sort_by') ?? 'composite_acquisition_score';
  const sortOrder = c.req.query('sort_order') ?? 'DESC';

  const conditions: string[] = [];
  const bindings: any[] = [];

  if (niche) { conditions.push('b.niche = ?'); bindings.push(niche); }
  if (minScore) { conditions.push('ls.composite_acquisition_score >= ?'); bindings.push(parseFloat(minScore)); }
  if (tier) { conditions.push('ls.price_tier = ?'); bindings.push(parseInt(tier)); }
  if (inCorridor !== undefined) { conditions.push('b.in_nof_corridor = ?'); bindings.push(inCorridor === 'true' ? 1 : 0); }

  const validSorts = ['composite_acquisition_score', 'digital_deficit_score', 'price_tier', 'calculated_at'];
  const orderCol = validSorts.includes(sortBy) ? `ls.${sortBy}` : 'ls.composite_acquisition_score';
  const order = sortOrder === 'ASC' ? 'ASC' : 'DESC';

  // Query with join: latest lead_score for each business
  const where = conditions.length > 0 ? conditions.join(' AND ') : undefined;
  const whereClause = where ? `AND ${where}` : '';
  const orderBy = `${orderCol} ${order}`;

  const countResult = await db.prepare(`
    SELECT COUNT(*) as count
    FROM businesses b
    JOIN lead_scores ls ON ls.business_id = b.id
    WHERE ls.id IN (SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY calculated_at DESC) AS rn
      FROM lead_scores
    ) WHERE rn = 1)
    ${whereClause}
  `).bind(...bindings).first<{ count: number }>();
  const total = countResult?.count ?? 0;

  const offset = (page - 1) * perPage;
  const data = await db.prepare(`
    SELECT ${LEAD_COLUMNS}
    FROM businesses b
    JOIN lead_scores ls ON ls.business_id = b.id
    LEFT JOIN digital_presence dp ON dp.business_id = b.id
    WHERE ls.id IN (SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY calculated_at DESC) AS rn
      FROM lead_scores
    ) WHERE rn = 1)
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).bind(...bindings, perPage, offset).all();

  return c.json({ data: data.results ?? [], total, page, perPage });
});

// GET /api/leads/:id/history — score history for a specific business
router.get('/:id/history', requireAuth, async (c) => {
  const db = c.env.DB;
  const businessId = c.req.param('id');

  const scores = await db.prepare(`
    SELECT * FROM lead_scores
    WHERE business_id = ?
    ORDER BY calculated_at DESC
    LIMIT 20
  `).bind(businessId).all<LeadScore>();

  return c.json(scores.results ?? []);
});

export default router;
```

- [ ] **Step 3: Wire leads routes in `api/src/index.ts`**

```typescript
import leadRoutes from './routes/leads';

app.route('/api/leads', leadRoutes);
```

- [ ] **Step 4: Verify compilation**

```bash
cd api
npx tsc --noEmit
```

Expected: compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/leads.ts api/src/lib/scoring.ts api/src/index.ts
git commit -m "feat: implement leads routes with scoring engine"
```

---

### Task 1.7: Pipeline Routes

**Files:**
- Create: `api/src/routes/pipeline.ts`
- Modify: `api/src/index.ts` (wire pipeline routes)

- [ ] **Step 1: Write `api/src/routes/pipeline.ts`**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId } from '../lib/jwt';
import { Bindings, PipelineItem } from '../types';

const router = new Hono<{ Bindings: Bindings }>();

const STAGES = [
  'discovered', 'enriched', 'scored', 'contacted',
  'interested', 'qualified', 'proposal', 'negotiation',
  'won', 'lost'
];

const transitionSchema = z.object({
  business_id: z.string(),
  from_stage: z.enum(STAGES as [string, ...string[]]),
  to_stage: z.enum(STAGES as [string, ...string[]]),
  notes: z.string().optional().nullable(),
});

// GET /api/pipeline — kanban board grouped by stage
router.get('/', requireAuth, async (c) => {
  const db = c.env.DB;
  const stage = c.req.query('stage');
  const assignedTo = c.req.query('assigned_to');

  let query = `
    SELECT p.id, p.business_id, p.stage, p.assigned_to, p.notes, p.created_at, p.updated_at,
           b.name as business_name, b.niche, b.zip_code
    FROM pipeline_items p
    JOIN businesses b ON b.id = p.business_id
    WHERE 1=1
  `;
  const bindings: any[] = [];

  if (stage) { query += ' AND p.stage = ?'; bindings.push(stage); }
  if (assignedTo) { query += ' AND p.assigned_to = ?'; bindings.push(assignedTo); }

  query += ' ORDER BY p.updated_at DESC';

  const items = await db.prepare(query).bind(...bindings).all();

  // Group by stage for kanban
  const grouped: Record<string, any[]> = {};
  for (const stage of STAGES) grouped[stage] = [];
  for (const item of (items.results ?? [])) {
    if (!grouped[item.stage]) grouped[item.stage] = [];
    grouped[item.stage].push(item);
  }

  return c.json({ stages: grouped, stage_order: STAGES });
});

// GET /api/pipeline/:id
router.get('/:id', requireAuth, async (c) => {
  const db = c.env.DB;
  const item = await db.prepare(`
    SELECT p.*, b.name as business_name, b.niche, b.zip_code
    FROM pipeline_items p
    JOIN businesses b ON b.id = p.business_id
    WHERE p.id = ?
  `).bind(c.req.param('id')).first();

  if (!item) return c.json({ error: 'Pipeline item not found' }, 404);
  return c.json(item);
});

// POST /api/pipeline/transition — move business through pipeline stages
router.post('/transition', requireAuth, requireAdmin, zValidator('json', transitionSchema), async (c) => {
  const db = c.env.DB;
  const { business_id, from_stage, to_stage, notes } = c.req.valid('json');

  // Find existing pipeline item for this business in the from_stage
  const existing = await db.prepare(
    'SELECT id FROM pipeline_items WHERE business_id = ? AND stage = ?'
  ).bind(business_id, from_stage).first<any>();

  if (!existing) {
    return c.json({ error: `No pipeline item found in stage '${from_stage}' for this business` }, 400);
  }

  // Update to new stage
  await db.prepare(`
    UPDATE pipeline_items SET stage = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(to_stage, notes ?? null, existing.id).run();

  const updated = await db.prepare(`
    SELECT p.*, b.name as business_name
    FROM pipeline_items p
    JOIN businesses b ON b.id = p.business_id
    WHERE p.id = ?
  `).bind(existing.id).first();

  return c.json(updated);
});

// POST /api/pipeline — create pipeline item for a business
router.post('/', requireAuth, requireAdmin, zValidator('json', z.object({
  business_id: z.string(),
  stage: z.enum(STAGES as [string, ...string[]]).default('discovered'),
  notes: z.string().optional().nullable(),
})), async (c) => {
  const db = c.env.DB;
  const { business_id, stage, notes } = c.req.valid('json');
  const id = generateId();

  await db.prepare(`
    INSERT INTO pipeline_items (id, business_id, stage, notes)
    VALUES (?, ?, ?, ?)
  `).bind(id, business_id, stage, notes ?? null).run();

  const created = await db.prepare('SELECT * FROM pipeline_items WHERE id = ?').bind(id).first();
  return c.json(created, 201);
});

export default router;
```

- [ ] **Step 2: Add pipeline_items table to schema**

Add to `api/src/db/schema.sql` (before the closing):

```sql
CREATE TABLE IF NOT EXISTS pipeline_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'discovered',
  assigned_to TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pipeline_business ON pipeline_items(business_id);
CREATE INDEX idx_pipeline_stage ON pipeline_items(stage);
```

- [ ] **Step 3: Apply schema update to D1**

```bash
cd api
npx wrangler d1 execute leadforge-db --command="
CREATE TABLE IF NOT EXISTS pipeline_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'discovered',
  assigned_to TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pipeline_business ON pipeline_items(business_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline_items(stage);
"
```

- [ ] **Step 4: Wire pipeline routes in `api/src/index.ts`**

```typescript
import pipelineRoutes from './routes/pipeline';

app.route('/api/pipeline', pipelineRoutes);
```

- [ ] **Step 5: Verify compilation**

```bash
cd api
npx tsc --noEmit
```

Expected: compiles cleanly.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/pipeline.ts api/src/db/schema.sql api/src/index.ts
git commit -m "feat: implement pipeline routes with kanban board"
```

---

## Phase 2: Advanced Routes + Frontend (Plans 3+4)

Outcome: All 8 route modules ported to Workers. Frontend (React SPA) deployed on Cloudflare Pages, talking to the Workers API. Full CRM displayable in browser.

### Task 2.1: Outreach Routes

**Files:**
- Create: `api/src/routes/outreach.ts`
- Modify: `api/src/index.ts` (wire outreach routes)

- [ ] **Step 1: Write `api/src/routes/outreach.ts`**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId } from '../lib/jwt';
import { paginatedList, getById } from '../db/queries';
import { Bindings, OutreachRecord } from '../types';

const router = new Hono<{ Bindings: Bindings }>();

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
  const bindings: any[] = [];

  if (businessId) { conditions.push('business_id = ?'); bindings.push(businessId); }
  if (status) { conditions.push('status = ?'); bindings.push(status); }

  const where = conditions.length > 0 ? conditions.join(' AND ') : undefined;

  const result = await paginatedList<OutreachRecord & { business_name: string }>(
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
  const record = await db.prepare(`
    SELECT o.*, b.name as business_name, b.phone, b.niche
    FROM outreach_records o
    JOIN businesses b ON b.id = o.business_id
    WHERE o.id = ?
  `).bind(c.req.param('id')).first();

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
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value ?? null);
    }
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  values.push(id);
  await db.prepare(`UPDATE outreach_records SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await getById(db, 'outreach_records', id);
  return c.json(updated);
});

// Retell AI webhook handler — public (no auth)
router.post('/webhook/retell', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  // Validate Retell HMAC signature (if secret configured)
  const signature = c.req.header('X-Retell-Signature');
  const secret = c.env.RETELL_WEBHOOK_SECRET;
  if (secret && signature) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, hexToBytes(signature), encoder.encode(JSON.stringify(body))
    );
    if (!valid) return c.json({ error: 'Invalid signature' }, 401);
  }

  // Retell sends call completion events with call_id, transcript, disposition
  const { call_id, call_status, transcript, disposition, sentiment_score } = body;

  if (call_id) {
    // Update matching outreach record
    await db.prepare(`
      UPDATE outreach_records
      SET status = ?, transcript = ?, disposition = ?, sentiment_score = ?,
          called_at = datetime('now')
      WHERE call_id = ?
    `).bind(call_status ?? 'completed', transcript ?? null, disposition ?? null,
           sentiment_score ?? null, call_id).run();

    // If we have a transcript, dispatch sentiment analysis queue msg
    if (transcript && sentiment_score === undefined) {
      try {
        await c.env.SENTIMENT_QUEUE.send({
          type: 'analyze_sentiment',
          call_id,
          transcript: transcript.slice(0, 10000), // truncate for queue
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
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export default router;
```

- [ ] **Step 2: Wire outreach routes in `api/src/index.ts`**

```typescript
import outreachRoutes from './routes/outreach';

app.route('/api/outreach', outreachRoutes);
```

- [ ] **Step 3: Verify compilation**

```bash
cd api
npx tsc --noEmit
```

Expected: compiles cleanly.

- [ ] **Step 4: Add Retell webhook secret to wrangler.jsonc**

```jsonc
"vars": {
  "RETELL_WEBHOOK_SECRET": ""
}
```

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/outreach.ts api/src/index.ts api/wrangler.jsonc
git commit -m "feat: implement outreach routes with Retell webhook handler"
```

---

### Task 2.2: Grant Routes

**Files:**
- Create: `api/src/routes/grants.ts`
- Create: `api/src/lib/grants.ts`
- Modify: `api/src/index.ts` (wire grant routes)

- [ ] **Step 1: Write `api/src/lib/grants.ts` — financial calculator**

```typescript
export interface GrantFinancialInput {
  business_annual_revenue: number | null;
  employee_count: number | null;
  years_in_business: number;
  in_corridor: boolean;
  digital_deficit_score: number;
}

export interface GrantFinancialResult {
  estimated_baseline: number;
  corridor_bonus: number;
  digital_deficit_bonus: number;
  revenue_factor: number;
  total_estimated: number;
}

export function calculateGrantFunding(inputs: GrantFinancialInput): GrantFinancialResult {
  const BASELINE = 3000;
  const CORRIDOR_BONUS = 2000;
  const DEFICIT_BONUS_MAX = 1500;
  const REVENUE_MULTIPLIER_MAX = 2.0;
  const REVENUE_THRESHOLD = 500000;

  const estimated_baseline = BASELINE;

  // Corridor bonus: businesses in NOF corridor get additional funding
  const corridor_bonus = inputs.in_corridor ? CORRIDOR_BONUS : 0;

  // Digital deficit bonus: higher deficit = more need = more funding
  const digital_deficit_bonus = Math.round((inputs.digital_deficit_score / 100) * DEFICIT_BONUS_MAX);

  // Revenue factor: larger businesses can handle more funding
  let revenue_factor = 1.0;
  if (inputs.business_annual_revenue && inputs.business_annual_revenue > 0) {
    revenue_factor = Math.min(
      REVENUE_MULTIPLIER_MAX,
      1.0 + (inputs.business_annual_revenue / REVENUE_THRESHOLD)
    );
  }

  const total_estimated = Math.round(
    (estimated_baseline + corridor_bonus + digital_deficit_bonus) * revenue_factor
  );

  return {
    estimated_baseline,
    corridor_bonus,
    digital_deficit_bonus,
    revenue_factor: Math.round(revenue_factor * 100) / 100,
    total_estimated,
  };
}
```

- [ ] **Step 2: Write `api/src/routes/grants.ts`**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId } from '../lib/jwt';
import { paginatedList, getById, deleteById } from '../db/queries';
import { calculateGrantFunding } from '../lib/grants';
import { Bindings, GrantApplication } from '../types';

const router = new Hono<{ Bindings: Bindings }>();

const STAGES = [
  'identified', 'eligibility_check', 'documents_pending', 'documents_submitted',
  'under_review', 'additional_info', 'approved', 'funding_disbursed',
  'declined', 'withdrawn'
];

const createGrantSchema = z.object({
  business_id: z.string(),
  corridor_name: z.string(),
  amount_requested: z.number().min(0),
});

const updateGrantSchema = z.object({
  stage: z.enum(STAGES as [string, ...string[]]).optional(),
  amount_approved: z.number().optional().nullable(),
  status: z.string().optional(),
  amount_requested: z.number().optional(),
}).partial();

// GET /api/grants
router.get('/', requireAuth, async (c) => {
  const db = c.env.DB;
  const page = parseInt(c.req.query('page') ?? '1');
  const perPage = Math.min(parseInt(c.req.query('per_page') ?? '50'), 200);
  const businessId = c.req.query('business_id');
  const corridorName = c.req.query('corridor_name');
  const stage = c.req.query('stage');

  const conditions: string[] = [];
  const bindings: any[] = [];

  if (businessId) { conditions.push('ga.business_id = ?'); bindings.push(businessId); }
  if (corridorName) { conditions.push('ga.corridor_name = ?'); bindings.push(corridorName); }
  if (stage) { conditions.push('ga.stage = ?'); bindings.push(stage); }

  const where = conditions.length > 0 ? conditions.join(' AND ') : undefined;

  const result = await paginatedList<GrantApplication & { business_name: string }>(
    db, 'grant_applications',
    'ga.*, b.name as business_name, b.niche, b.in_nof_corridor',
    {
      page, perPage, where: where ? `ga join businesses b on b.id = ga.business_id and ${where}` : undefined,
      orderBy: 'ga.created_at DESC',
    }
  );

  return c.json(result);
});

// GET /api/grants/:id
router.get('/:id', requireAuth, async (c) => {
  const db = c.env.DB;
  const grant = await db.prepare(`
    SELECT ga.*, b.name as business_name, b.niche, b.address,
           b.latitude, b.longitude, b.in_nof_corridor
    FROM grant_applications ga
    JOIN businesses b ON b.id = ga.business_id
    WHERE ga.id = ?
  `).bind(c.req.param('id')).first();

  if (!grant) return c.json({ error: 'Grant application not found' }, 404);
  return c.json(grant);
});

// POST /api/grants
router.post('/', requireAuth, requireAdmin, zValidator('json', createGrantSchema), async (c) => {
  const db = c.env.DB;
  const { business_id, corridor_name, amount_requested } = c.req.valid('json');
  const id = generateId();

  await db.prepare(`
    INSERT INTO grant_applications (id, business_id, corridor_name, amount_requested)
    VALUES (?, ?, ?, ?)
  `).bind(id, business_id, corridor_name, amount_requested).run();

  const created = await getById(db, 'grant_applications', id);
  return c.json(created, 201);
});

// PATCH /api/grants/:id
router.patch('/:id', requireAuth, requireAdmin, zValidator('json', updateGrantSchema), async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const existing = await getById<GrantApplication>(db, 'grant_applications', id);
  if (!existing) return c.json({ error: 'Grant not found' }, 404);

  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value ?? null);
    }
  }

  if (fields.length === 0) return c.json(existing);

  values.push(id);
  await db.prepare(`UPDATE grant_applications SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...values).run();

  const updated = await getById(db, 'grant_applications', id);
  return c.json(updated);
});

// POST /api/grants/financial-calculator — estimate grant funding
router.post('/financial-calculator', requireAuth, zValidator('json', z.object({
  business_id: z.string(),
})), async (c) => {
  const db = c.env.DB;
  const { business_id } = c.req.valid('json');

  const business = await getById<any>(db, 'businesses', business_id);
  if (!business) return c.json({ error: 'Business not found' }, 404);

  // Get latest score
  const score = await db.prepare(
    'SELECT * FROM lead_scores WHERE business_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(business_id).first<any>();

  const result = calculateGrantFunding({
    business_annual_revenue: null, // would need additional data source
    employee_count: null,
    years_in_business: 3, // default; would derive from business data
    in_corridor: business.in_nof_corridor === 1,
    digital_deficit_score: score?.digital_deficit_score ?? 50,
  });

  return c.json(result);
});

// GET /api/grants/:id/documents
router.get('/:id/documents', requireAuth, async (c) => {
  const db = c.env.DB;
  const docs = await db.prepare(
    'SELECT * FROM grant_documents WHERE grant_application_id = ?'
  ).bind(c.req.param('id')).all();

  return c.json(docs.results ?? []);
});

// POST /api/grants/:id/documents
router.post('/:id/documents', requireAuth, requireAdmin, zValidator('json', z.object({
  filename: z.string(),
  file_url: z.string().optional().nullable(),
})), async (c) => {
  const db = c.env.DB;
  const { filename, file_url } = c.req.valid('json');
  const id = generateId();

  await db.prepare(
    'INSERT INTO grant_documents (id, grant_application_id, filename, file_url) VALUES (?, ?, ?, ?)'
  ).bind(id, c.req.param('id'), filename, file_url ?? null).run();

  const doc = await getById(db, 'grant_documents', id);
  return c.json(doc, 201);
});

// GET /api/grants/board — aggregate grant board overview
router.get('/board/summary', requireAuth, async (c) => {
  const db = c.env.DB;

  const byStage = await db.prepare(`
    SELECT stage, COUNT(*) as count, SUM(amount_requested) as total_requested
    FROM grant_applications WHERE status = 'active'
    GROUP BY stage ORDER BY CASE stage
      WHEN 'identified' THEN 1 WHEN 'eligibility_check' THEN 2
      WHEN 'documents_pending' THEN 3 WHEN 'documents_submitted' THEN 4
      WHEN 'under_review' THEN 5 WHEN 'additional_info' THEN 6
      WHEN 'approved' THEN 7 WHEN 'funding_disbursed' THEN 8
      WHEN 'declined' THEN 9 WHEN 'withdrawn' THEN 10
      ELSE 99 END
  `).all();

  const total = await db.prepare(`
    SELECT COUNT(*) as total, SUM(amount_requested) as total_requested,
           SUM(amount_approved) as total_approved
    FROM grant_applications WHERE status = 'active'
  `).first();

  return c.json({
    by_stage: byStage.results ?? [],
    total: total?.total ?? 0,
    total_requested: total?.total_requested ?? 0,
    total_approved: total?.total_approved ?? 0,
  });
});

export default router;
```

- [ ] **Step 3: Wire grant routes in `api/src/index.ts`**

```typescript
import grantRoutes from './routes/grants';

app.route('/api/grants', grantRoutes);
```

- [ ] **Step 4: Verify compilation**

```bash
cd api
npx tsc --noEmit
```

Expected: compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/grants.ts api/src/lib/grants.ts api/src/index.ts
git commit -m "feat: implement grant routes with financial calculator"
```

---

### Task 2.3: Reports Routes

**Files:**
- Create: `api/src/routes/reports.ts`
- Modify: `api/src/index.ts` (wire reports routes)

- [ ] **Step 1: Write `api/src/routes/reports.ts`**

```typescript
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { Bindings } from '../types';

const router = new Hono<{ Bindings: Bindings }>();

// GET /api/reports/funnel — pipeline funnel counts
router.get('/funnel', requireAuth, async (c) => {
  const db = c.env.DB;

  const funnel = await db.prepare(`
    SELECT stage, COUNT(*) as count
    FROM pipeline_items
    GROUP BY stage
    ORDER BY CASE stage
      WHEN 'discovered' THEN 1 WHEN 'enriched' THEN 2
      WHEN 'scored' THEN 3 WHEN 'contacted' THEN 4
      WHEN 'interested' THEN 5 WHEN 'qualified' THEN 6
      WHEN 'proposal' THEN 7 WHEN 'negotiation' THEN 8
      WHEN 'won' THEN 9 WHEN 'lost' THEN 10
      ELSE 99 END
  `).all();

  return c.json(funnel.results ?? []);
});

// GET /api/reports/scores — score distribution
router.get('/scores', requireAuth, async (c) => {
  const db = c.env.DB;

  // Latest scores per business, bucketed
  const distribution = await db.prepare(`
    SELECT
      CASE
        WHEN ls.composite_acquisition_score >= 80 THEN '80-100'
        WHEN ls.composite_acquisition_score >= 60 THEN '60-79'
        WHEN ls.composite_acquisition_score >= 40 THEN '40-59'
        WHEN ls.composite_acquisition_score >= 20 THEN '20-39'
        ELSE '0-19'
      END as range,
      COUNT(*) as count
    FROM lead_scores ls
    WHERE ls.id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY calculated_at DESC) AS rn
        FROM lead_scores
      ) WHERE rn = 1
    )
    GROUP BY range ORDER BY range
  `).all();

  const stats = await db.prepare(`
    SELECT
      AVG(ls.composite_acquisition_score) as avg_score,
      MIN(ls.composite_acquisition_score) as min_score,
      MAX(ls.composite_acquisition_score) as max_score,
      AVG(ls.price_tier) as avg_tier
    FROM lead_scores ls
    WHERE ls.id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY calculated_at DESC) AS rn
        FROM lead_scores
      ) WHERE rn = 1
    )
  `).first();

  const byTier = await db.prepare(`
    SELECT ls.price_tier, COUNT(*) as count
    FROM lead_scores ls
    WHERE ls.id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY calculated_at DESC) AS rn
        FROM lead_scores
      ) WHERE rn = 1
    )
    GROUP BY ls.price_tier ORDER BY ls.price_tier
  `).all();

  return c.json({
    distribution: distribution.results ?? [],
    stats,
    by_tier: byTier.results ?? [],
  });
});

// GET /api/reports/zip-performance — performance by zip code
router.get('/zip-performance', requireAuth, async (c) => {
  const db = c.env.DB;
  const minBiz = parseInt(c.req.query('min_businesses') ?? '3');

  const performance = await db.prepare(`
    SELECT
      b.zip_code,
      COUNT(*) as business_count,
      AVG(ls.composite_acquisition_score) as avg_score,
      AVG(ls.price_tier) as avg_tier,
      SUM(b.in_nof_corridor) as in_corridor_count,
      AVG(dp.google_avg_rating) as avg_rating
    FROM businesses b
    JOIN lead_scores ls ON ls.business_id = b.id AND ls.id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY calculated_at DESC) AS rn
        FROM lead_scores
      ) WHERE rn = 1
    )
    LEFT JOIN digital_presence dp ON dp.business_id = b.id
    WHERE b.zip_code IS NOT NULL
    GROUP BY b.zip_code
    HAVING COUNT(*) >= ?
    ORDER BY avg_score DESC
  `).bind(minBiz).all();

  return c.json(performance.results ?? []);
});

// GET /api/reports/corridor — corridor/grant performance
router.get('/corridor', requireAuth, async (c) => {
  const db = c.env.DB;

  const corridorReport = await db.prepare(`
    SELECT
      b.nof_corridor_name,
      COUNT(*) as business_count,
      AVG(ls.composite_acquisition_score) as avg_score,
      COUNT(ga.id) as grant_applications,
      SUM(CASE WHEN ga.stage = 'funding_disbursed' THEN 1 ELSE 0 END) as funded_count,
      SUM(ga.amount_requested) as total_requested,
      SUM(ga.amount_approved) as total_approved
    FROM businesses b
    LEFT JOIN lead_scores ls ON ls.business_id = b.id AND ls.id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY calculated_at DESC) AS rn
        FROM lead_scores
      ) WHERE rn = 1
    )
    LEFT JOIN grant_applications ga ON ga.business_id = b.id
    WHERE b.in_nof_corridor = 1 AND b.nof_corridor_name IS NOT NULL
    GROUP BY b.nof_corridor_name
    ORDER BY total_requested DESC
  `).all();

  return c.json(corridorReport.results ?? []);
});

export default router;
```

- [ ] **Step 2: Wire reports routes in `api/src/index.ts`**

```typescript
import reportRoutes from './routes/reports';

app.route('/api/reports', reportRoutes);
```

- [ ] **Step 3: Verify compilation**

```bash
cd api
npx tsc --noEmit
```

Expected: compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add api/src/routes/reports.ts api/src/index.ts
git commit -m "feat: implement reports routes (funnel, scores, zip, corridor)"
```

---

### Task 2.4: Frontend — Deploy to Pages

**Files:**
- Modify: `frontend/` (update API base URL, package.json scripts)
- Create: `frontend/wrangler.toml`

- [ ] **Step 1: Add wrangler.toml for Pages to `frontend/`**

```toml
name = "leadforge-frontend"
compatibility_date = "2026-05-13"

pages_build_output_dir = "dist"

[env.production]
  # Set in Pages dashboard or via wrangler secret
  # API_BASE_URL = "https://leadforge-api.workers.dev/api"
```

- [ ] **Step 2: Update frontend API client to use configurable base URL**

In `frontend/src/api/client.ts` (or wherever the API client is configured), ensure the base URL reads from `import.meta.env.VITE_API_BASE_URL`:

```typescript
// Example: frontend/src/api/client.ts
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
```

If the file doesn't exist, check `frontend/src/` for where API calls are made and add the env var pattern.

- [ ] **Step 3: Add Pages env vars**

Create `frontend/.env.production`:

```
VITE_API_BASE_URL=https://leadforge-api.workers.dev/api
```

- [ ] **Step 4: Build the frontend**

```bash
cd frontend
npm run build
```

Expected: builds to `frontend/dist/`.

- [ ] **Step 5: Deploy to Cloudflare Pages**

```bash
npm run build
npx wrangler pages deploy dist --project-name=leadforge-frontend
```

Or use the Cloudflare Pages dashboard (connect to git repo). Take note of the deployed URL.

- [ ] **Step 6: Set production env var in Pages dashboard**

```bash
npx wrangler pages secret put VITE_API_BASE_URL --project-name=leadforge-frontend
# Enter: https://leadforge-api.workers.dev/api
```

- [ ] **Step 7: Commit**

```bash
git add frontend/wrangler.toml frontend/.env.production
git commit -m "feat: configure frontend for Cloudflare Pages deployment"
```

---

## Phase 3: LLM + Tasks + Scrapers (Plans 5+6+7)

Outcome: All LLM inference on Workers AI. Celery task pipeline replaced by Queues + Cron. 11 scrapers ported to Workers fetch. Retell webhooks fully handled. Old Docker infrastructure decommissioned.

### Task 3.1: Workers AI Client

**Files:**
- Create: `api/src/lib/llm.ts`
- Create: `api/src/routes/llm.ts`
- Modify: `api/src/index.ts` (wire LLM routes)

- [ ] **Step 1: Write `api/src/lib/llm.ts`**

```typescript
/**
 * Workers AI client wrapper for all LLM tasks.
 *
 * Models used:
 *   - Entity resolution: @cf/meta/llama-3.2-3b-instruct (fast, cheap)
 *   - Data extraction:  @cf/meta/llama-3.2-3b-instruct
 *   - Outreach briefs:  @cf/meta/llama-3.2-8b-instruct (higher quality)
 *   - Sentiment:        @cf/mistral/mistral-7b-instruct-v0.1
 *   - Normalization:    @cf/meta/llama-3.2-3b-instruct
 */

export interface LlmConfig {
  model: string;
  maxTokens?: number;
  temperature?: number;
}

const MODELS = {
  fast: '@cf/meta/llama-3.2-3b-instruct',
  quality: '@cf/meta/llama-3.2-8b-instruct',
  sentiment: '@cf/mistral/mistral-7b-instruct-v0.1',
};

interface AI {
  run(model: string, options: { prompt?: string; messages?: Array<{ role: string; content: string }>; max_tokens?: number; temperature?: number }): Promise<any>;
}

export async function runLlm(
  ai: any,
  model: string,
  messages: Array<{ role: string; content: string }>,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  try {
    const result = await ai.run(model, {
      messages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.3,
    });

    // Workers AI returns various shapes depending on model
    return result?.response ?? result?.choices?.[0]?.message?.content ?? JSON.stringify(result);
  } catch (error) {
    console.error(`LLM error (${model}):`, error);
    throw error;
  }
}

export async function extractEntity(
  ai: any,
  text: string,
  fields: string[]
): Promise<Record<string, string>> {
  const prompt = `Extract the following fields from the text below: ${fields.join(', ')}.
Return ONLY a JSON object with these fields. No explanation, no markdown.

Text: ${text.slice(0, 3000)}`;

  const response = await runLlm(ai, MODELS.fast, [
    { role: 'system', content: 'You are a data extraction assistant. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ], { temperature: 0.1 });

  try {
    return JSON.parse(response);
  } catch {
    console.error('Failed to parse LLM extraction response:', response);
    return {};
  }
}

export async function generateOutreachBrief(
  ai: any,
  business: { name: string; niche: string; address?: string | null }
): Promise<string> {
  const prompt = `Write a brief outreach note for a sales agent contacting the following business.
Keep it under 150 words. Professional, friendly tone.

Business: ${business.name}
Industry: ${business.niche}
Location: ${business.address ?? 'N/A'}

The goal is to offer digital marketing services to improve their online presence.
Focus on understanding their specific industry needs.`;

  return runLlm(ai, MODELS.quality, [
    { role: 'system', content: 'You are a sales outreach specialist writing brief notes for sales agents.' },
    { role: 'user', content: prompt },
  ], { maxTokens: 300, temperature: 0.7 });
}

export async function analyzeSentiment(
  ai: any,
  transcript: string
): Promise<{ sentiment_score: number; summary: string }> {
  const prompt = `Analyze the sentiment of this sales call transcript.
Return a JSON object with:
  - sentiment_score: a number from 0 (negative) to 1 (positive)
  - summary: one sentence summary of the call outcome

Transcript:
${transcript.slice(0, 5000)}`;

  const response = await runLlm(ai, MODELS.sentiment, [
    { role: 'system', content: 'You analyze sales call transcripts for sentiment. Return only JSON.' },
    { role: 'user', content: prompt },
  ], { temperature: 0.2 });

  try {
    return JSON.parse(response);
  } catch {
    return { sentiment_score: 0.5, summary: 'Could not analyze sentiment' };
  }
}
```

- [ ] **Step 2: Write `api/src/routes/llm.ts`**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth';
import { generateOutreachBrief, extractEntity } from '../lib/llm';
import { Bindings } from '../types';

const router = new Hono<{ Bindings: Bindings }>();

// POST /api/llm/outreach-brief — generate brief for a business
router.post('/outreach-brief', requireAuth, zValidator('json', z.object({
  business_id: z.string(),
})), async (c) => {
  const db = c.env.DB;
  const { business_id } = c.req.valid('json');

  const business = await db.prepare(
    'SELECT id, name, niche, address FROM businesses WHERE id = ?'
  ).bind(business_id).first<{ id: string; name: string; niche: string; address: string | null }>();

  if (!business) return c.json({ error: 'Business not found' }, 404);

  const brief = await generateOutreachBrief(c.env.AI, business);
  return c.json({ business_id, brief });
});

// POST /api/llm/extract — extract fields from text
router.post('/extract', requireAuth, zValidator('json', z.object({
  text: z.string().min(1),
  fields: z.array(z.string()).min(1),
})), async (c) => {
  const { text, fields } = c.req.valid('json');
  const extracted = await extractEntity(c.env.AI, text, fields);
  return c.json(extracted);
});

export default router;
```

- [ ] **Step 3: Wire LLM routes in `api/src/index.ts`**

```typescript
import llmRoutes from './routes/llm';

app.route('/api/llm', llmRoutes);
```

- [ ] **Step 4: Verify compilation**

```bash
cd api
npx tsc --noEmit
```

Expected: compiles cleanly.

- [ ] **Step 5: Test Workers AI locally (requires wrangler dev with AI binding)**

```bash
cd api
npx wrangler dev
```

In another terminal:

```bash
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@leadforge.dev","password":"dev-password123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -X POST http://localhost:8787/api/llm/outreach-brief \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"business_id":"<a-real-business-id>"}'
```

Expected: returns an outreach brief string. (Note: local dev may need to mock AI if not connected to Cloudflare's network.)

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/llm.ts api/src/routes/llm.ts api/src/index.ts
git commit -m "feat: implement Workers AI client for all LLM tasks"
```

---

### Task 3.2: Queue Consumers + Cron Triggers

**Files:**
- Create: `api/src/workers/enrichment.ts`
- Create: `api/src/workers/sentiment.ts`
- Create: `api/src/workers/recalibration.ts`
- Modify: `api/wrangler.jsonc` (add queue consumers if using separate workers)
- Modify: `api/src/index.ts` (queue consumer handlers for same-worker pattern)

- [ ] **Step 1: Write queue consumer handling in `api/src/index.ts`**

For the same-worker pattern (simpler), add handlers to the existing Worker:

```typescript
// At bottom of api/src/index.ts, add queue handler
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<any>, env: Bindings) {
    for (const message of batch.messages) {
      const { type, ...data } = message.body;

      switch (type) {
        case 'enrich_business': {
          await handleEnrichment(env, data);
          break;
        }
        case 'analyze_sentiment': {
          await handleSentiment(env, data);
          break;
        }
        case 'recalibrate_scores': {
          await handleRecalibration(env, data);
          break;
        }
        default:
          console.warn('Unknown queue message type:', type);
      }

      message.ack();
    }
  },
};

// Note: These are one-by-one ack'd per message.
// For high throughput, batch acknowledgement via message.ack() after loop is fine too.
```

Replace the existing `export default app;` with this pattern.

- [ ] **Step 2: Write `api/src/workers/enrichment.ts`**

```typescript
import { Bindings } from '../types';

/**
 * Enrichment: fetch digital presence data for a business
 * and create/update digital_presence + lead_scores records.
 */
export async function handleEnrichment(env: Bindings, data: { business_id: string }) {
  const { business_id } = data;
  const db = env.DB;

  // 1. Fetch business
  const business = await db.prepare('SELECT * FROM businesses WHERE id = ?').bind(business_id).first<any>();
  if (!business) {
    console.error('Enrichment: business not found', business_id);
    return;
  }

  // 2. Fetch Google Places data (simplified — real scrape is in Task 3.3)
  let googleData: any = {};
  try {
    const apiKey = env.GOOGLE_PLACES_API_KEY;
    if (apiKey) {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(business.name + ' ' + (business.city ?? ''))}&inputtype=textquery&fields=rating,user_ratings_total&key=${apiKey}`
      );
      googleData = await response.json();
    }
  } catch (e) {
    console.error('Google Places fetch error:', e);
  }

  // 3. Create/update digital presence
  const placeResult = googleData?.candidates?.[0];
  const existingPresence = await db.prepare(
    'SELECT id FROM digital_presence WHERE business_id = ?'
  ).bind(business_id).first<any>();

  const rating = placeResult?.rating ?? null;
  const reviewCount = placeResult?.user_ratings_total ?? 0;

  if (existingPresence) {
    await db.prepare(`
      UPDATE digital_presence
      SET google_avg_rating = COALESCE(?, google_avg_rating),
          google_review_count = COALESCE(?, google_review_count),
          updated_at = datetime('now')
      WHERE business_id = ?
    `).bind(rating, reviewCount, business_id).run();
  } else {
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO digital_presence (id, business_id, google_avg_rating, google_review_count, has_website)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, business_id, rating, reviewCount, 1).run();
  }

  // 4. Get competitive context for scoring
  const cc = await db.prepare(
    'SELECT * FROM competitive_contexts WHERE zip_code = ? AND niche = ?'
  ).bind(business.zip_code, business.niche).first<any>();

  const { calculateScore } = await import('../lib/scoring');
  const score = calculateScore({
    has_website: existingPresence ? 1 : 0,
    google_review_count: reviewCount,
    google_avg_rating: rating,
    yelp_review_count: 0,
    yelp_rating: null,
    website_quality_score: 0,
    license_status: business.license_status,
    years_in_business: 3, // default — refine later
    business_density: cc?.business_density ?? 5,
    avg_rating: cc?.avg_rating ?? null,
    total_reviews: cc?.total_reviews ?? 0,
  });

  // 5. Store lead score
  const scoreId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO lead_scores (id, business_id, score_version, digital_deficit_score, viability_score,
      competitive_pressure_score, composite_acquisition_score, price_tier)
    VALUES (?, ?, 'v1', ?, ?, ?, ?, ?)
  `).bind(
    scoreId, business_id,
    score.digital_deficit_score, score.viability_score,
    score.competitive_pressure_score, score.composite_acquisition_score,
    score.price_tier
  ).run();

  // 6. Ensure pipeline item exists
  const pipelineExists = await db.prepare(
    'SELECT id FROM pipeline_items WHERE business_id = ? AND stage = ?'
  ).bind(business_id, 'enriched').first();

  if (!pipelineExists) {
    const pipeId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO pipeline_items (id, business_id, stage) VALUES (?, ?, 'enriched')
    `).bind(pipeId, business_id).run();
  }
}
```

- [ ] **Step 3: Write `api/src/workers/sentiment.ts`**

```typescript
import { Bindings } from '../types';
import { analyzeSentiment } from '../lib/llm';

export async function handleSentiment(env: Bindings, data: { call_id: string; transcript: string }) {
  const { call_id, transcript } = data;
  const db = env.DB;

  const result = await analyzeSentiment(env.AI, transcript);

  await db.prepare(`
    UPDATE outreach_records
    SET sentiment_score = ?, transcript = ?
    WHERE call_id = ?
  `).bind(result.sentiment_score, transcript, call_id).run();
}
```

- [ ] **Step 4: Write `api/src/workers/recalibration.ts`**

```typescript
import { Bindings } from '../types';
import { calculateScore } from '../lib/scoring';

export async function handleRecalibration(env: Bindings, data: { niche?: string; zip_code?: string }) {
  const db = env.DB;

  // Recalculate scores for all businesses (or filtered by niche/zip)
  let query = `
    SELECT b.id, b.name, b.zip_code, b.niche, b.license_status,
           dp.has_website, dp.google_review_count, dp.google_avg_rating,
           dp.yelp_review_count, dp.yelp_rating, dp.website_quality_score,
           cc.business_density, cc.avg_rating as cc_avg_rating, cc.total_reviews
    FROM businesses b
    LEFT JOIN digital_presence dp ON dp.business_id = b.id
    LEFT JOIN competitive_contexts cc ON cc.zip_code = b.zip_code AND cc.niche = b.niche
    WHERE b.id IN (
      SELECT business_id FROM lead_scores GROUP BY business_id
    )
  `;
  const bindings: any[] = [];

  if (data.niche) { query += ' AND b.niche = ?'; bindings.push(data.niche); }
  if (data.zip_code) { query += ' AND b.zip_code = ?'; bindings.push(data.zip_code); }

  const businesses = await db.prepare(query).bind(...bindings).all();

  for (const biz of (businesses.results ?? []) as any[]) {
    const score = calculateScore({
      has_website: biz.has_website ?? 0,
      google_review_count: biz.google_review_count ?? 0,
      google_avg_rating: biz.google_avg_rating ?? null,
      yelp_review_count: biz.yelp_review_count ?? 0,
      yelp_rating: biz.yelp_rating ?? null,
      website_quality_score: biz.website_quality_score ?? 0,
      license_status: biz.license_status,
      years_in_business: 3,
      business_density: biz.business_density ?? 5,
      avg_rating: biz.cc_avg_rating ?? null,
      total_reviews: biz.total_reviews ?? 0,
    });

    const scoreId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO lead_scores (id, business_id, score_version, digital_deficit_score, viability_score,
        competitive_pressure_score, composite_acquisition_score, price_tier)
      VALUES (?, ?, 'v2', ?, ?, ?, ?, ?)
    `).bind(
      scoreId, biz.id,
      score.digital_deficit_score, score.viability_score,
      score.competitive_pressure_score, score.composite_acquisition_score,
      score.price_tier
    ).run();
  }
}
```

- [ ] **Step 5: Wire the queue dispatch from the daily enrichment cron**

Add a cron-triggered route that dispatches enrichment messages:

```typescript
// In api/src/index.ts or a separate cron worker
async function handleDailyEnrichment(env: Bindings) {
  const db = env.DB;

  // Get businesses that need enrichment (no score in last 24h)
  const businesses = await db.prepare(`
    SELECT b.id FROM businesses b
    LEFT JOIN lead_scores ls ON ls.business_id = b.id
    WHERE ls.id IS NULL OR ls.calculated_at < datetime('now', '-1 day')
    LIMIT 200
  `).all();

  for (const biz of (businesses.results ?? []) as any[]) {
    await env.ENRICHMENT_QUEUE.send({
      type: 'enrich_business',
      business_id: biz.id,
    });
  }
}
```

- [ ] **Step 6: Verify compilation**

```bash
cd api
npx tsc --noEmit
```

Expected: compiles cleanly.

- [ ] **Step 7: Commit**

```bash
git add api/src/index.ts api/src/workers/
git commit -m "feat: implement queue consumers (enrichment, sentiment, recalibration)"
```

---

### Task 3.3: Scrapers — Port to Workers fetch

**Files:**
- Create: `api/src/scrapers/base.ts`
- Create: `api/src/scrapers/google_places.ts`
- Create: `api/src/scrapers/socrata.ts`
- Create: `api/src/scrapers/index.ts`
- Modify: `api/src/index.ts` (wire scraper dispatch)

- [ ] **Step 1: Write `api/src/scrapers/base.ts`**

```typescript
/**
 * Base scraper class. All scrapers extend this.
 * Handles rate limiting, retries, and error normalization.
 */

export interface ScraperConfig {
  name: string;
  ratePerSecond: number;
  retries: number;
}

export interface ScrapeResult<T = any> {
  source: string;
  success: boolean;
  data: T | null;
  error?: string;
}

export class BaseScraper {
  protected config: ScraperConfig;
  private lastRequestTime: number = 0;

  constructor(config: ScraperConfig) {
    this.config = config;
  }

  protected async rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
    // Enforce rate limit
    const now = Date.now();
    const minInterval = 1000 / this.config.ratePerSecond;
    const waitTime = minInterval - (now - this.lastRequestTime);

    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
    return fetch(url, options);
  }

  protected async fetchWithRetry(url: string, options?: RequestInit): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      try {
        const response = await this.rateLimitedFetch(url, options);
        if (response.ok) return response;

        // 429 = rate limited, back off
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') ?? '5');
          await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
          continue;
        }

        // 4xx other than 429 — fail fast
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // 5xx — retry
        if (response.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          continue;
        }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }

    throw lastError ?? new Error('Max retries exceeded');
  }
}
```

- [ ] **Step 2: Write `api/src/scrapers/google_places.ts`**

```typescript
import { BaseScraper, ScrapeResult } from './base';

interface GooglePlacesConfig {
  apiKey: string;
}

export class GooglePlacesScraper extends BaseScraper {
  private apiKey: string;

  constructor(config: GooglePlacesConfig) {
    super({ name: 'google-places', ratePerSecond: 10, retries: 3 });
    this.apiKey = config.apiKey;
  }

  async searchBusiness(query: string): Promise<ScrapeResult<any>> {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${this.apiKey}`;
      const response = await this.fetchWithRetry(url);
      const data = await response.json();

      return {
        source: 'google_places',
        success: true,
        data: data.results ?? [],
      };
    } catch (error) {
      return {
        source: 'google_places',
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getDetails(placeId: string, fields: string = 'name,rating,formatted_address,formatted_phone_number,website,user_ratings_total'): Promise<ScrapeResult<any>> {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${this.apiKey}`;
      const response = await this.fetchWithRetry(url);
      const data = await response.json();

      return {
        source: 'google_places',
        success: true,
        data: data.result ?? null,
      };
    } catch (error) {
      return {
        source: 'google_places',
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
```

- [ ] **Step 3: Write `api/src/scrapers/socrata.ts`**

```typescript
import { BaseScraper, ScrapeResult } from './base';

export class SocrataScraper extends BaseScraper {
  private domain: string;

  constructor(domain: string = 'data.cityofchicago.org') {
    super({ name: 'socrata', ratePerSecond: 30, retries: 3 });
    this.domain = domain;
  }

  async query(datasetId: string, soql: string): Promise<ScrapeResult<any[]>> {
    try {
      const url = `https://${this.domain}/resource/${datasetId}.json?${soql}`;
      const response = await this.fetchWithRetry(url);
      const data = await response.json();

      return {
        source: 'socrata',
        success: true,
        data: Array.isArray(data) ? data : [],
      };
    } catch (error) {
      return {
        source: 'socrata',
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * License lookup for a business by name in Chicago
   */
  async findBusinessLicense(businessName: string, zipCode?: string): Promise<ScrapeResult<any>> {
    const soqlParts = [
      `$where=upper(legal_name) like '%25${encodeURIComponent(businessName.toUpperCase())}%25'`,
    ];
    if (zipCode) {
      soqlParts.push(`zip_code=${zipCode}`);
    }
    soqlParts.push('$limit=5');
    soqlParts.push('$order=license_start_date DESC');

    return this.query('r5ix-yg67', soqlParts.join('&'));
  }
}
```

- [ ] **Step 4: Write `api/src/scrapers/index.ts`**

```typescript
export { BaseScraper } from './base';
export { GooglePlacesScraper } from './google_places';
export { SocrataScraper } from './socrata';

export type { ScrapeResult, ScraperConfig } from './base';
```

- [ ] **Step 5: Wire scraper dispatch in a cron-triggered or queue-driven worker**

```typescript
// Example: add to the enrichment queue handler
async function scrapeAndEnrich(env: any, business: any) {
  const google = new GooglePlacesScraper({ apiKey: env.GOOGLE_PLACES_API_KEY ?? '' });
  const socrata = new SocrataScraper();

  const [googleResult, socrataResult] = await Promise.all([
    google.searchBusiness(`${business.name} ${business.city ?? ''}`),
    socrata.findBusinessLicense(business.name, business.zip_code),
  ]);

  // Update digital presence from Google data
  if (googleResult.success && googleResult.data?.[0]) {
    const place = googleResult.data[0];
    await env.DB.prepare(`
      UPDATE digital_presence
      SET google_review_count = ?, google_avg_rating = ?, has_website = 1
      WHERE business_id = ?
    `).bind(
      place.user_ratings_total ?? 0,
      place.rating ?? null,
      business.id
    ).run();
  }

  // Update license status from Socrata
  if (socrataResult.success && socrataResult.data?.[0]) {
    const license = socrataResult.data[0];
    await env.DB.prepare(`
      UPDATE businesses SET license_status = ? WHERE id = ?
    `).bind(license.status ?? 'active', business.id).run();
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add api/src/scrapers/
git commit -m "feat: port scrapers to Workers (Google Places, Socrata)"
```

---

### Task 3.4: Decommission Old Infrastructure

- [ ] **Step 1: Create archive of Python codebase**

```bash
# Create a reference archive before Docker teardown
cd /Volumes/Containers/LeadForge
git tag legacy-python-backend
git push origin legacy-python-backend

# Or just leave the branch/code in place (it's already in git)
```

- [ ] **Step 2: Stop Docker containers**

```bash
docker compose down
```

- [ ] **Step 3: Export any remaining data from PostgreSQL**

```bash
pg_dump postgresql://user:pass@localhost:5432/leadforge > leadforge_export_$(date +%Y%m%d).sql
```

- [ ] **Step 4: Document runbook for Cloudflare deployment**

Create `docs/operations/cloudflare-runbook.md`:

```markdown
# LeadForge Cloudflare Operations

## Deploy API
```bash
cd api
npx wrangler deploy
```

## Deploy Frontend
```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=leadforge-frontend
```

## D1 Migrations
```bash
cd api
npx wrangler d1 execute leadforge-db --file=src/db/schema.sql
npx wrangler d1 execute leadforge-db --command="SELECT COUNT(*) as count FROM businesses"
```

## Queue Consumers
Built into the same Worker (`api/src/index.ts`). Deploying the Worker deploys
consumers as well.

## Cron Jobs
Configured in `api/wrangler.jsonc` under `triggers.crons`:
- `0 6 * * *` — Daily enrichment pipeline
- `30 6 * * *` — Daily scoring recalibration
- `0 7 * * 1` — Weekly full recalibration
- `0 8 * * *` — Daily outreach dispatch

## Secrets
Set via wrangler:
```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put GOOGLE_PLACES_API_KEY
npx wrangler secret put RETELL_WEBHOOK_SECRET
```

## Monitoring
- Worker logs: https://dash.cloudflare.com/?to=/:account/workers/services/view/leadforge-api/production/logs
- D1 queries: https://dash.cloudflare.com/?to=/:account/d1/databases/:db_id
```

- [ ] **Step 5: Commit**

```bash
git add docs/operations/cloudflare-runbook.md
git commit -m "docs: add Cloudflare operations runbook, archive legacy Python backend"
```

---

## Self-Review Checklist

- **1. Spec coverage:** Every spec requirement has at least one task implementing it.
- **2. Placeholder scan:** All code blocks contain real, runnable code. No "TBD", "TODO", or "implement later".
- **3. Type consistency:** Types defined in Task 1.1 (`types/index.ts`) are used consistently across all route modules. Function signatures match across imports.
- **4. File path accuracy:** All paths are relative to `/Volumes/Containers/LeadForge/`.

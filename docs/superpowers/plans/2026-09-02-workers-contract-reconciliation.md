# Workers Contract Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-port the Workers API (`api/`) so its D1 schema and HTTP contract match the Python API that the React frontend was built against, with a vitest suite ported one-to-one from `tests/api/`.

**Architecture:** One D1 table per SQLAlchemy model, shipped as a wrangler migration. One Hono router per Python route module, reproducing paths, query params, status codes, response shapes, stage enums and transition maps. Tests run inside workerd via `@cloudflare/vitest-plugin` against an isolated local D1 with the migration applied.

**Tech Stack:** TypeScript, Hono 4, Zod 4, Cloudflare Workers, D1, `@cloudflare/vitest-plugin` (vitest 4), wrangler 4.

**Spec:** `docs/superpowers/specs/2026-09-02-workers-contract-reconciliation-design.md`. Read it first. Behavioral references it names: `frontend/src/api/client.ts`, `frontend/src/types/index.ts`, `src/leadforge/api/routes/*.py`, `src/leadforge/api/schemas/*.py`, `src/leadforge/db/models/*.py`, `tests/api/test_*.py`.

## Global Constraints

- Every route mounts under `/api`. Error bodies are `{ "detail": string }`. Status codes: 401 unauthenticated, 403 viewer on a write, 404 missing row, 400 invalid enum value in a stage transition, 422 invalid transition or request validation failure.
- Pagination shape is `{ items, total, page, page_size }`. Query params are `page` (default 1, min 1) and `page_size` (default 20, min 1, max 100). `GET /grants` is the one exception and returns a bare array (Python parity).
- Booleans are stored as INTEGER 0/1 and serialized to JSON `true`/`false`. Timestamps are ISO-8601 UTC strings ending in `Z`. Dates are `YYYY-MM-DD`. IDs are `crypto.randomUUID()` strings.
- Never interpolate request data into SQL. Table names, column lists and ORDER BY fragments are literals from code; every value goes through `.bind()`.
- The main Hono app is constructed with `{ strict: false }` so `/api/grants` and `/api/grants/` both match.
- `JWT_SECRET` is required. If it is unset, auth routes and middleware return 500 `{ detail: "JWT_SECRET not configured" }`. There is no dev fallback.
- Every task ends with `npm run typecheck` and `npm test` passing in `api/`, then a commit. Commit messages carry no agent trailer.
- `api/src/lib/scoring.ts` is `keep!`: do not modify, do not import. It is re-ported in a later phase.

## Port DSL (used in task headers)

```
T <table>          create a D1 table mirroring the named SQLAlchemy model
R <METHOD> <path>  implement the route mirroring the named Python handler
=py <symbol>       behavioral source; reproduce exactly
~ <text>           approved deviation from =py; listed in the spec's Deviations section
X <thing>          delete; nothing consumes it
+test <name>       port the named Python test to vitest under the same name
V <command>        verification gate; must pass before the task's commit
keep! <path>       do not modify, even transitively
```

Unknown token: stop and ask.

## File Structure

```
api/
├── migrations/0001_initial.sql        T * — full schema (Task 1)
├── vitest.config.ts                   test plugin + migrations binding (Task 1)
├── test/
│   ├── apply-migrations.ts            setup file (Task 1)
│   ├── helpers.ts                     resetDb, createUser, tokenFor, createBusiness, createScore, createOutreach, api() (Task 1)
│   ├── auth.test.ts                   (Task 2)
│   ├── businesses.test.ts             (Task 3)
│   ├── leads.test.ts                  (Task 4)
│   ├── pipeline.test.ts               (Task 5)
│   ├── outreach.test.ts               (Task 6)
│   ├── webhooks.test.ts               (Task 6)
│   ├── grants.test.ts                 (Task 7)
│   ├── financial-calculator.test.ts   (Task 7)
│   └── reports.test.ts                (Task 8)
├── scripts/hash-password.mjs          bootstrap first admin (Task 2)
└── src/
    ├── index.ts                       app + mounts (Task 1 adds strict:false; Task 9 final wiring)
    ├── types/index.ts                 Bindings, row types, enums, AuthUser (Task 1)
    ├── db/
    │   ├── queries.ts                 X (Task 9) — replaced by serialize.ts + inline SQL
    │   └── serialize.ts               withBooleans + per-table boolean column lists (Task 1)
    ├── lib/
    │   ├── jwt.ts                     signToken/verifyToken with type claim; requireSecret (Task 2)
    │   ├── password.ts                PBKDF2 hashPassword/verifyPassword (Task 2)
    │   ├── validate.ts                jsonBody(schema), queryParams(schema) → 422 {detail} (Task 1)
    │   ├── stages.ts                  PIPELINE_STAGES, VALID_TRANSITIONS, NOF_STAGES, VALID_NOF_TRANSITIONS, BOARD_GROUPS (Task 1)
    │   ├── grants.ts                  computeGrantFinancials (Task 7, replaces invented calculator)
    │   └── scoring.ts                 keep!
    ├── middleware/auth.ts             requireAuth (loads user), requireAdmin (Task 2)
    └── routes/
        ├── auth.ts                    (Task 2)
        ├── businesses.ts              (Task 3)
        ├── leads.ts                   (Task 4)
        ├── pipeline.ts                (Task 5)
        ├── outreach.ts                (Task 6)
        ├── webhooks.ts                (Task 6)
        ├── grants.ts                  (Task 7)
        └── reports.ts                 (Task 8)
```

Task 1 and Task 2 are sequential. Tasks 3 through 8 depend only on Tasks 1 and 2 and can run in parallel. Task 9 runs last.

---

### Task 1: Schema, types, test harness

`T users businesses digital_presences lead_scores competitive_contexts outreach_records grant_applications grant_documents nof_corridors; X pipeline_items scoring_weights schema.sql; +harness`

**Files:**
- Create: `api/migrations/0001_initial.sql`
- Delete: `api/src/db/schema.sql`
- Rewrite: `api/src/types/index.ts`
- Create: `api/src/db/serialize.ts`, `api/src/lib/validate.ts`, `api/src/lib/stages.ts`
- Create: `api/vitest.config.ts`, `api/test/apply-migrations.ts`, `api/test/helpers.ts`, `api/test/schema.test.ts`
- Modify: `api/wrangler.jsonc` (add `migrations_dir`, remove `vars.RETELL_WEBHOOK_SECRET`), `api/package.json`, `api/tsconfig.json`, `api/src/index.ts` (`strict: false`)

**Interfaces:**
- Produces `types/index.ts`: `Bindings` (adds `RETELL_API_KEY?: string`, keeps `JWT_SECRET?: string`), `AuthUser = { id; email; full_name; role: 'admin'|'viewer'; is_active: boolean }`, `AppEnv = { Bindings: Bindings; Variables: { user: AuthUser } }`, row interfaces `UserRow`, `BusinessRow`, `DigitalPresenceRow`, `LeadScoreRow`, `OutreachRecordRow`, `GrantApplicationRow`, `GrantDocumentRow` whose fields are exactly the columns below.
- Produces `db/serialize.ts`: `withBooleans<T>(row: T, keys: readonly string[]): T` plus `USER_BOOLS`, `DIGITAL_PRESENCE_BOOLS`, `OUTREACH_BOOLS`, `GRANT_BOOLS`, `DOCUMENT_BOOLS`.
- Produces `lib/validate.ts`: `jsonBody(schema)` and `queryParams(schema)`, both Hono middlewares wrapping `zValidator` that answer 422 `{ detail }` on failure; handlers read `c.req.valid('json')` / `c.req.valid('query')`.
- Produces `lib/stages.ts`: the constants named above, typed `as const`, plus `PipelineStage` and `NofStage` union types.
- Produces `test/helpers.ts`: see Step 8 for exact signatures.

- [ ] **Step 1: Install the test plugin**

```bash
cd api
npm install -D @cloudflare/vitest-plugin
npm view @cloudflare/vitest-plugin version
```

Expected: a 1.x version. If the peer range in `npm view @cloudflare/vitest-plugin peerDependencies` excludes the installed vitest, stop and report.

- [ ] **Step 2: Write `api/migrations/0001_initial.sql`**

```sql
-- Mirrors src/leadforge/db/models/*.py. See spec §D1 schema for mapping rules.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  zip_code TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  owner_name TEXT,
  niche TEXT NOT NULL CHECK (niche IN (
    'septic_services', 'used_auto_parts', 'meat_markets', 'bars', 'nail_salons',
    'beauty_shops', 'smoke_shops', 'beauty_supply', 'mobile_mechanics', 'tire_shops',
    'lawn_services', 'towing', 'barbershops', 'veterinarians', 'security_services')),
  license_number TEXT,
  license_status TEXT CHECK (license_status IN ('active', 'expired', 'revoked', 'unknown')),
  license_issue_date TEXT,
  incorporation_date TEXT,
  employee_count_est INTEGER,
  estimated_monthly_revenue REAL,
  google_place_id TEXT UNIQUE,
  thumbtack_hires INTEGER,
  nextdoor_recommendations INTEGER,
  ig_location_tag_count INTEGER,
  ig_hashtag_mention_count INTEGER,
  fb_checkin_count INTEGER,
  fb_ugc_tag_count INTEGER,
  total_customer_ugc INTEGER,
  latitude REAL,
  longitude REAL,
  in_nof_corridor INTEGER NOT NULL DEFAULT 0,
  nof_corridor_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_businesses_zip ON businesses(zip_code);
CREATE INDEX idx_businesses_niche ON businesses(niche);
CREATE INDEX idx_businesses_corridor ON businesses(in_nof_corridor);

CREATE TABLE digital_presences (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  has_website INTEGER NOT NULL DEFAULT 0,
  website_url TEXT,
  website_quality_score REAL,
  has_ssl INTEGER,
  domain_registration_date TEXT,
  has_google_business_profile INTEGER NOT NULL DEFAULT 0,
  gbp_completeness_score REAL,
  google_review_count INTEGER DEFAULT 0,
  google_avg_rating REAL,
  review_velocity_30d REAL,
  has_facebook_page INTEGER NOT NULL DEFAULT 0,
  has_instagram INTEGER NOT NULL DEFAULT 0,
  fb_last_post_days_ago INTEGER,
  ig_follower_count INTEGER,
  ig_post_frequency REAL,
  has_google_ads INTEGER NOT NULL DEFAULT 0,
  has_meta_ads INTEGER NOT NULL DEFAULT 0,
  yelp_review_count INTEGER,
  yelp_rating REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE lead_scores (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  score_version INTEGER NOT NULL DEFAULT 1,
  digital_deficit_score REAL,
  viability_score REAL,
  competitive_pressure_score REAL,
  composite_acquisition_score REAL,
  nof_eligibility_score REAL,
  price_tier INTEGER,
  sentiment_adjustment REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (business_id, score_version)
);
CREATE INDEX idx_lead_scores_business ON lead_scores(business_id);

CREATE TABLE competitive_contexts (
  id TEXT PRIMARY KEY,
  zip_code TEXT NOT NULL,
  niche TEXT NOT NULL,
  competitor_count INTEGER NOT NULL DEFAULT 0,
  avg_digital_score REAL,
  competitor_ads_active_count INTEGER NOT NULL DEFAULT 0,
  avg_rating REAL,
  median_household_income REAL,
  population_density REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (zip_code, niche)
);
CREATE INDEX idx_competitive_contexts_zip ON competitive_contexts(zip_code);

CREATE TABLE outreach_records (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'scored' CHECK (status IN (
    'scored', 'queued', 'contacted', 'voicemail', 'engaged', 'meeting_scheduled',
    'proposal_sent', 'negotiating', 'won', 'lost', 'disqualified', 'nurture')),
  retell_call_id TEXT,
  first_contact_date TEXT,
  last_contact_date TEXT,
  contact_method TEXT,
  call_transcript TEXT,
  call_sentiment_score REAL,
  call_disposition TEXT CHECK (call_disposition IN ('answered', 'voicemail', 'no_answer', 'wrong_number')),
  call_attempts INTEGER NOT NULL DEFAULT 0,
  meeting_scheduled INTEGER NOT NULL DEFAULT 0,
  meeting_type TEXT CHECK (meeting_type IN ('virtual', 'in_person')),
  meeting_datetime TEXT,
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  assigned_to TEXT,
  notes TEXT,
  proposal_amount REAL,
  contract_amount REAL,
  lost_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_outreach_business ON outreach_records(business_id);
CREATE INDEX idx_outreach_retell_call ON outreach_records(retell_call_id);

CREATE TABLE grant_applications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'eligibility_assessed' CHECK (status IN (
    'eligibility_assessed', 'intake', 'applied', 'pipeline', 'finalist',
    'stage_1_legal', 'stage_2_docs', 'stage_3_financing', 'stage_3_construction',
    'stage_4_closing', 'stage_5_complete', 'alumnus', 'removed')),
  applied_date TEXT,
  finalist_date TEXT,
  cal_issued_date TEXT,
  completion_date TEXT,
  alumnus_date TEXT,
  total_project_cost REAL,
  base_grant_amount REAL,
  acquisition_cost REAL,
  acquisition_coverage_pct REAL,
  taf_amount REAL,
  owner_contribution REAL,
  financing_amount REAL,
  financing_verified INTEGER NOT NULL DEFAULT 0,
  corridor_name TEXT,
  corridor_type TEXT,
  is_priority_corridor INTEGER NOT NULL DEFAULT 0,
  gc_bid_amount REAL,
  project_description TEXT,
  exterior_work_pct REAL,
  has_site_control INTEGER NOT NULL DEFAULT 0,
  site_control_type TEXT,
  assigned_to TEXT,
  ta_provider TEXT,
  notes TEXT,
  lost_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_grants_business ON grant_applications(business_id);

CREATE TABLE grant_documents (
  id TEXT PRIMARY KEY,
  grant_application_id TEXT NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN (
    'site_control', 'gc_bid', 'bank_statement', 'architectural_drawings', 'business_plan',
    'strategic_plan', 'economic_disclosure', 'scofflaw_clearance', 'permit', 'insurance',
    'construction_timeline', 'completion_survey', 'waivers_of_lien', 'certificate_of_occupancy')),
  is_mandatory INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'missing',
  notes TEXT,
  received_date TEXT,
  reviewed_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_grant_documents_grant ON grant_documents(grant_application_id);

CREATE TABLE nof_corridors (
  id TEXT PRIMARY KEY,
  corridor_name TEXT NOT NULL,
  corridor_type TEXT NOT NULL CHECK (corridor_type IN ('eligible', 'priority')),
  source_updated_at TEXT,
  fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

Then `git rm api/src/db/schema.sql`.

- [ ] **Step 3: Point wrangler at the migrations directory and drop the webhook var**

In `api/wrangler.jsonc` change the D1 entry to:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "leadforge-db", "database_id": "1e6961e4-8e03-42bf-a466-a02cfc89cd05", "migrations_dir": "migrations" }
],
```

and delete the `"vars": { "RETELL_WEBHOOK_SECRET": "" }` block entirely.

- [ ] **Step 4: Write `api/src/lib/stages.ts`**

```ts
export const PIPELINE_STAGES = [
  'scored', 'queued', 'contacted', 'voicemail', 'engaged', 'meeting_scheduled',
  'proposal_sent', 'negotiating', 'won', 'lost', 'disqualified', 'nurture',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// =py src/leadforge/api/routes/pipeline.py VALID_TRANSITIONS
export const VALID_TRANSITIONS: Record<PipelineStage, readonly PipelineStage[]> = {
  scored: ['queued', 'disqualified'],
  queued: ['contacted', 'disqualified'],
  contacted: ['voicemail', 'engaged', 'disqualified', 'nurture'],
  voicemail: ['contacted', 'engaged', 'disqualified', 'nurture'],
  engaged: ['meeting_scheduled', 'lost', 'disqualified', 'nurture'],
  meeting_scheduled: ['proposal_sent', 'lost', 'disqualified', 'nurture'],
  proposal_sent: ['negotiating', 'lost', 'disqualified'],
  negotiating: ['won', 'lost', 'disqualified'],
  won: [],
  lost: ['nurture'],
  disqualified: [],
  nurture: ['queued'],
};

export const NOF_STAGES = [
  'eligibility_assessed', 'intake', 'applied', 'pipeline', 'finalist',
  'stage_1_legal', 'stage_2_docs', 'stage_3_financing', 'stage_3_construction',
  'stage_4_closing', 'stage_5_complete', 'alumnus', 'removed',
] as const;
export type NofStage = (typeof NOF_STAGES)[number];

// =py src/leadforge/api/routes/grants.py VALID_NOF_TRANSITIONS
export const VALID_NOF_TRANSITIONS: Record<NofStage, readonly NofStage[]> = {
  eligibility_assessed: ['intake', 'removed'],
  intake: ['applied', 'removed'],
  applied: ['pipeline', 'removed'],
  pipeline: ['finalist', 'removed'],
  finalist: ['stage_1_legal', 'removed'],
  stage_1_legal: ['stage_2_docs', 'removed'],
  stage_2_docs: ['stage_3_financing', 'removed'],
  stage_3_financing: ['stage_3_construction', 'removed'],
  stage_3_construction: ['stage_4_closing', 'removed'],
  stage_4_closing: ['stage_5_complete', 'removed'],
  stage_5_complete: ['alumnus', 'removed'],
  alumnus: [],
  removed: [],
};

// =py src/leadforge/api/routes/grants.py BOARD_GROUPS — column order for the grant board
export const BOARD_GROUPS: readonly NofStage[] = [
  'eligibility_assessed', 'intake', 'applied', 'pipeline',
  'finalist', 'stage_1_legal', 'stage_2_docs', 'stage_3_financing',
  'stage_3_construction', 'stage_4_closing', 'stage_5_complete',
  'alumnus', 'removed',
];

export const NICHES = [
  'septic_services', 'used_auto_parts', 'meat_markets', 'bars', 'nail_salons',
  'beauty_shops', 'smoke_shops', 'beauty_supply', 'mobile_mechanics', 'tire_shops',
  'lawn_services', 'towing', 'barbershops', 'veterinarians', 'security_services',
] as const;
```

- [ ] **Step 5: Write `api/src/db/serialize.ts`**

```ts
/** D1 stores booleans as 0/1. Convert the listed keys to JSON booleans; leave null alone. */
export function withBooleans<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of keys) {
    if (key in out && out[key] !== null && out[key] !== undefined) {
      out[key] = out[key] === 1 || out[key] === true;
    }
  }
  return out as T;
}

export const USER_BOOLS = ['is_active'] as const;
export const DIGITAL_PRESENCE_BOOLS = [
  'has_website', 'has_ssl', 'has_google_business_profile', 'has_facebook_page',
  'has_instagram', 'has_google_ads', 'has_meta_ads',
] as const;
export const OUTREACH_BOOLS = ['meeting_scheduled'] as const;
export const GRANT_BOOLS = ['financing_verified', 'is_priority_corridor', 'has_site_control'] as const;
export const DOCUMENT_BOOLS = ['is_mandatory'] as const;

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
```

- [ ] **Step 6: Write `api/src/lib/validate.ts`**

```ts
import { zValidator } from '@hono/zod-validator';
import type { ZodType } from 'zod';

// FastAPI answers 422 with a detail list on validation failure. Match the status; keep detail readable.
export function jsonBody<S extends ZodType>(schema: S) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) return c.json({ detail: result.error.issues }, 422);
  });
}

export function queryParams<S extends ZodType>(schema: S) {
  return zValidator('query', schema, (result, c) => {
    if (!result.success) return c.json({ detail: result.error.issues }, 422);
  });
}
```

- [ ] **Step 7: Rewrite `api/src/types/index.ts`**

```ts
import type { NofStage, PipelineStage } from '../lib/stages';

export interface Bindings {
  DB: D1Database;
  AI: Ai;
  COOKIE_STORE: KVNamespace;
  ENRICHMENT_QUEUE: Queue;
  OUTREACH_QUEUE: Queue;
  SENTIMENT_QUEUE: Queue;
  RECALIBRATION_QUEUE: Queue;
  JWT_SECRET?: string;
  RETELL_API_KEY?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'viewer';
  is_active: boolean;
}

export type AppEnv = { Bindings: Bindings; Variables: { user: AuthUser } };

export interface JwtPayload {
  sub: string;
  role: 'admin' | 'viewer';
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

export interface UserRow {
  id: string; email: string; password_hash: string; full_name: string;
  role: 'admin' | 'viewer'; is_active: number; last_login_at: string | null;
  created_at: string; updated_at: string;
}

export interface BusinessRow {
  id: string; name: string; address: string | null; zip_code: string; phone: string | null;
  email: string | null; owner_name: string | null; niche: string;
  license_number: string | null; license_status: string | null;
  license_issue_date: string | null; incorporation_date: string | null;
  employee_count_est: number | null; estimated_monthly_revenue: number | null;
  google_place_id: string | null; thumbtack_hires: number | null;
  nextdoor_recommendations: number | null; ig_location_tag_count: number | null;
  ig_hashtag_mention_count: number | null; fb_checkin_count: number | null;
  fb_ugc_tag_count: number | null; total_customer_ugc: number | null;
  latitude: number | null; longitude: number | null;
  in_nof_corridor: number; nof_corridor_name: string | null;
  created_at: string; updated_at: string;
}

export interface DigitalPresenceRow {
  id: string; business_id: string; has_website: number; website_url: string | null;
  website_quality_score: number | null; has_ssl: number | null; domain_registration_date: string | null;
  has_google_business_profile: number; gbp_completeness_score: number | null;
  google_review_count: number | null; google_avg_rating: number | null; review_velocity_30d: number | null;
  has_facebook_page: number; has_instagram: number; fb_last_post_days_ago: number | null;
  ig_follower_count: number | null; ig_post_frequency: number | null;
  has_google_ads: number; has_meta_ads: number; yelp_review_count: number | null; yelp_rating: number | null;
  created_at: string; updated_at: string;
}

export interface LeadScoreRow {
  id: string; business_id: string; score_version: number;
  digital_deficit_score: number | null; viability_score: number | null;
  competitive_pressure_score: number | null; composite_acquisition_score: number | null;
  nof_eligibility_score: number | null; price_tier: number | null; sentiment_adjustment: number | null;
  created_at: string; updated_at: string;
}

export interface OutreachRecordRow {
  id: string; business_id: string; status: PipelineStage; retell_call_id: string | null;
  first_contact_date: string | null; last_contact_date: string | null; contact_method: string | null;
  call_transcript: string | null; call_sentiment_score: number | null; call_disposition: string | null;
  call_attempts: number; meeting_scheduled: number; meeting_type: string | null;
  meeting_datetime: string | null; follow_up_count: number; assigned_to: string | null;
  notes: string | null; proposal_amount: number | null; contract_amount: number | null;
  lost_reason: string | null; created_at: string; updated_at: string;
}

export interface GrantApplicationRow {
  id: string; business_id: string; status: NofStage;
  applied_date: string | null; finalist_date: string | null; cal_issued_date: string | null;
  completion_date: string | null; alumnus_date: string | null;
  total_project_cost: number | null; base_grant_amount: number | null; acquisition_cost: number | null;
  acquisition_coverage_pct: number | null; taf_amount: number | null; owner_contribution: number | null;
  financing_amount: number | null; financing_verified: number;
  corridor_name: string | null; corridor_type: string | null; is_priority_corridor: number;
  gc_bid_amount: number | null; project_description: string | null; exterior_work_pct: number | null;
  has_site_control: number; site_control_type: string | null;
  assigned_to: string | null; ta_provider: string | null; notes: string | null; lost_reason: string | null;
  created_at: string; updated_at: string;
}

export interface GrantDocumentRow {
  id: string; grant_application_id: string; document_type: string; is_mandatory: number;
  status: string; notes: string | null; received_date: string | null; reviewed_date: string | null;
  created_at: string; updated_at: string;
}
```

If `Ai` is not a global type under the installed `@cloudflare/workers-types`, use `unknown` for the `AI` binding.

- [ ] **Step 8: Write the vitest config, setup file and helpers**

`api/vitest.config.ts`:

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            JWT_SECRET: 'test-secret-key-for-unit-tests-only-0123456789abcdef',
            RETELL_API_KEY: 'test-retell-key',
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
    include: ['test/**/*.test.ts'],
  },
});
```

If `readD1Migrations` is exported from `@cloudflare/vitest-plugin/config` instead of the package root in the installed version, import it from there. If the `ai` binding in `wrangler.jsonc` prevents the plugin from starting, copy `wrangler.jsonc` to `wrangler.test.jsonc` without the `ai` block and point `configPath` at it.

`api/test/apply-migrations.ts`:

```ts
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS);
```

Add to `api/tsconfig.json` `compilerOptions.types`: `"@cloudflare/vitest-plugin"` (keeps `cloudflare:test` typed), and add `"test"` to `include`.

`api/test/helpers.ts`:

```ts
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
```

`signToken` and `hashPassword` do not exist with these signatures until Task 2. For this task, write `helpers.ts` exactly as above and expect the typecheck to fail on those two imports until Task 2 lands; Task 1's own test does not import helpers.

- [ ] **Step 9: Write the schema test**

`api/test/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';

describe('D1 migration', () => {
  it('creates every table the Python models define', async () => {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' ORDER BY name"
    ).all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual([
      'businesses', 'competitive_contexts', 'digital_presences', 'grant_applications',
      'grant_documents', 'lead_scores', 'nof_corridors', 'outreach_records', 'users',
    ]);
  });

  it('rejects an outreach status outside the pipeline enum', async () => {
    await env.DB.prepare("INSERT INTO businesses (id, name, zip_code, niche) VALUES ('b1', 'B', '60619', 'barbershops')").run();
    await expect(
      env.DB.prepare("INSERT INTO outreach_records (id, business_id, status) VALUES ('o1', 'b1', 'discovered')").run()
    ).rejects.toThrow();
  });

  it('keeps one score row per business per version', async () => {
    await env.DB.prepare("INSERT INTO businesses (id, name, zip_code, niche) VALUES ('b1', 'B', '60619', 'barbershops')").run();
    await env.DB.prepare("INSERT INTO lead_scores (id, business_id, score_version) VALUES ('s1', 'b1', 1)").run();
    await env.DB.prepare("INSERT INTO lead_scores (id, business_id, score_version) VALUES ('s2', 'b1', 2)").run();
    await expect(
      env.DB.prepare("INSERT INTO lead_scores (id, business_id, score_version) VALUES ('s3', 'b1', 2)").run()
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 10: Set `strict: false` on the app and keep it compiling**

In `api/src/index.ts` change `const app = new Hono<{ Bindings: Bindings }>();` to `const app = new Hono<{ Bindings: Bindings }>({ strict: false });`.

The existing routes reference removed types (`Business`, `LeadScore`, `PipelineItem`, `OutreachRecord`, `GrantApplication`, `User`, `DigitalPresence`, `CompetitiveContext`). Until their tasks rewrite them, add temporary aliases at the bottom of `types/index.ts`:

```ts
// TEMPORARY — removed in Task 9 once every route is re-ported.
export type Business = BusinessRow;
export type LeadScore = LeadScoreRow;
export type OutreachRecord = OutreachRecordRow;
export type GrantApplication = GrantApplicationRow;
export type DigitalPresence = DigitalPresenceRow;
export interface CompetitiveContext { avg_rating: number | null; total_reviews: number | null; business_density: number | null }
export interface PipelineItem { id: string }
export interface User { id: string }
```

The old `JwtPayload` had an `email` field that `routes/auth.ts` reads; that route is rewritten in Task 2. For this task only, keep `email?: string` on `JwtPayload` and remove it in Task 2.

- [ ] **Step 11: V**

```bash
cd api
npm run typecheck
npx vitest run test/schema.test.ts
```

Expected: typecheck passes (helpers.ts is excluded by nothing, so if it fails on the Task 2 imports, temporarily add `// @ts-expect-error until Task 2` above each of the two imports and remove the comments in Task 2). Schema test: 3 passed.

- [ ] **Step 12: Commit**

```bash
git add api/migrations api/src api/test api/vitest.config.ts api/wrangler.jsonc api/package.json api/package-lock.json api/tsconfig.json
git rm --cached api/src/db/schema.sql 2>/dev/null; git add -u api/src/db
git commit -m "refactor(api): mirror Python models in D1 migration, add Workers vitest harness"
```

---

### Task 2: Auth (JWT with type claim, PBKDF2 passwords, user-loading middleware)

`R POST /auth/login; R POST /auth/refresh; R POST /auth/logout; R GET /auth/me; R POST /auth/signup ~admin-only; =py routes/auth.py deps.py auth/security.py; ~pbkdf2; ~signup; +test test_auth.py (13)`

**Files:**
- Rewrite: `api/src/lib/jwt.ts`, `api/src/middleware/auth.ts`, `api/src/routes/auth.ts`
- Create: `api/src/lib/password.ts`, `api/scripts/hash-password.mjs`, `api/test/auth.test.ts`
- Modify: `api/src/types/index.ts` (remove the temporary `email?` on `JwtPayload`)

**Interfaces:**
- Produces `lib/jwt.ts`: `signToken(payload: { sub: string; role: 'admin'|'viewer'; type: 'access'|'refresh' }, secret: string, expiresInSec: number): Promise<string>`, `verifyToken(token: string, secret: string): Promise<JwtPayload | null>`, `requireSecret(c: Context<AppEnv>): string | Response` (returns the secret or a 500 response).
- Produces `lib/password.ts`: `hashPassword(password: string): Promise<string>`, `verifyPassword(password: string, stored: string): Promise<boolean>`.
- Produces `middleware/auth.ts`: `requireAuth` (sets `c.get('user')` to `AuthUser`) and `requireAdmin`. Every later task chains `requireAuth` then `requireAdmin` on writes.

- [ ] **Step 1: Write the failing tests**

`api/test/auth.test.ts` — one `it` per Python test, same names:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { accessToken, adminUser, api, createBusiness, createUser, refreshToken, resetDb, viewerUser } from './helpers';

beforeEach(resetDb);

describe('auth', () => {
  it('test_login_valid_credentials', async () => {
    await adminUser();
    const res = await api('POST', '/auth/login', { json: { email: 'admin@test.com', password: 'testpassword12' } });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.access_token).toBeTypeOf('string');
    expect(data.token_type).toBe('bearer');
    expect(data.user.email).toBe('admin@test.com');
    expect(data.user.role).toBe('admin');
    expect(res.headers.get('set-cookie')).toContain('refresh_token=');
  });

  it('test_login_wrong_password', async () => {
    await adminUser();
    const res = await api('POST', '/auth/login', { json: { email: 'admin@test.com', password: 'wrongpassword1' } });
    expect(res.status).toBe(401);
    expect((await res.json() as any).detail).toBe('Invalid credentials');
  });

  it('test_login_nonexistent_email', async () => {
    const res = await api('POST', '/auth/login', { json: { email: 'nobody@test.com', password: 'testpassword12' } });
    expect(res.status).toBe(401);
    expect((await res.json() as any).detail).toBe('Invalid credentials');
  });

  it('test_login_deactivated_user', async () => {
    await createUser({ email: 'inactive@test.com', full_name: 'Inactive User', is_active: false });
    const res = await api('POST', '/auth/login', { json: { email: 'inactive@test.com', password: 'testpassword12' } });
    expect(res.status).toBe(401);
  });

  it('test_me_with_valid_token', async () => {
    const user = await adminUser();
    const res = await api('GET', '/auth/me', { token: await accessToken(user) });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.email).toBe('admin@test.com');
    expect(data.full_name).toBe('Test Admin');
    expect(data.role).toBe('admin');
    expect(data.is_active).toBe(true);
  });

  it('test_me_without_token', async () => {
    expect((await api('GET', '/auth/me')).status).toBe(401);
  });

  it('test_refresh_with_valid_cookie', async () => {
    const user = await adminUser();
    const res = await api('POST', '/auth/refresh', { headers: { Cookie: `refresh_token=${await refreshToken(user)}` } });
    expect(res.status).toBe(200);
    expect((await res.json() as any).access_token).toBeTypeOf('string');
  });

  it('test_refresh_without_cookie', async () => {
    expect((await api('POST', '/auth/refresh')).status).toBe(401);
  });

  it('test_refresh_rejects_access_token_in_cookie', async () => {
    const user = await adminUser();
    const res = await api('POST', '/auth/refresh', { headers: { Cookie: `refresh_token=${await accessToken(user)}` } });
    expect(res.status).toBe(401);
  });

  it('test_protected_get_accessible_by_viewer', async () => {
    const viewer = await viewerUser();
    await createBusiness();
    expect((await api('GET', '/businesses', { token: await accessToken(viewer) })).status).toBe(200);
  });

  it('test_protected_patch_rejected_for_viewer', async () => {
    const viewer = await viewerUser();
    const id = await createBusiness();
    const res = await api('PATCH', `/businesses/${id}`, { token: await accessToken(viewer), json: { name: 'Updated Name' } });
    expect(res.status).toBe(403);
  });

  it('test_protected_patch_accessible_by_admin', async () => {
    const admin = await adminUser();
    const id = await createBusiness();
    const res = await api('PATCH', `/businesses/${id}`, { token: await accessToken(admin), json: { name: 'Updated Name' } });
    expect(res.status).toBe(200);
  });

  it('test_logout_clears_cookie', async () => {
    const res = await api('POST', '/auth/logout');
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe('ok');
    expect(res.headers.get('set-cookie')).toMatch(/refresh_token=;/);
  });

  it('test_deactivated_user_token_rejected', async () => {
    const user = await createUser({ email: 'deact@test.com', full_name: 'Deactivated User' });
    const token = await accessToken(user);
    await env.DB.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(user.id).run();
    expect((await api('GET', '/auth/me', { token })).status).toBe(401);
  });

  it('test_signup_requires_admin', async () => {
    const viewer = await viewerUser();
    const res = await api('POST', '/auth/signup', {
      token: await accessToken(viewer),
      json: { email: 'new@test.com', password: 'testpassword12', full_name: 'New', role: 'viewer' },
    });
    expect(res.status).toBe(403);
  });

  it('test_signup_creates_user_who_can_log_in', async () => {
    const admin = await adminUser();
    const res = await api('POST', '/auth/signup', {
      token: await accessToken(admin),
      json: { email: 'new@test.com', password: 'testpassword12', full_name: 'New User', role: 'viewer' },
    });
    expect(res.status).toBe(201);
    const login = await api('POST', '/auth/login', { json: { email: 'new@test.com', password: 'testpassword12' } });
    expect(login.status).toBe(200);
  });
});
```

The two `businesses` tests will pass only after Task 3; until then they are expected to fail with 404. Run this file with `-t "auth"` and note those two as pending in the commit message.

- [ ] **Step 2: Run to verify failures**

```bash
cd api && npx vitest run test/auth.test.ts
```

Expected: FAIL (helpers import `signToken`/`hashPassword` with the new signatures that do not exist yet).

- [ ] **Step 3: Write `api/src/lib/password.ts`**

```ts
// PBKDF2-SHA256 via Web Crypto. Format: pbkdf2$<iterations>$<salt_b64url>$<hash_b64url>
// Iterations are read back from the stored string, so raising ITERATIONS never breaks old hashes.
// 50k keeps login within Workers CPU limits; bcrypt from Python is not portable and no user rows migrate.
const ITERATIONS = 50_000;
const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterStr || !saltB64 || !hashB64) return false;
  const computed = await derive(password, fromB64url(saltB64), parseInt(iterStr, 10));
  const expected = fromB64url(hashB64);
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed[i] ^ expected[i];
  return diff === 0;
}
```

- [ ] **Step 4: Rewrite `api/src/lib/jwt.ts`**

Keep the existing `base64UrlEncode`, `base64UrlDecode`, `createHmacKey` and `generateId` bodies. Replace `signToken`, `verifyToken`, delete `hashPassword`/`verifyPassword` (moved), and add `requireSecret`:

```ts
import type { Context } from 'hono';
import type { AppEnv, JwtPayload } from '../types';

export async function signToken(
  payload: Pick<JwtPayload, 'sub' | 'role' | 'type'>,
  secret: string,
  expiresInSec: number
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
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
```

Remove `email?` from `JwtPayload` in `types/index.ts`.

- [ ] **Step 5: Rewrite `api/src/middleware/auth.ts`**

```ts
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
```

- [ ] **Step 6: Rewrite `api/src/routes/auth.ts`**

```ts
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
```

- [ ] **Step 7: Write `api/scripts/hash-password.mjs`**

```js
#!/usr/bin/env node
// Prints a password hash in the same format as src/lib/password.ts, for bootstrapping the first admin:
//   node scripts/hash-password.mjs 'your-password'
//   npx wrangler d1 execute leadforge-db --remote --command "INSERT INTO users (id, email, password_hash, full_name, role) VALUES ('<uuid>', 'you@example.com', '<hash>', 'Your Name', 'admin')"
import { webcrypto as crypto } from 'node:crypto';

const ITERATIONS = 50_000; // keep equal to src/lib/password.ts
const password = process.argv[2];
if (!password) { console.error('usage: hash-password.mjs <password>'); process.exit(1); }

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
console.log(`pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`);
```

- [ ] **Step 8: V**

```bash
cd api
npm run typecheck
npx vitest run test/auth.test.ts
node scripts/hash-password.mjs demo | head -c 20; echo
```

Expected: typecheck clean (remove any `@ts-expect-error` left in helpers from Task 1). Auth tests: 16 passed. The three `test_protected_*` cases exercise the old businesses route through the new middleware; if any of them fails on the old route's shape, note it in the commit message and confirm it passes after Task 3. Hash output starts with `pbkdf2$50000$`.

- [ ] **Step 9: Commit**

```bash
git add api/src/lib/jwt.ts api/src/lib/password.ts api/src/middleware/auth.ts api/src/routes/auth.ts api/src/types/index.ts api/scripts/hash-password.mjs api/test/auth.test.ts api/test/helpers.ts
git commit -m "refactor(api): port auth to Python contract (type claim, cookie refresh, PBKDF2, user-loading middleware)"
```

---

### Task 3: Businesses

`R GET /businesses; R GET /businesses/:id; R PATCH /businesses/:id; X POST /businesses; X DELETE /businesses/:id; =py routes/businesses.py schemas/business.py; +test test_businesses.py (11)`

**Files:**
- Rewrite: `api/src/routes/businesses.ts`
- Create: `api/test/businesses.test.ts`

**Interfaces:**
- Consumes: `requireAuth`, `requireAdmin`, `jsonBody`, `queryParams`, `withBooleans`, `DIGITAL_PRESENCE_BOOLS`, `OUTREACH_BOOLS`, `NICHES`, `nowIso`, row types.
- Produces: the SQL fragments `LATEST_SCORE_JOIN` and `LATEST_OUTREACH_JOIN` exported from this file; Tasks 4 and 8 reuse them verbatim.

**Contract (=py):**

| Route | Query / body | Response |
|---|---|---|
| `GET /businesses` | `page`, `page_size`, `zip_code`, `niche` (must be a NICHES value, else 422), `min_score`, `max_score`, `stage`, `search` (case-insensitive substring on name), `sort_by` in `name`,`zip_code`,`composite_acquisition_score`,`created_at` (default composite), `sort_dir` `asc`/`desc` (default desc) | `{ items: BusinessListItem[], total, page, page_size }` where item = `id,name,address,zip_code,phone,niche,license_status,created_at,composite_acquisition_score,price_tier,pipeline_stage` |
| `GET /businesses/:id` | | `BusinessDetail`: business columns listed in `schemas/business.py BusinessDetail` plus `digital_presence` (object or null, keys per `DigitalPresenceSummary`), `lead_scores` (array, keys per `LeadScoreSummary`, ordered by `score_version` desc), `outreach_records` (array, keys per `OutreachSummary`, ordered by `created_at` desc). 404 `Business not found`. |
| `PATCH /businesses/:id` | admin; body any subset of `name,address,phone,email,owner_name`; `notes` is accepted and ignored (Python's model has no such column) | the same `BusinessDetail`; 404 |

`~stage filter`: Python joins all outreach rows, which duplicates a business that has several records at that stage. Use `EXISTS (SELECT 1 FROM outreach_records o WHERE o.business_id = b.id AND o.status = ?)` instead.

- [ ] **Step 1: Write the failing tests**

`api/test/businesses.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { accessToken, adminUser, api, createBusiness, createOutreach, createScore, resetDb } from './helpers';

let token: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); });

describe('TestListBusinesses', () => {
  it('test_list_empty', async () => {
    const res = await api('GET', '/businesses', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total: 0, items: [], page: 1, page_size: 20 });
  });

  it('test_list_returns_business', async () => {
    await createBusiness();
    const data = await (await api('GET', '/businesses', { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.items[0].name).toBe('Test Barbershop');
    expect(data.items[0].zip_code).toBe('60619');
    expect(data.items[0]).toMatchObject({ composite_acquisition_score: null, price_tier: null, pipeline_stage: null });
  });

  it('test_filter_by_zip', async () => {
    await createBusiness();
    expect((await (await api('GET', '/businesses?zip_code=99999', { token })).json() as any).total).toBe(0);
    expect((await (await api('GET', '/businesses?zip_code=60619', { token })).json() as any).total).toBe(1);
  });

  it('test_filter_by_niche', async () => {
    await createBusiness();
    expect((await (await api('GET', '/businesses?niche=barbershops', { token })).json() as any).total).toBe(1);
    expect((await (await api('GET', '/businesses?niche=nail_salons', { token })).json() as any).total).toBe(0);
    expect((await api('GET', '/businesses?niche=bogus', { token })).status).toBe(422);
  });

  it('test_search_by_name', async () => {
    await createBusiness();
    expect((await (await api('GET', '/businesses?search=barbershop', { token })).json() as any).total).toBe(1);
    expect((await (await api('GET', '/businesses?search=nonexistent', { token })).json() as any).total).toBe(0);
  });

  it('test_pagination', async () => {
    await createBusiness();
    await createBusiness({ name: 'Second Shop' });
    const data = await (await api('GET', '/businesses?page=1&page_size=1', { token })).json() as any;
    expect(data.items).toHaveLength(1);
    expect(data.page).toBe(1);
    expect(data.total).toBe(2);
  });

  it('test_requires_auth', async () => {
    await createBusiness();
    expect((await api('GET', '/businesses', { headers: { 'X-API-Key': 'wrong' } })).status).toBe(401);
  });

  it('flattens latest score and latest outreach stage onto list items', async () => {
    const id = await createBusiness();
    await createScore(id, { score_version: 1, composite_acquisition_score: 10, price_tier: 1 });
    await createScore(id, { score_version: 2, composite_acquisition_score: 48.25, price_tier: 2 });
    await createOutreach(id, { status: 'scored' });
    await createOutreach(id, { status: 'queued' });
    const data = await (await api('GET', '/businesses', { token })).json() as any;
    expect(data.items[0].composite_acquisition_score).toBe(48.25);
    expect(data.items[0].price_tier).toBe(2);
    expect(data.items[0].pipeline_stage).toBe('queued');
    expect((await (await api('GET', '/businesses?min_score=50', { token })).json() as any).total).toBe(0);
    expect((await (await api('GET', '/businesses?stage=queued', { token })).json() as any).total).toBe(1);
  });
});

describe('TestGetBusiness', () => {
  it('test_get_detail', async () => {
    const id = await createBusiness();
    const res = await api('GET', `/businesses/${id}`, { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toMatchObject({ name: 'Test Barbershop', zip_code: '60619', niche: 'barbershops', digital_presence: null, lead_scores: [], outreach_records: [] });
  });

  it('test_not_found', async () => {
    expect((await api('GET', `/businesses/${crypto.randomUUID()}`, { token })).status).toBe(404);
  });
});

describe('TestUpdateBusiness', () => {
  it('test_patch_fields', async () => {
    const id = await createBusiness();
    const res = await api('PATCH', `/businesses/${id}`, { token, json: { name: 'Updated Name', phone: '(312) 555-9999' } });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.name).toBe('Updated Name');
    expect(data.phone).toBe('(312) 555-9999');
  });

  it('test_patch_not_found', async () => {
    expect((await api('PATCH', `/businesses/${crypto.randomUUID()}`, { token, json: { name: 'X' } })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd api && npx vitest run test/businesses.test.ts
```

Expected: FAIL (old route returns `{ data, perPage }`, no detail nesting).

- [ ] **Step 3: Rewrite `api/src/routes/businesses.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { jsonBody, queryParams } from '../lib/validate';
import { NICHES } from '../lib/stages';
import { nowIso, withBooleans, DIGITAL_PRESENCE_BOOLS, OUTREACH_BOOLS } from '../db/serialize';
import type { AppEnv, BusinessRow, DigitalPresenceRow, LeadScoreRow, OutreachRecordRow } from '../types';

const router = new Hono<AppEnv>();

/** Latest score per business (highest score_version). Alias: ls. Reused by leads and reports. */
export const LATEST_SCORE_JOIN = `
  LEFT JOIN (
    SELECT business_id, composite_acquisition_score, price_tier FROM (
      SELECT business_id, composite_acquisition_score, price_tier,
             ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY score_version DESC) AS rn
      FROM lead_scores
    ) WHERE rn = 1
  ) ls ON ls.business_id = b.id`;

/** Latest outreach record per business (newest created_at). Alias: lo. */
export const LATEST_OUTREACH_JOIN = `
  LEFT JOIN (
    SELECT business_id, status FROM (
      SELECT business_id, status,
             ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC, rowid DESC) AS rn
      FROM outreach_records
    ) WHERE rn = 1
  ) lo ON lo.business_id = b.id`;

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  zip_code: z.string().optional(),
  niche: z.enum(NICHES).optional(),
  min_score: z.coerce.number().optional(),
  max_score: z.coerce.number().optional(),
  stage: z.string().optional(),
  search: z.string().optional(),
  sort_by: z.enum(['name', 'zip_code', 'composite_acquisition_score', 'created_at']).default('composite_acquisition_score'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
});

const updateBody = z.object({
  name: z.string().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  owner_name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(), // accepted, ignored: no column (=py BusinessUpdate)
});

const SORT_COLUMNS = {
  name: 'b.name',
  zip_code: 'b.zip_code',
  composite_acquisition_score: 'ls.composite_acquisition_score',
  created_at: 'b.created_at',
} as const;

// =py routes/businesses.list_businesses
router.get('/', requireAuth, queryParams(listQuery), async (c) => {
  const q = c.req.valid('query');
  const db = c.env.DB;
  const where: string[] = [];
  const binds: unknown[] = [];

  if (q.zip_code) { where.push('b.zip_code = ?'); binds.push(q.zip_code); }
  if (q.niche) { where.push('b.niche = ?'); binds.push(q.niche); }
  if (q.search) { where.push('b.name LIKE ? COLLATE NOCASE'); binds.push(`%${q.search}%`); }
  if (q.min_score !== undefined) { where.push('ls.composite_acquisition_score >= ?'); binds.push(q.min_score); }
  if (q.max_score !== undefined) { where.push('ls.composite_acquisition_score <= ?'); binds.push(q.max_score); }
  if (q.stage) { where.push('EXISTS (SELECT 1 FROM outreach_records o WHERE o.business_id = b.id AND o.status = ?)'); binds.push(q.stage); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM businesses b ${LATEST_SCORE_JOIN} ${LATEST_OUTREACH_JOIN} ${whereSql}`;
  const nulls = q.sort_dir === 'desc' ? 'NULLS LAST' : 'NULLS FIRST';
  const orderSql = `ORDER BY ${SORT_COLUMNS[q.sort_by]} ${q.sort_dir.toUpperCase()} ${nulls}`;

  const count = await db.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...binds).first<{ n: number }>();
  const rows = await db
    .prepare(`SELECT b.id, b.name, b.address, b.zip_code, b.phone, b.niche, b.license_status, b.created_at,
                     ls.composite_acquisition_score, ls.price_tier, lo.status AS pipeline_stage
              ${from} ${orderSql} LIMIT ? OFFSET ?`)
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all();

  return c.json({ items: rows.results ?? [], total: count?.n ?? 0, page: q.page, page_size: q.page_size });
});

const DETAIL_COLUMNS = `id, name, address, zip_code, phone, email, owner_name, niche, license_number, license_status,
  license_issue_date, incorporation_date, employee_count_est, estimated_monthly_revenue, google_place_id,
  thumbtack_hires, nextdoor_recommendations, total_customer_ugc, created_at, updated_at`;

// =py schemas/business.BusinessDetail (with DigitalPresenceSummary, LeadScoreSummary, OutreachSummary)
async function loadDetail(db: D1Database, id: string) {
  const business = await db.prepare(`SELECT ${DETAIL_COLUMNS} FROM businesses WHERE id = ?`).bind(id).first<BusinessRow>();
  if (!business) return null;
  const [dp, scores, outreach] = await Promise.all([
    db.prepare(`SELECT has_website, website_url, website_quality_score, has_google_business_profile, gbp_completeness_score,
                       google_review_count, google_avg_rating, has_facebook_page, has_instagram, ig_follower_count,
                       has_google_ads, has_meta_ads, yelp_review_count, yelp_rating
                FROM digital_presences WHERE business_id = ?`).bind(id).first<DigitalPresenceRow>(),
    db.prepare(`SELECT id, score_version, digital_deficit_score, viability_score, competitive_pressure_score,
                       composite_acquisition_score, price_tier, sentiment_adjustment
                FROM lead_scores WHERE business_id = ? ORDER BY score_version DESC`).bind(id).all<LeadScoreRow>(),
    db.prepare(`SELECT id, status, retell_call_id, first_contact_date, last_contact_date, call_disposition,
                       call_attempts, meeting_scheduled, assigned_to, notes
                FROM outreach_records WHERE business_id = ? ORDER BY created_at DESC`).bind(id).all<OutreachRecordRow>(),
  ]);
  return {
    ...business,
    digital_presence: dp ? withBooleans(dp, DIGITAL_PRESENCE_BOOLS) : null,
    lead_scores: scores.results ?? [],
    outreach_records: (outreach.results ?? []).map((r) => withBooleans(r, OUTREACH_BOOLS)),
  };
}

// =py routes/businesses.get_business
router.get('/:id', requireAuth, async (c) => {
  const detail = await loadDetail(c.env.DB, c.req.param('id'));
  if (!detail) return c.json({ detail: 'Business not found' }, 404);
  return c.json(detail);
});

// =py routes/businesses.update_business
router.patch('/:id', requireAuth, requireAdmin, jsonBody(updateBody), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const exists = await db.prepare('SELECT id FROM businesses WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ detail: 'Business not found' }, 404);

  const body = c.req.valid('json');
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of ['name', 'address', 'phone', 'email', 'owner_name'] as const) {
    if (body[key] !== undefined) { sets.push(`${key} = ?`); binds.push(body[key]); }
  }
  if (sets.length) {
    sets.push('updated_at = ?'); binds.push(nowIso());
    await db.prepare(`UPDATE businesses SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  }
  return c.json(await loadDetail(db, id));
});

export default router;
```

- [ ] **Step 4: V**

```bash
cd api && npm run typecheck && npx vitest run test/businesses.test.ts test/auth.test.ts
```

Expected: businesses 12 passed; auth now 16 passed (the two businesses-dependent cases turn green).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/businesses.ts api/test/businesses.test.ts
git commit -m "refactor(api): port businesses routes to Python contract"
```

---

### Task 4: Leads

`R GET /leads/ranked; R GET /leads/:business_id/score; X GET /leads; X GET /leads/:id; X POST /leads/calculate/:businessId; X DELETE /leads/:id; =py routes/leads.py schemas/lead_score.py; +test test_leads.py (6); keep! lib/scoring.ts`

**Files:**
- Rewrite: `api/src/routes/leads.ts`
- Create: `api/test/leads.test.ts`

**Interfaces:**
- Consumes: `LATEST_SCORE_JOIN`, `LATEST_OUTREACH_JOIN` from `routes/businesses.ts`; `queryParams`; `NICHES`.

**Contract (=py):**

| Route | Query | Response |
|---|---|---|
| `GET /leads/ranked` | `page`, `page_size`, `zip_code`, `niche` (NICHES, else 422), `min_score`, `price_tier` (int) | `{ items: RankedLead[], total, page, page_size }`; item = `business_id, business_name, zip_code, niche, composite_acquisition_score, price_tier, pipeline_stage`; ordered by latest composite score desc, nulls last |
| `GET /leads/:business_id/score` | | array of `ScoreBreakdown` (`id, business_id, score_version, digital_deficit_score, viability_score, competitive_pressure_score, composite_acquisition_score, price_tier, sentiment_adjustment`) ordered by `score_version` desc; 404 `No scores found for this business` when empty |

- [ ] **Step 1: Write the failing tests**

`api/test/leads.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { accessToken, adminUser, api, createBusiness, createOutreach, createScore, resetDb } from './helpers';

let token: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); });

describe('TestRankedLeads', () => {
  it('test_ranked_empty', async () => {
    const res = await api('GET', '/leads/ranked', { token });
    expect(res.status).toBe(200);
    expect((await res.json() as any).total).toBe(0);
  });

  it('test_ranked_with_scores', async () => {
    const id = await createBusiness();
    await createScore(id);
    const data = await (await api('GET', '/leads/ranked', { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.items[0].business_name).toBe('Test Barbershop');
    expect(data.items[0].composite_acquisition_score).toBeCloseTo(48.25);
    expect(data.items[0].pipeline_stage).toBeNull();
  });

  it('test_filter_by_min_score', async () => {
    const id = await createBusiness();
    await createScore(id);
    expect((await (await api('GET', '/leads/ranked?min_score=50', { token })).json() as any).total).toBe(0);
    expect((await (await api('GET', '/leads/ranked?min_score=40', { token })).json() as any).total).toBe(1);
  });

  it('test_filter_by_price_tier', async () => {
    const id = await createBusiness();
    await createScore(id);
    expect((await (await api('GET', '/leads/ranked?price_tier=2', { token })).json() as any).total).toBe(1);
    expect((await (await api('GET', '/leads/ranked?price_tier=1', { token })).json() as any).total).toBe(0);
  });

  it('ranks by the latest score version and reports the latest stage', async () => {
    const low = await createBusiness({ name: 'Low' });
    await createScore(low, { score_version: 1, composite_acquisition_score: 90 });
    await createScore(low, { score_version: 2, composite_acquisition_score: 10 });
    const high = await createBusiness({ name: 'High' });
    await createScore(high, { composite_acquisition_score: 50 });
    await createOutreach(high, { status: 'engaged' });
    const data = await (await api('GET', '/leads/ranked', { token })).json() as any;
    expect(data.items.map((i: any) => i.business_name)).toEqual(['High', 'Low']);
    expect(data.items[0].pipeline_stage).toBe('engaged');
  });
});

describe('TestScoreHistory', () => {
  it('test_score_history', async () => {
    const id = await createBusiness();
    await createScore(id);
    const res = await api('GET', `/leads/${id}/score`, { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveLength(1);
    expect(data[0].score_version).toBe(1);
    expect(data[0].business_id).toBe(id);
  });

  it('test_no_scores', async () => {
    const id = await createBusiness();
    expect((await api('GET', `/leads/${id}/score`, { token })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd api && npx vitest run test/leads.test.ts
```

Expected: FAIL (404 on `/leads/ranked`).

- [ ] **Step 3: Rewrite `api/src/routes/leads.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { queryParams } from '../lib/validate';
import { NICHES } from '../lib/stages';
import { LATEST_OUTREACH_JOIN, LATEST_SCORE_JOIN } from './businesses';
import type { AppEnv, LeadScoreRow } from '../types';

const router = new Hono<AppEnv>();

const rankedQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  zip_code: z.string().optional(),
  niche: z.enum(NICHES).optional(),
  min_score: z.coerce.number().optional(),
  price_tier: z.coerce.number().int().optional(),
});

// =py routes/leads.get_ranked_leads
router.get('/ranked', requireAuth, queryParams(rankedQuery), async (c) => {
  const q = c.req.valid('query');
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.zip_code) { where.push('b.zip_code = ?'); binds.push(q.zip_code); }
  if (q.niche) { where.push('b.niche = ?'); binds.push(q.niche); }
  if (q.min_score !== undefined) { where.push('ls.composite_acquisition_score >= ?'); binds.push(q.min_score); }
  if (q.price_tier !== undefined) { where.push('ls.price_tier = ?'); binds.push(q.price_tier); }

  const from = `FROM businesses b ${LATEST_SCORE_JOIN} ${LATEST_OUTREACH_JOIN} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...binds).first<{ n: number }>();
  const rows = await c.env.DB
    .prepare(`SELECT b.id AS business_id, b.name AS business_name, b.zip_code, b.niche,
                     ls.composite_acquisition_score, ls.price_tier, lo.status AS pipeline_stage
              ${from}
              ORDER BY ls.composite_acquisition_score DESC NULLS LAST
              LIMIT ? OFFSET ?`)
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all();

  return c.json({ items: rows.results ?? [], total: count?.n ?? 0, page: q.page, page_size: q.page_size });
});

// =py routes/leads.get_score_history
router.get('/:business_id/score', requireAuth, async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT id, business_id, score_version, digital_deficit_score, viability_score,
                     competitive_pressure_score, composite_acquisition_score, price_tier, sentiment_adjustment
              FROM lead_scores WHERE business_id = ? ORDER BY score_version DESC`)
    .bind(c.req.param('business_id'))
    .all<LeadScoreRow>();
  if (!rows.results?.length) return c.json({ detail: 'No scores found for this business' }, 404);
  return c.json(rows.results);
});

export default router;
```

- [ ] **Step 4: V**

```bash
cd api && npm run typecheck && npx vitest run test/leads.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/leads.ts api/test/leads.test.ts
git commit -m "refactor(api): port leads routes to Python contract"
```

---

### Task 5: Pipeline board and stage transitions

`R GET /pipeline/board; R PATCH /pipeline/:outreach_id/stage; X GET /pipeline; X GET /pipeline/:id; X POST /pipeline; X PATCH /pipeline/:id; X DELETE /pipeline/:id; =py routes/pipeline.py; +test test_pipeline.py (6)`

**Files:**
- Rewrite: `api/src/routes/pipeline.ts`
- Create: `api/test/pipeline.test.ts`

**Interfaces:**
- Consumes: `PIPELINE_STAGES`, `VALID_TRANSITIONS` from `lib/stages.ts`; `jsonBody`; `nowIso`.

**Contract (=py):**

| Route | Body | Response |
|---|---|---|
| `GET /pipeline/board` | | `{ columns: [{ stage, count, cards: [{ outreach_id, business_id, business_name, zip_code, niche, call_attempts, last_contact }] }] }` — one column per `PIPELINE_STAGES` entry in order, at most 10 cards per column ordered by `updated_at` desc |
| `PATCH /pipeline/:outreach_id/stage` | admin; `{ new_stage }` | 200 `{ status: 'ok', outreach_id, new_stage }`; 404 `Outreach record not found`; 400 `Invalid stage: <value>` when not in PIPELINE_STAGES; 422 `Cannot transition from <a> to <b>. Allowed: [...]` when not in `VALID_TRANSITIONS[current]` |

- [ ] **Step 1: Write the failing tests**

`api/test/pipeline.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { accessToken, adminUser, api, createBusiness, createOutreach, resetDb, viewerUser } from './helpers';

let token: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); });

describe('TestPipelineBoard', () => {
  it('test_empty_board', async () => {
    const res = await api('GET', '/pipeline/board', { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.columns).toHaveLength(12);
    expect(data.columns[0]).toEqual({ stage: 'scored', count: 0, cards: [] });
  });

  it('test_board_with_data', async () => {
    const biz = await createBusiness();
    const outreachId = await createOutreach(biz);
    const data = await (await api('GET', '/pipeline/board', { token })).json() as any;
    const scored = data.columns.find((c: any) => c.stage === 'scored');
    expect(scored.count).toBe(1);
    expect(scored.cards).toHaveLength(1);
    expect(scored.cards[0]).toMatchObject({ outreach_id: outreachId, business_id: biz, business_name: 'Test Barbershop', zip_code: '60619', niche: 'barbershops', call_attempts: 0, last_contact: null });
  });

  it('caps preview cards at 10 but counts every record', async () => {
    const biz = await createBusiness();
    for (let i = 0; i < 12; i++) await createOutreach(biz);
    const data = await (await api('GET', '/pipeline/board', { token })).json() as any;
    const scored = data.columns.find((c: any) => c.stage === 'scored');
    expect(scored.count).toBe(12);
    expect(scored.cards).toHaveLength(10);
  });
});

describe('TestStageTransition', () => {
  it('test_valid_transition', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('PATCH', `/pipeline/${id}/stage`, { token, json: { new_stage: 'queued' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', outreach_id: id, new_stage: 'queued' });
  });

  it('test_invalid_transition', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('PATCH', `/pipeline/${id}/stage`, { token, json: { new_stage: 'won' } });
    expect(res.status).toBe(422);
    expect((await res.json() as any).detail).toContain('Cannot transition from scored to won');
  });

  it('test_invalid_stage_name', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('PATCH', `/pipeline/${id}/stage`, { token, json: { new_stage: 'nonexistent' } });
    expect(res.status).toBe(400);
  });

  it('test_not_found', async () => {
    const res = await api('PATCH', `/pipeline/${crypto.randomUUID()}/stage`, { token, json: { new_stage: 'queued' } });
    expect(res.status).toBe(404);
  });

  it('rejects viewers', async () => {
    const id = await createOutreach(await createBusiness());
    const viewer = await accessToken(await viewerUser());
    expect((await api('PATCH', `/pipeline/${id}/stage`, { token: viewer, json: { new_stage: 'queued' } })).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd api && npx vitest run test/pipeline.test.ts
```

Expected: FAIL (404 on `/pipeline/board`).

- [ ] **Step 3: Rewrite `api/src/routes/pipeline.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { jsonBody } from '../lib/validate';
import { PIPELINE_STAGES, VALID_TRANSITIONS, type PipelineStage } from '../lib/stages';
import { nowIso } from '../db/serialize';
import type { AppEnv } from '../types';

const router = new Hono<AppEnv>();

interface Card {
  outreach_id: string; business_id: string; business_name: string; zip_code: string;
  niche: string | null; call_attempts: number; last_contact: string | null;
}

// =py routes/pipeline.get_pipeline_board
router.get('/board', requireAuth, async (c) => {
  const db = c.env.DB;
  const counts = await db.prepare('SELECT status, COUNT(*) AS n FROM outreach_records GROUP BY status').all<{ status: string; n: number }>();
  const countByStage = new Map((counts.results ?? []).map((r) => [r.status, r.n]));

  const cardStmt = db.prepare(`
    SELECT o.id AS outreach_id, o.business_id, b.name AS business_name, b.zip_code, b.niche,
           o.call_attempts, o.last_contact_date AS last_contact
    FROM outreach_records o JOIN businesses b ON b.id = o.business_id
    WHERE o.status = ? ORDER BY o.updated_at DESC LIMIT 10`);
  const cardResults = await db.batch<Card>(PIPELINE_STAGES.map((stage) => cardStmt.bind(stage)));

  const columns = PIPELINE_STAGES.map((stage, i) => ({
    stage,
    count: countByStage.get(stage) ?? 0,
    cards: cardResults[i].results ?? [],
  }));
  return c.json({ columns });
});

// =py routes/pipeline.transition_stage
router.patch('/:outreach_id/stage', requireAuth, requireAdmin, jsonBody(z.object({ new_stage: z.string() })), async (c) => {
  const id = c.req.param('outreach_id');
  const { new_stage } = c.req.valid('json');
  const db = c.env.DB;

  const row = await db.prepare('SELECT status FROM outreach_records WHERE id = ?').bind(id).first<{ status: PipelineStage }>();
  if (!row) return c.json({ detail: 'Outreach record not found' }, 404);
  if (!(PIPELINE_STAGES as readonly string[]).includes(new_stage)) return c.json({ detail: `Invalid stage: ${new_stage}` }, 400);

  const allowed = VALID_TRANSITIONS[row.status];
  if (!allowed.includes(new_stage as PipelineStage)) {
    return c.json({ detail: `Cannot transition from ${row.status} to ${new_stage}. Allowed: [${allowed.map((s) => `'${s}'`).join(', ')}]` }, 422);
  }

  await db.prepare('UPDATE outreach_records SET status = ?, updated_at = ? WHERE id = ?').bind(new_stage, nowIso(), id).run();
  return c.json({ status: 'ok', outreach_id: id, new_stage });
});

export default router;
```

- [ ] **Step 4: V**

```bash
cd api && npm run typecheck && npx vitest run test/pipeline.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/pipeline.ts api/test/pipeline.test.ts
git commit -m "refactor(api): port pipeline board and stage transitions to Python contract"
```

---

### Task 6: Outreach and Retell webhooks

`R GET /outreach/by-business/:business_id; R GET /outreach/:id; R GET /outreach/:id/transcript; R PATCH /outreach/:id; R POST /webhooks/retell/call-complete; R POST /webhooks/retell/call-event; X GET /outreach; X POST /outreach; X POST /outreach/webhook/retell; =py routes/outreach.py voice/webhook_handler.py voice/retell_client.verify_retell_signature; ~RETELL_API_KEY secret; ~SENTIMENT_QUEUE; +test test_outreach.py (7) test_webhook_handler.py (7)`

**Files:**
- Rewrite: `api/src/routes/outreach.ts`
- Create: `api/src/routes/webhooks.ts`, `api/test/outreach.test.ts`, `api/test/webhooks.test.ts`
- Modify: `api/src/index.ts` (mount `webhooks` at `/api/webhooks/retell`; the health check already answers `{ status: 'ok' }`)

**Interfaces:**
- Consumes: `withBooleans`, `OUTREACH_BOOLS`, `nowIso`, `jsonBody`, `Bindings.RETELL_API_KEY`, `Bindings.SENTIMENT_QUEUE`.

**Contract (=py):**

| Route | Body | Response |
|---|---|---|
| `GET /outreach/by-business/:business_id` | | `{ items: OutreachDetail[], total }` ordered by `created_at` desc; empty list when the business has none or does not exist |
| `GET /outreach/:id` | | `OutreachDetail` (every column of `outreach_records`, `meeting_scheduled` as boolean); 404 `Outreach record not found` |
| `GET /outreach/:id/transcript` | | `{ transcript, retell_call_id }`; 404 |
| `PATCH /outreach/:id` | admin; `{ notes?, assigned_to? }` | `OutreachDetail`; 404 |
| `POST /webhooks/retell/call-complete` | Retell event; public | see Step 3; signature check when `RETELL_API_KEY` is set and the `x-retell-signature` header is present |
| `POST /webhooks/retell/call-event` | any | `{ status: 'ok' }` |

- [ ] **Step 1: Write the failing tests**

`api/test/outreach.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { accessToken, adminUser, api, createBusiness, createOutreach, resetDb } from './helpers';

let token: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); });

describe('TestOutreachByBusiness', () => {
  it('test_empty_history', async () => {
    const biz = await createBusiness();
    const res = await api('GET', `/outreach/by-business/${biz}`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0 });
  });

  it('test_with_outreach', async () => {
    const biz = await createBusiness();
    await createOutreach(biz);
    const data = await (await api('GET', `/outreach/by-business/${biz}`, { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.items[0].status).toBe('scored');
    expect(data.items[0].meeting_scheduled).toBe(false);
  });
});

describe('TestGetOutreach', () => {
  it('test_get_detail', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('GET', `/outreach/${id}`, { token });
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe('scored');
  });

  it('test_not_found', async () => {
    expect((await api('GET', `/outreach/${crypto.randomUUID()}`, { token })).status).toBe(404);
  });
});

describe('TestGetTranscript', () => {
  it('test_transcript', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('GET', `/outreach/${id}/transcript`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transcript: null, retell_call_id: null });
  });

  it('test_not_found', async () => {
    expect((await api('GET', `/outreach/${crypto.randomUUID()}/transcript`, { token })).status).toBe(404);
  });
});

describe('TestUpdateOutreach', () => {
  it('test_update_notes', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('PATCH', `/outreach/${id}`, { token, json: { notes: 'Follow up next week', assigned_to: 'john@example.com' } });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.notes).toBe('Follow up next week');
    expect(data.assigned_to).toBe('john@example.com');
  });
});
```

`api/test/webhooks.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, createBusiness, createOutreach, resetDb } from './helpers';

const encoder = new TextEncoder();
async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.RETELL_API_KEY!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const callEnded = {
  event: 'call_ended',
  call: { call_id: 'call_abc123', transcript: "Agent: Hello, I'm calling about marketing services. Owner: Sounds interesting.", disconnection_reason: 'agent_hangup', call_status: 'ended' },
};
const callAnalyzed = { event: 'call_analyzed', call: { call_id: 'call_abc123', call_analysis: { call_successful: true, customer_sentiment: 'Positive' } } };
const voicemail = { event: 'call_ended', call: { call_id: 'call_vm456', transcript: '', disconnection_reason: 'voicemail_reached', call_status: 'ended' } };

async function outreachRow(id: string) {
  return env.DB.prepare('SELECT status, call_disposition, call_transcript, call_sentiment_score FROM outreach_records WHERE id = ?').bind(id).first<any>();
}

let queued: unknown[];
beforeEach(async () => {
  await resetDb();
  queued = [];
  vi.spyOn(env.SENTIMENT_QUEUE, 'send').mockImplementation(async (msg: unknown) => { queued.push(msg); });
});

describe('TestCallCompleteWebhook', () => {
  it('test_missing_call_id', async () => {
    const res = await api('POST', '/webhooks/retell/call-complete', { json: { event: 'call_ended', call: {} } });
    expect(res.status).toBe(400);
  });

  it('test_unknown_call_id', async () => {
    const res = await api('POST', '/webhooks/retell/call-complete', { json: callEnded });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ignored', reason: 'unknown call_id' });
  });

  it('test_call_ended_processing', async () => {
    const id = await createOutreach(await createBusiness(), { status: 'contacted', retell_call_id: 'call_abc123' });
    const res = await api('POST', '/webhooks/retell/call-complete', { json: callEnded });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', call_id: 'call_abc123' });
    const row = await outreachRow(id);
    expect(row.call_disposition).toBe('answered');
    expect(row.status).toBe('contacted');
    expect(row.call_transcript).toContain('Sounds interesting');
    expect(row.call_sentiment_score).toBeNull();
    expect(queued).toEqual([{ outreach_id: id }]);
  });

  it('test_call_analyzed_processing', async () => {
    const id = await createOutreach(await createBusiness(), { status: 'contacted', retell_call_id: 'call_abc123' });
    await env.DB.prepare("UPDATE outreach_records SET call_transcript = 'Some transcript from earlier call_ended', call_disposition = 'answered' WHERE id = ?").bind(id).run();
    const res = await api('POST', '/webhooks/retell/call-complete', { json: callAnalyzed });
    expect(res.status).toBe(200);
    const row = await outreachRow(id);
    expect(row.call_sentiment_score).toBe(0.7);
    expect(row.status).toBe('engaged');
    expect(queued).toEqual([{ outreach_id: id }]);
  });

  it('test_voicemail_processing', async () => {
    const id = await createOutreach(await createBusiness(), { status: 'contacted', retell_call_id: 'call_vm456' });
    const res = await api('POST', '/webhooks/retell/call-complete', { json: voicemail });
    expect(res.status).toBe(200);
    const row = await outreachRow(id);
    expect(row.call_disposition).toBe('voicemail');
    expect(row.status).toBe('voicemail');
    expect(queued).toEqual([]);
  });

  it('rejects a bad signature and accepts a good one', async () => {
    await createOutreach(await createBusiness(), { retell_call_id: 'call_abc123' });
    const body = JSON.stringify(callEnded);
    const bad = await api('POST', '/webhooks/retell/call-complete', { headers: { 'Content-Type': 'application/json', 'x-retell-signature': 'deadbeef' }, json: callEnded });
    expect(bad.status).toBe(401);
    const good = await api('POST', '/webhooks/retell/call-complete', { headers: { 'Content-Type': 'application/json', 'x-retell-signature': await sign(body) }, json: callEnded });
    expect(good.status).toBe(200);
  });
});

describe('TestCallEventWebhook', () => {
  it('test_call_event_returns_ok', async () => {
    const res = await api('POST', '/webhooks/retell/call-event', { json: { event: 'call_started', call: { call_id: 'c123' } } });
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe('ok');
  });
});

describe('TestHealthCheck', () => {
  it('test_health_endpoint', async () => {
    const res = await api('GET', '/health');
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe('ok');
  });
});
```

The signature test signs `JSON.stringify(callEnded)`, and `api()` serializes the same object with `JSON.stringify`, so the bytes match. If `vi.spyOn` cannot patch the queue binding, replace the spy with a `mockQueue` assigned via `Object.defineProperty(env, 'SENTIMENT_QUEUE', { value: { send: async (m) => queued.push(m) } })` in `beforeEach`.

- [ ] **Step 2: Run to verify failure**

```bash
cd api && npx vitest run test/outreach.test.ts test/webhooks.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Rewrite `api/src/routes/outreach.ts` and write `api/src/routes/webhooks.ts`**

`outreach.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { jsonBody } from '../lib/validate';
import { nowIso, withBooleans, OUTREACH_BOOLS } from '../db/serialize';
import type { AppEnv, OutreachRecordRow } from '../types';

const router = new Hono<AppEnv>();
const serialize = (row: OutreachRecordRow) => withBooleans(row, OUTREACH_BOOLS);

// =py routes/outreach.get_outreach_history
router.get('/by-business/:business_id', requireAuth, async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM outreach_records WHERE business_id = ? ORDER BY created_at DESC')
    .bind(c.req.param('business_id')).all<OutreachRecordRow>();
  const items = (rows.results ?? []).map(serialize);
  return c.json({ items, total: items.length });
});

// =py routes/outreach.get_outreach
router.get('/:id', requireAuth, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM outreach_records WHERE id = ?').bind(c.req.param('id')).first<OutreachRecordRow>();
  if (!row) return c.json({ detail: 'Outreach record not found' }, 404);
  return c.json(serialize(row));
});

// =py routes/outreach.get_transcript
router.get('/:id/transcript', requireAuth, async (c) => {
  const row = await c.env.DB.prepare('SELECT call_transcript, retell_call_id FROM outreach_records WHERE id = ?')
    .bind(c.req.param('id')).first<{ call_transcript: string | null; retell_call_id: string | null }>();
  if (!row) return c.json({ detail: 'Outreach record not found' }, 404);
  return c.json({ transcript: row.call_transcript, retell_call_id: row.retell_call_id });
});

// =py routes/outreach.update_outreach
router.patch('/:id', requireAuth, requireAdmin, jsonBody(z.object({ notes: z.string().nullable().optional(), assigned_to: z.string().nullable().optional() })), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM outreach_records WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ detail: 'Outreach record not found' }, 404);

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of ['notes', 'assigned_to'] as const) {
    if (body[key] !== undefined) { sets.push(`${key} = ?`); binds.push(body[key]); }
  }
  if (sets.length) {
    sets.push('updated_at = ?'); binds.push(nowIso());
    await db.prepare(`UPDATE outreach_records SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  }
  const row = await db.prepare('SELECT * FROM outreach_records WHERE id = ?').bind(id).first<OutreachRecordRow>();
  return c.json(serialize(row!));
});

export default router;
```

`webhooks.ts`:

```ts
import { Hono } from 'hono';
import { nowIso } from '../db/serialize';
import type { AppEnv, OutreachRecordRow } from '../types';

const router = new Hono<AppEnv>();
const encoder = new TextEncoder();

// =py voice/retell_client.verify_retell_signature — HMAC-SHA256 hex over the raw body, keyed by the API key
async function verifySignature(rawBody: string, signature: string, apiKey: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(apiKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

type Patch = Partial<Pick<OutreachRecordRow, 'call_transcript' | 'call_disposition' | 'status' | 'call_sentiment_score'>>;

// =py voice/webhook_handler._handle_call_ended
function handleCallEnded(call: Record<string, unknown>): Patch {
  const patch: Patch = {};
  const transcript = typeof call.transcript === 'string' ? call.transcript : '';
  if (transcript) patch.call_transcript = transcript;
  const reason = typeof call.disconnection_reason === 'string' ? call.disconnection_reason : '';
  if (reason === 'voicemail_reached') {
    patch.call_disposition = 'voicemail';
    patch.status = 'voicemail';
  } else if (['dial_failed', 'no_answer', 'busy'].includes(reason)) {
    patch.call_disposition = 'no_answer';
  } else if (transcript) {
    patch.call_disposition = 'answered';
    patch.status = 'contacted';
  }
  return patch;
}

// =py voice/webhook_handler._handle_call_analyzed
function handleCallAnalyzed(call: Record<string, unknown>): Patch {
  const analysis = (call.call_analysis ?? null) as Record<string, unknown> | null;
  if (!analysis) return {};
  const patch: Patch = {};
  if (analysis.call_successful === true) patch.status = 'engaged';
  const sentiment = analysis.customer_sentiment;
  if (typeof sentiment === 'string') {
    const map: Record<string, number> = { Negative: -0.7, Neutral: 0.0, Positive: 0.7 };
    patch.call_sentiment_score = map[sentiment] ?? 0.0;
  }
  return patch;
}

// =py voice/webhook_handler.handle_call_complete
router.post('/call-complete', async (c) => {
  const rawBody = await c.req.text();
  const apiKey = c.env.RETELL_API_KEY;
  const signature = c.req.header('x-retell-signature') ?? '';
  if (apiKey && signature && !(await verifySignature(rawBody, signature, apiKey))) {
    return c.json({ detail: 'Invalid webhook signature' }, 401);
  }

  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody); } catch { return c.json({ detail: 'Invalid JSON' }, 400); }
  const event = typeof body.event === 'string' ? body.event : '';
  const call = (typeof body.call === 'object' && body.call !== null ? body.call : body) as Record<string, unknown>;
  const callId = typeof call.call_id === 'string' ? call.call_id : '';
  if (!callId) return c.json({ detail: 'Missing call_id' }, 400);

  const db = c.env.DB;
  const outreach = await db.prepare('SELECT id, call_transcript FROM outreach_records WHERE retell_call_id = ?').bind(callId)
    .first<Pick<OutreachRecordRow, 'id' | 'call_transcript'>>();
  if (!outreach) {
    console.warn('webhook_unknown_call', { call_id: callId, event });
    return c.json({ status: 'ignored', reason: 'unknown call_id' });
  }

  let patch: Patch;
  if (event === 'call_ended') patch = handleCallEnded(call);
  else if (event === 'call_analyzed') patch = handleCallAnalyzed(call);
  else patch = { ...handleCallEnded(call), ...('call_analysis' in call ? handleCallAnalyzed(call) : {}) };

  const sets = Object.keys(patch).map((k) => `${k} = ?`);
  if (sets.length) {
    await db.prepare(`UPDATE outreach_records SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...Object.values(patch), nowIso(), outreach.id).run();
  }
  console.log('webhook_processed', { call_id: callId, event, disposition: patch.call_disposition ?? null });

  // ~ replaces Celery process_sentiment_task.delay(outreach_id)
  if (patch.call_transcript ?? outreach.call_transcript) {
    await c.env.SENTIMENT_QUEUE.send({ outreach_id: outreach.id });
  }
  return c.json({ status: 'ok', call_id: callId });
});

// =py voice/webhook_handler.handle_call_event
router.post('/call-event', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const call = (typeof body.call === 'object' && body.call !== null ? body.call : body) as Record<string, unknown>;
  console.log('retell_event', { event_type: body.event ?? null, call_id: call.call_id ?? null });
  return c.json({ status: 'ok' });
});

export default router;
```

In `api/src/index.ts` add `import webhookRoutes from './routes/webhooks';` and `app.route('/api/webhooks/retell', webhookRoutes);`.

- [ ] **Step 4: V**

```bash
cd api && npm run typecheck && npx vitest run test/outreach.test.ts test/webhooks.test.ts
```

Expected: outreach 7 passed; webhooks 8 passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/outreach.ts api/src/routes/webhooks.ts api/src/index.ts api/test/outreach.test.ts api/test/webhooks.test.ts
git commit -m "refactor(api): port outreach routes and Retell webhooks to Python contract"
```

---

### Task 7: Grants

`R GET /grants/board; R GET /grants/financials/:grant_id; R GET /grants/:grant_id; R GET /grants; R POST /grants; R PATCH /grants/:grant_id; R PATCH /grants/:grant_id/stage; R GET /grants/:grant_id/documents; R PATCH /grants/:grant_id/documents/:doc_id; X GET /grants/board/summary; X POST /grants/financial-calculator; X POST /grants/:id/documents; =py routes/grants.py schemas/grant.py grants/financial_calculator.py; +test test_grants.py (12) test_financial_calculator.py (8)`

**Files:**
- Rewrite: `api/src/routes/grants.ts`, `api/src/lib/grants.ts`
- Create: `api/test/grants.test.ts`, `api/test/financial-calculator.test.ts`

**Interfaces:**
- Consumes: `NOF_STAGES`, `VALID_NOF_TRANSITIONS`, `BOARD_GROUPS`, `jsonBody`, `queryParams`, `withBooleans`, `GRANT_BOOLS`, `DOCUMENT_BOOLS`, `nowIso`, `generateId`.
- Produces `lib/grants.ts`: `computeGrantFinancials(totalProjectCost: number, acquisitionCost = 0): GrantFinancials` with fields `total_project_cost, acquisition_cost, base_grant, taf_eligible, owner_contribution, owner_min_financing, exterior_work_minimum`.

**Contract (=py):**

| Route | Query / body | Response |
|---|---|---|
| `GET /grants/board` | | `{ columns: [{ stage, count, cards: [{ grant_id, business_id, business_name, corridor_name, estimated_grant, days_in_stage }] }] }`; one column per `BOARD_GROUPS` entry in order; up to 10 cards by `updated_at` desc; `estimated_grant` = `base_grant_amount`; `days_in_stage` = whole days since `updated_at` |
| `GET /grants/financials/:grant_id` | | `GrantFinancials` from `computeGrantFinancials(total_project_cost ?? 0, acquisition_cost ?? 0)`; 404 `Grant application not found` |
| `GET /grants/:grant_id` | | `GrantApplicationResponse`: every `grant_applications` column, booleans serialized; 404 |
| `GET /grants` | `status` (NOF_STAGES, else 400 `Invalid status: <v>`), `corridor_name`, `business_id`, `page`, `page_size` | plain array of `GrantApplicationResponse`, ordered `created_at` desc |
| `POST /grants` | admin; `{ business_id, total_project_cost?, acquisition_cost?, project_description? }` | 201 `GrantApplicationResponse` with `status: 'eligibility_assessed'`; 404 `Business not found` |
| `PATCH /grants/:grant_id` | admin; any subset of `total_project_cost, base_grant_amount, acquisition_cost, taf_amount, owner_contribution, financing_amount, financing_verified, gc_bid_amount, project_description, exterior_work_pct, has_site_control, site_control_type, assigned_to, ta_provider, notes` | `GrantApplicationResponse`; 404 |
| `PATCH /grants/:grant_id/stage` | admin; `{ new_stage }` | `{ status: 'ok', grant_id, new_stage }`; 404; 400 `Invalid stage: <v>`; 422 `Cannot transition from <a> to <b>. Allowed: [...]` |
| `GET /grants/:grant_id/documents` | | array of `GrantDocumentResponse` (every `grant_documents` column, `is_mandatory` boolean); 404 when the grant is missing |
| `PATCH /grants/:grant_id/documents/:doc_id` | admin; `{ status?, notes?, received_date?, reviewed_date? }` | `GrantDocumentResponse`; 404 `Grant document not found` when the doc is missing or belongs to another grant |

Route registration order matters in Hono: register `/board` and `/financials/:grant_id` before `/:grant_id`.

- [ ] **Step 1: Write the failing tests**

`api/test/financial-calculator.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeGrantFinancials } from '../src/lib/grants';

describe('computeGrantFinancials', () => {
  it('test_standard_200k_project', () => {
    const f = computeGrantFinancials(200_000);
    expect(f.base_grant).toBe(150_000);
    expect(f.taf_eligible).toBe(30_000);
    expect(f.owner_contribution).toBe(50_000);
    expect(f.owner_min_financing).toBe(100_000);
    expect(f.exterior_work_minimum).toBe(15_000);
  });
  it('test_large_project_capped_at_250k', () => {
    const f = computeGrantFinancials(500_000);
    expect(f.base_grant).toBe(250_000);
    expect(f.taf_eligible).toBe(50_000);
  });
  it('test_small_project_no_exterior', () => {
    const f = computeGrantFinancials(30_000);
    expect(f.base_grant).toBe(22_500);
    expect(f.exterior_work_minimum).toBe(0);
  });
  it('test_small_project_above_25k_exterior', () => {
    const f = computeGrantFinancials(40_000);
    expect(f.base_grant).toBe(30_000);
    expect(f.exterior_work_minimum).toBe(3_000);
  });
  it('test_zero_project_cost', () => {
    expect(computeGrantFinancials(0)).toEqual({ total_project_cost: 0, acquisition_cost: 0, base_grant: 0, taf_eligible: 0, owner_contribution: 0, owner_min_financing: 0, exterior_work_minimum: 0 });
  });
  it('test_negative_project_cost', () => {
    expect(computeGrantFinancials(-50_000).base_grant).toBe(0);
  });
  it('test_with_acquisition_cost', () => {
    const f = computeGrantFinancials(200_000, 50_000);
    expect(f.acquisition_cost).toBe(50_000);
    expect(f.base_grant).toBe(150_000);
  });
  it('test_rounding', () => {
    const f = computeGrantFinancials(33_333.33);
    expect(f.base_grant).toBe(Math.round(33_333.33 * 0.75 * 100) / 100);
    for (const v of [f.base_grant, f.taf_eligible, f.owner_contribution, f.owner_min_financing, f.exterior_work_minimum]) {
      expect(v).toBe(Math.round(v * 100) / 100);
    }
  });
});
```

`api/test/grants.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { accessToken, adminUser, api, createBusiness, resetDb } from './helpers';

let token: string;
let biz: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); biz = await createBusiness(); });

async function createGrant(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await api('POST', '/grants', { token, json: { business_id: biz, ...extra } });
  expect(res.status).toBe(201);
  return (await res.json() as any).id;
}

describe('grants', () => {
  it('test_create_grant', async () => {
    const res = await api('POST', '/grants/', { token, json: { business_id: biz } });
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.business_id).toBe(biz);
    expect(data.status).toBe('eligibility_assessed');
    expect(data.financing_verified).toBe(false);
  });

  it('test_create_grant_invalid_business', async () => {
    expect((await api('POST', '/grants', { token, json: { business_id: crypto.randomUUID() } })).status).toBe(404);
  });

  it('test_list_grants', async () => {
    await createGrant(); await createGrant();
    const res = await api('GET', '/grants/', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(2);
  });

  it('test_list_grants_filter_status', async () => {
    const first = await createGrant();
    await api('PATCH', `/grants/${first}/stage`, { token, json: { new_stage: 'intake' } });
    await createGrant();
    const data = await (await api('GET', '/grants?status=intake', { token })).json() as any;
    expect(data).toHaveLength(1);
    expect(data[0].status).toBe('intake');
    expect((await api('GET', '/grants?status=bogus', { token })).status).toBe(400);
  });

  it('test_get_grant_detail', async () => {
    const id = await createGrant();
    const res = await api('GET', `/grants/${id}`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, business_id: biz });
  });

  it('test_update_grant', async () => {
    const id = await createGrant();
    const res = await api('PATCH', `/grants/${id}`, { token, json: { total_project_cost: 200000.0, project_description: 'Storefront renovation' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total_project_cost: 200000, project_description: 'Storefront renovation' });
  });

  it('test_stage_transition_valid', async () => {
    const id = await createGrant();
    const res = await api('PATCH', `/grants/${id}/stage`, { token, json: { new_stage: 'intake' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', grant_id: id, new_stage: 'intake' });
  });

  it('test_stage_transition_invalid', async () => {
    const id = await createGrant();
    expect((await api('PATCH', `/grants/${id}/stage`, { token, json: { new_stage: 'alumnus' } })).status).toBe(422);
    expect((await api('PATCH', `/grants/${id}/stage`, { token, json: { new_stage: 'bogus' } })).status).toBe(400);
  });

  it('test_get_grant_board', async () => {
    await createGrant();
    const res = await api('GET', '/grants/board', { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.columns).toHaveLength(13);
    expect(data.columns[0].stage).toBe('eligibility_assessed');
    expect(data.columns[0].count).toBe(1);
    expect(data.columns[0].cards).toHaveLength(1);
    expect(data.columns[0].cards[0]).toMatchObject({ business_id: biz, business_name: 'Test Barbershop', estimated_grant: null, days_in_stage: 0 });
  });

  it('test_get_grant_financials', async () => {
    const id = await createGrant({ total_project_cost: 200000.0 });
    const res = await api('GET', `/grants/financials/${id}`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ base_grant: 150000, taf_eligible: 30000, owner_contribution: 50000 });
  });

  it('test_get_grant_documents', async () => {
    const id = await createGrant();
    const res = await api('GET', `/grants/${id}/documents`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect((await api('GET', `/grants/${crypto.randomUUID()}/documents`, { token })).status).toBe(404);
  });

  it('updates a document and scopes it to its grant', async () => {
    const id = await createGrant();
    const other = await createGrant();
    const docId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO grant_documents (id, grant_application_id, document_type, is_mandatory) VALUES (?, ?, 'gc_bid', 1)").bind(docId, id).run();
    const res = await api('PATCH', `/grants/${id}/documents/${docId}`, { token, json: { status: 'received', received_date: '2026-09-02' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: docId, status: 'received', received_date: '2026-09-02', is_mandatory: true });
    expect((await api('PATCH', `/grants/${other}/documents/${docId}`, { token, json: { status: 'approved' } })).status).toBe(404);
  });

  it('test_grant_auth_required', async () => {
    expect((await api('GET', '/grants/')).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd api && npx vitest run test/grants.test.ts test/financial-calculator.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Rewrite `api/src/lib/grants.ts`**

```ts
// =py grants/financial_calculator.compute_grant_financials
export interface GrantFinancials {
  total_project_cost: number;
  acquisition_cost: number;
  base_grant: number;
  taf_eligible: number;
  owner_contribution: number;
  owner_min_financing: number;
  exterior_work_minimum: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeGrantFinancials(totalProjectCost: number, acquisitionCost = 0): GrantFinancials {
  if (totalProjectCost <= 0) {
    return { total_project_cost: 0, acquisition_cost: 0, base_grant: 0, taf_eligible: 0, owner_contribution: 0, owner_min_financing: 0, exterior_work_minimum: 0 };
  }
  const base_grant = round2(Math.min(totalProjectCost * 0.75, 250_000));
  const taf_eligible = round2(Math.min(base_grant * 0.2, 50_000));
  return {
    total_project_cost: round2(totalProjectCost),
    acquisition_cost: round2(acquisitionCost),
    base_grant,
    taf_eligible,
    owner_contribution: round2(totalProjectCost - base_grant),
    owner_min_financing: round2(totalProjectCost * 0.5),
    exterior_work_minimum: base_grant > 25_000 ? round2(base_grant * 0.1) : 0,
  };
}
```

- [ ] **Step 4: Rewrite `api/src/routes/grants.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId } from '../lib/jwt';
import { jsonBody, queryParams } from '../lib/validate';
import { computeGrantFinancials } from '../lib/grants';
import { BOARD_GROUPS, NOF_STAGES, VALID_NOF_TRANSITIONS, type NofStage } from '../lib/stages';
import { nowIso, withBooleans, DOCUMENT_BOOLS, GRANT_BOOLS } from '../db/serialize';
import type { AppEnv, GrantApplicationRow, GrantDocumentRow } from '../types';

const router = new Hono<AppEnv>();
const serializeGrant = (row: GrantApplicationRow) => withBooleans(row, GRANT_BOOLS);
const serializeDoc = (row: GrantDocumentRow) => withBooleans(row, DOCUMENT_BOOLS);

async function loadGrant(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM grant_applications WHERE id = ?').bind(id).first<GrantApplicationRow>();
}

const listQuery = z.object({
  status: z.string().optional(),
  corridor_name: z.string().optional(),
  business_id: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createBody = z.object({
  business_id: z.string(),
  total_project_cost: z.number().nullable().optional(),
  acquisition_cost: z.number().nullable().optional(),
  project_description: z.string().nullable().optional(),
});

const UPDATE_FIELDS = [
  'total_project_cost', 'base_grant_amount', 'acquisition_cost', 'taf_amount', 'owner_contribution',
  'financing_amount', 'financing_verified', 'gc_bid_amount', 'project_description', 'exterior_work_pct',
  'has_site_control', 'site_control_type', 'assigned_to', 'ta_provider', 'notes',
] as const;
const num = z.number().nullable().optional();
const str = z.string().nullable().optional();
const bool = z.boolean().nullable().optional();
const updateBody = z.object({
  total_project_cost: num, base_grant_amount: num, acquisition_cost: num, taf_amount: num, owner_contribution: num,
  financing_amount: num, financing_verified: bool, gc_bid_amount: num, project_description: str, exterior_work_pct: num,
  has_site_control: bool, site_control_type: str, assigned_to: str, ta_provider: str, notes: str,
});

const docUpdateBody = z.object({ status: str, notes: str, received_date: str, reviewed_date: str });

// =py routes/grants.get_grant_board
router.get('/board', requireAuth, async (c) => {
  const db = c.env.DB;
  const counts = await db.prepare('SELECT status, COUNT(*) AS n FROM grant_applications GROUP BY status').all<{ status: string; n: number }>();
  const countByStage = new Map((counts.results ?? []).map((r) => [r.status, r.n]));

  const cardStmt = db.prepare(`
    SELECT g.id AS grant_id, g.business_id, b.name AS business_name, g.corridor_name,
           g.base_grant_amount AS estimated_grant, g.updated_at
    FROM grant_applications g JOIN businesses b ON b.id = g.business_id
    WHERE g.status = ? ORDER BY g.updated_at DESC LIMIT 10`);
  const results = await db.batch<{ grant_id: string; business_id: string; business_name: string; corridor_name: string | null; estimated_grant: number | null; updated_at: string }>(
    BOARD_GROUPS.map((stage) => cardStmt.bind(stage))
  );
  const now = Date.now();
  const columns = BOARD_GROUPS.map((stage, i) => ({
    stage,
    count: countByStage.get(stage) ?? 0,
    cards: (results[i].results ?? []).map(({ updated_at, ...card }) => ({
      ...card,
      days_in_stage: Math.max(0, Math.floor((now - Date.parse(updated_at)) / 86_400_000)),
    })),
  }));
  return c.json({ columns });
});

// =py routes/grants.get_grant_financials
router.get('/financials/:grant_id', requireAuth, async (c) => {
  const grant = await loadGrant(c.env.DB, c.req.param('grant_id'));
  if (!grant) return c.json({ detail: 'Grant application not found' }, 404);
  return c.json(computeGrantFinancials(grant.total_project_cost ?? 0, grant.acquisition_cost ?? 0));
});

// =py routes/grants.get_grant
router.get('/:grant_id', requireAuth, async (c) => {
  const grant = await loadGrant(c.env.DB, c.req.param('grant_id'));
  if (!grant) return c.json({ detail: 'Grant application not found' }, 404);
  return c.json(serializeGrant(grant));
});

// =py routes/grants.list_grants
router.get('/', requireAuth, queryParams(listQuery), async (c) => {
  const q = c.req.valid('query');
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status !== undefined) {
    if (!(NOF_STAGES as readonly string[]).includes(q.status)) return c.json({ detail: `Invalid status: ${q.status}` }, 400);
    where.push('status = ?'); binds.push(q.status);
  }
  if (q.corridor_name) { where.push('corridor_name = ?'); binds.push(q.corridor_name); }
  if (q.business_id) { where.push('business_id = ?'); binds.push(q.business_id); }
  const rows = await c.env.DB
    .prepare(`SELECT * FROM grant_applications ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all<GrantApplicationRow>();
  return c.json((rows.results ?? []).map(serializeGrant));
});

// =py routes/grants.create_grant
router.post('/', requireAuth, requireAdmin, jsonBody(createBody), async (c) => {
  const body = c.req.valid('json');
  const db = c.env.DB;
  const biz = await db.prepare('SELECT id FROM businesses WHERE id = ?').bind(body.business_id).first();
  if (!biz) return c.json({ detail: 'Business not found' }, 404);

  const id = generateId();
  await db.prepare(
    `INSERT INTO grant_applications (id, business_id, status, total_project_cost, acquisition_cost, project_description)
     VALUES (?, ?, 'eligibility_assessed', ?, ?, ?)`
  ).bind(id, body.business_id, body.total_project_cost ?? null, body.acquisition_cost ?? null, body.project_description ?? null).run();
  console.log('grant_application_created', { grant_id: id });
  return c.json(serializeGrant((await loadGrant(db, id))!), 201);
});

// =py routes/grants.update_grant
router.patch('/:grant_id', requireAuth, requireAdmin, jsonBody(updateBody), async (c) => {
  const id = c.req.param('grant_id');
  const db = c.env.DB;
  if (!(await loadGrant(db, id))) return c.json({ detail: 'Grant application not found' }, 404);

  const body = c.req.valid('json');
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of UPDATE_FIELDS) {
    const value = body[key];
    if (value !== undefined) { sets.push(`${key} = ?`); binds.push(typeof value === 'boolean' ? (value ? 1 : 0) : value); }
  }
  if (sets.length) {
    sets.push('updated_at = ?'); binds.push(nowIso());
    await db.prepare(`UPDATE grant_applications SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  }
  return c.json(serializeGrant((await loadGrant(db, id))!));
});

// =py routes/grants.transition_grant_stage
router.patch('/:grant_id/stage', requireAuth, requireAdmin, jsonBody(z.object({ new_stage: z.string() })), async (c) => {
  const id = c.req.param('grant_id');
  const { new_stage } = c.req.valid('json');
  const db = c.env.DB;
  const grant = await loadGrant(db, id);
  if (!grant) return c.json({ detail: 'Grant application not found' }, 404);
  if (!(NOF_STAGES as readonly string[]).includes(new_stage)) return c.json({ detail: `Invalid stage: ${new_stage}` }, 400);

  const allowed = VALID_NOF_TRANSITIONS[grant.status];
  if (!allowed.includes(new_stage as NofStage)) {
    return c.json({ detail: `Cannot transition from ${grant.status} to ${new_stage}. Allowed: [${allowed.map((s) => `'${s}'`).join(', ')}]` }, 422);
  }
  await db.prepare('UPDATE grant_applications SET status = ?, updated_at = ? WHERE id = ?').bind(new_stage, nowIso(), id).run();
  return c.json({ status: 'ok', grant_id: id, new_stage });
});

// =py routes/grants.list_grant_documents
router.get('/:grant_id/documents', requireAuth, async (c) => {
  const id = c.req.param('grant_id');
  const db = c.env.DB;
  if (!(await loadGrant(db, id))) return c.json({ detail: 'Grant application not found' }, 404);
  const rows = await db.prepare('SELECT * FROM grant_documents WHERE grant_application_id = ?').bind(id).all<GrantDocumentRow>();
  return c.json((rows.results ?? []).map(serializeDoc));
});

// =py routes/grants.update_grant_document
router.patch('/:grant_id/documents/:doc_id', requireAuth, requireAdmin, jsonBody(docUpdateBody), async (c) => {
  const grantId = c.req.param('grant_id');
  const docId = c.req.param('doc_id');
  const db = c.env.DB;
  const doc = await db.prepare('SELECT * FROM grant_documents WHERE id = ? AND grant_application_id = ?').bind(docId, grantId).first<GrantDocumentRow>();
  if (!doc) return c.json({ detail: 'Grant document not found' }, 404);

  const body = c.req.valid('json');
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of ['status', 'notes', 'received_date', 'reviewed_date'] as const) {
    if (body[key] !== undefined) { sets.push(`${key} = ?`); binds.push(body[key]); }
  }
  if (sets.length) {
    sets.push('updated_at = ?'); binds.push(nowIso());
    await db.prepare(`UPDATE grant_documents SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, docId).run();
  }
  const updated = await db.prepare('SELECT * FROM grant_documents WHERE id = ?').bind(docId).first<GrantDocumentRow>();
  return c.json(serializeDoc(updated!));
});

export default router;
```

- [ ] **Step 5: V**

```bash
cd api && npm run typecheck && npx vitest run test/grants.test.ts test/financial-calculator.test.ts
```

Expected: grants 13 passed; calculator 8 passed.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/grants.ts api/src/lib/grants.ts api/test/grants.test.ts api/test/financial-calculator.test.ts
git commit -m "refactor(api): port grants routes and NOF financial calculator to Python contract"
```

---

### Task 8: Reports on the reconciled schema

`R GET /reports/funnel; R GET /reports/score-distribution; R GET /reports/zip-performance; X GET /reports/corridor; =py routes/reports.py schemas/reports.py; +test test_reports.py (6)`

**Files:**
- Rewrite: `api/src/routes/reports.ts`
- Create: `api/test/reports.test.ts`

**Interfaces:**
- Consumes: `PIPELINE_STAGES`, `LATEST_SCORE_JOIN`, `LATEST_OUTREACH_JOIN`.

**Contract (=py):**

| Route | Response |
|---|---|
| `GET /reports/funnel` | `{ stages: [{ stage, count }] (all 12 in PIPELINE_STAGES order, zero-filled, counted from outreach_records.status), total }` |
| `GET /reports/score-distribution` | `{ buckets: [{ range_min, range_max, count }] (10 buckets of width 10; last bucket includes 100), total, mean, median }` over the latest score per business (highest `score_version`), skipping null composites; `mean`/`median` rounded to 2 places or null when empty |
| `GET /reports/zip-performance` | `{ items: [{ zip_code, total_leads, avg_composite_score, contacted_count, engaged_count, won_count, conversion_rate }] }` grouped by zip over all businesses, ordered by `total_leads` desc; contacted = latest outreach status in `contacted, voicemail, engaged, meeting_scheduled, proposal_sent, negotiating, won`; engaged = in `engaged, meeting_scheduled, proposal_sent, negotiating, won`; won = `won`; `avg_composite_score` rounded to 2 or null; `conversion_rate` = `round(won / total * 100, 1)` |

- [ ] **Step 1: Write the failing tests**

`api/test/reports.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { accessToken, adminUser, api, createBusiness, createOutreach, createScore, resetDb } from './helpers';

let token: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); });

describe('TestFunnel', () => {
  it('test_empty_funnel', async () => {
    const res = await api('GET', '/reports/funnel', { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.total).toBe(0);
    expect(data.stages).toHaveLength(12);
    expect(data.stages[0]).toEqual({ stage: 'scored', count: 0 });
  });

  it('test_funnel_with_data', async () => {
    await createOutreach(await createBusiness());
    const data = await (await api('GET', '/reports/funnel', { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.stages.find((s: any) => s.stage === 'scored').count).toBe(1);
  });
});

describe('TestScoreDistribution', () => {
  it('test_empty_distribution', async () => {
    const res = await api('GET', '/reports/score-distribution', { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.total).toBe(0);
    expect(data.mean).toBeNull();
    expect(data.buckets).toHaveLength(10);
  });

  it('test_with_scores', async () => {
    await createScore(await createBusiness());
    const data = await (await api('GET', '/reports/score-distribution', { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.mean).toBe(48.25);
    expect(data.median).toBe(48.25);
    expect(data.buckets.find((b: any) => b.range_min === 40).count).toBe(1);
  });

  it('uses only the latest score version per business', async () => {
    const id = await createBusiness();
    await createScore(id, { score_version: 1, composite_acquisition_score: 10 });
    await createScore(id, { score_version: 2, composite_acquisition_score: 100 });
    const data = await (await api('GET', '/reports/score-distribution', { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.buckets.find((b: any) => b.range_min === 90).count).toBe(1);
  });
});

describe('TestZipPerformance', () => {
  it('test_empty', async () => {
    const res = await api('GET', '/reports/zip-performance', { token });
    expect(res.status).toBe(200);
    expect((await res.json() as any).items).toEqual([]);
  });

  it('test_with_data', async () => {
    await createScore(await createBusiness());
    const data = await (await api('GET', '/reports/zip-performance', { token })).json() as any;
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ zip_code: '60619', total_leads: 1, avg_composite_score: 48.25, contacted_count: 0, engaged_count: 0, won_count: 0, conversion_rate: 0 });
  });

  it('counts contacted, engaged and won from the latest outreach status', async () => {
    const won = await createBusiness();
    await createOutreach(won, { status: 'queued' });
    await createOutreach(won, { status: 'won' });
    const contacted = await createBusiness({ name: 'B2' });
    await createOutreach(contacted, { status: 'voicemail' });
    await createBusiness({ name: 'B3' });
    const data = await (await api('GET', '/reports/zip-performance', { token })).json() as any;
    expect(data.items[0]).toMatchObject({ total_leads: 3, contacted_count: 2, engaged_count: 1, won_count: 1, conversion_rate: 33.3 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd api && npx vitest run test/reports.test.ts
```

Expected: FAIL (funnel currently reads `pipeline_items`, which no longer exists).

- [ ] **Step 3: Rewrite `api/src/routes/reports.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { PIPELINE_STAGES } from '../lib/stages';
import { LATEST_OUTREACH_JOIN, LATEST_SCORE_JOIN } from './businesses';
import type { AppEnv } from '../types';

const router = new Hono<AppEnv>();

const CONTACTED = ['contacted', 'voicemail', 'engaged', 'meeting_scheduled', 'proposal_sent', 'negotiating', 'won'];
const ENGAGED = ['engaged', 'meeting_scheduled', 'proposal_sent', 'negotiating', 'won'];

function round(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// =py routes/reports.get_conversion_funnel
router.get('/funnel', requireAuth, async (c) => {
  const rows = await c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM outreach_records GROUP BY status').all<{ status: string; n: number }>();
  const counts = new Map((rows.results ?? []).map((r) => [r.status, r.n]));
  const stages = PIPELINE_STAGES.map((stage) => ({ stage, count: counts.get(stage) ?? 0 }));
  return c.json({ stages, total: stages.reduce((sum, s) => sum + s.count, 0) });
});

// =py routes/reports.get_score_distribution
router.get('/score-distribution', requireAuth, async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT ls.composite_acquisition_score AS score FROM businesses b ${LATEST_SCORE_JOIN}
              WHERE ls.composite_acquisition_score IS NOT NULL`)
    .all<{ score: number }>();
  const scores = (rows.results ?? []).map((r) => r.score).sort((a, b) => a - b);

  const buckets = [];
  for (let min = 0; min < 100; min += 10) {
    const max = min + 10;
    buckets.push({ range_min: min, range_max: max, count: scores.filter((s) => s >= min && (min < 90 ? s < max : s <= 100)).length });
  }
  let mean: number | null = null;
  let median: number | null = null;
  if (scores.length) {
    mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const mid = Math.floor(scores.length / 2);
    median = scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
  }
  return c.json({ buckets, total: scores.length, mean: round(mean, 2), median: round(median, 2) });
});

// =py routes/reports.get_zip_performance
router.get('/zip-performance', requireAuth, async (c) => {
  const inList = (n: number) => Array(n).fill('?').join(', ');
  const rows = await c.env.DB
    .prepare(`SELECT b.zip_code,
                     COUNT(b.id) AS total_leads,
                     AVG(ls.composite_acquisition_score) AS avg_score,
                     SUM(CASE WHEN lo.status IN (${inList(CONTACTED.length)}) THEN 1 ELSE 0 END) AS contacted,
                     SUM(CASE WHEN lo.status IN (${inList(ENGAGED.length)}) THEN 1 ELSE 0 END) AS engaged,
                     SUM(CASE WHEN lo.status = 'won' THEN 1 ELSE 0 END) AS won
              FROM businesses b ${LATEST_SCORE_JOIN} ${LATEST_OUTREACH_JOIN}
              GROUP BY b.zip_code
              ORDER BY total_leads DESC`)
    .bind(...CONTACTED, ...ENGAGED)
    .all<{ zip_code: string; total_leads: number; avg_score: number | null; contacted: number; engaged: number; won: number }>();

  const items = (rows.results ?? []).map((r) => ({
    zip_code: r.zip_code,
    total_leads: r.total_leads,
    avg_composite_score: round(r.avg_score, 2),
    contacted_count: r.contacted,
    engaged_count: r.engaged,
    won_count: r.won,
    conversion_rate: r.total_leads > 0 ? round((r.won / r.total_leads) * 100, 1) : null,
  }));
  return c.json({ items });
});

export default router;
```

- [ ] **Step 4: V**

```bash
cd api && npm run typecheck && npx vitest run test/reports.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/reports.ts api/test/reports.test.ts
git commit -m "refactor(api): rebase reports on outreach_records and versioned scores"
```

---

### Task 9: Wiring, dead code, docs

`X db/queries.ts; X temporary type aliases; +ADR-026; V full suite`

**Files:**
- Modify: `api/src/index.ts`, `api/src/types/index.ts`, `.claude/CLAUDE.md`, `docs/vault/README.md`, `docs/superpowers/plans/2026-05-13-leadforge-cloudflare-migration.md`
- Delete: `api/src/db/queries.ts`
- Create: `docs/vault/026-workers-api-mirrors-python-contract.md`

- [ ] **Step 1: Final `api/src/index.ts`**

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './types';
import authRoutes from './routes/auth';
import businessRoutes from './routes/businesses';
import leadRoutes from './routes/leads';
import pipelineRoutes from './routes/pipeline';
import outreachRoutes from './routes/outreach';
import webhookRoutes from './routes/webhooks';
import grantRoutes from './routes/grants';
import reportRoutes from './routes/reports';

const app = new Hono<{ Bindings: Bindings }>({ strict: false });

app.use('/api/*', cors({ origin: (origin) => origin || '*', credentials: true }));

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.route('/api/auth', authRoutes);
app.route('/api/businesses', businessRoutes);
app.route('/api/leads', leadRoutes);
app.route('/api/pipeline', pipelineRoutes);
app.route('/api/outreach', outreachRoutes);
app.route('/api/webhooks/retell', webhookRoutes);
app.route('/api/grants', grantRoutes);
app.route('/api/reports', reportRoutes);

export default app;
```

- [ ] **Step 2: Remove dead code**

```bash
cd api
git rm src/db/queries.ts
rg -n "db/queries|TEMPORARY" src   # expect no matches after the next edit
```

Delete the `// TEMPORARY` alias block at the bottom of `src/types/index.ts`. Confirm `rg -n "lib/scoring" src` returns nothing outside `lib/scoring.ts` itself.

- [ ] **Step 3: Write `docs/vault/026-workers-api-mirrors-python-contract.md`**

```markdown
# ADR-026: Workers API mirrors the Python API contract

## Status

Accepted

## Date

2026-09-02

## Context

The Cloudflare migration (spec 2026-05-13) ported six route modules to Hono/D1 from code pasted into the migration plan. That code defined its own schema (a `pipeline_items` table with 7 invented stages, a 5-column grant model with 10 invented stages, renamed outreach columns, `{ data, perPage }` pagination) rather than deriving from `src/leadforge`. The React frontend was built against the Python API and encodes the 12 outreach stages (ADR-018), the 13 NOF stages and 30-field grant model (ADR-020, 023, 024), and the Python response shapes. Against the Workers API the frontend could not render leads, the pipeline board, outreach history, or any grant screen.

## Decision

The Python API is the behavioral contract for the Workers API. Precedence when sources disagree: frontend client and types, then Python routes and schemas, then SQLAlchemy models, then Python tests. The D1 schema is one table per model with the same names, shipped as a wrangler migration. Every `tests/api/test_*.py` case is ported one-to-one to vitest under the same name. Deviations (PBKDF2 passwords, admin-only signup, `RETELL_API_KEY` as the webhook HMAC key, queue dispatch instead of Celery) are listed in `docs/superpowers/specs/2026-09-02-workers-contract-reconciliation-design.md`.

## Consequences

### Positive
- The frontend deploys against Workers unchanged (plan task 2.4 is unblocked).
- Behavior is testable against a spec that already exists; drift is caught by name-matched tests.

### Negative
- Tasks 1.2 and 1.5 through 2.2 of the migration plan were redone. Their pasted code is superseded.
- `api/src/lib/scoring.ts` still carries invented formulas and must be re-ported from `src/leadforge/scoring/` in the Phase 3 scoring task.

### Neutral
- Corridor membership stays pre-computed on `businesses` as designed on 2026-05-13.

## Alternatives Considered

1. Rename the stage enums only. Rejected: leaves every field-name and pagination mismatch; leads, outreach and grants screens still break.
2. Rewrite the frontend to the Workers contract. Rejected: drops the NOF financial fields and document checklist the product spec requires, and the Workers contract had no design record behind it.
```

Append to the index table in `docs/vault/README.md`:

```
| 026 | Workers API mirrors the Python API contract; D1 schema mirrors SQLAlchemy models | Accepted | 2026-09-02 |
```

- [ ] **Step 4: Point the old plan at the new spec and update the status line**

At the top of `docs/superpowers/plans/2026-05-13-leadforge-cloudflare-migration.md`, directly under the header blockquote, add:

```markdown
> **Superseded in part (2026-09-02):** the schema and route code in Tasks 1.2, 1.3, 1.5, 1.6, 1.7, 2.1 and 2.2 was replaced by `2026-09-02-workers-contract-reconciliation.md`. Tasks 2.4 onward still apply.
```

In `.claude/CLAUDE.md`, replace the paragraph beginning `Migration status as of 2026-09-02:` and the `**Known contract drift.**` paragraph with:

```markdown
Migration status as of 2026-09-02: the Workers API is re-ported to the Python contract (ADR-026, spec `docs/superpowers/specs/2026-09-02-workers-contract-reconciliation-design.md`) with a vitest suite under `api/test/` mirroring `tests/api/`. Remaining: frontend deploy to Pages (task 2.4), Workers AI client, queue consumers + cron handlers, scrapers, scoring re-port, decommission.
```

Also in `.claude/CLAUDE.md`: under **Architecture notes**, replace the sentence about `api/src/db/queries.ts` with: "D1 queries are inline in each route. Table names, column lists and ORDER BY fragments are literals from code; every value from a request goes through `.bind()`. The `LATEST_SCORE_JOIN` and `LATEST_OUTREACH_JOIN` fragments in `routes/businesses.ts` are the one place that picks the current score and stage per business." And replace the D1 command in **Commands** with `npx wrangler d1 migrations apply leadforge-db --local` (drop `--local` for remote).

- [ ] **Step 5: V — the whole suite**

```bash
cd api
npm run typecheck
npx vitest run
npm run build
```

Expected: typecheck clean; every test file green (schema 3, auth 16, businesses 12, leads 7, pipeline 8, outreach 7, webhooks 8, grants 13, financial-calculator 8, reports 8 = 90); `wrangler deploy --dry-run` succeeds.

- [ ] **Step 6: Commit**

```bash
git add api/src/index.ts api/src/types/index.ts docs/vault/026-workers-api-mirrors-python-contract.md docs/vault/README.md docs/superpowers/plans/2026-05-13-leadforge-cloudflare-migration.md .claude/CLAUDE.md
git commit -m "refactor(api): finish contract reconciliation; add ADR-026"
```

---

## Out of scope, recorded for later phases

- `api/src/lib/scoring.ts` formulas and `calcPriceTier` diverge from `src/leadforge/scoring/`. Re-port in the Phase 3 scoring task with `tests/unit/test_scoring.py`, `test_composite.py`, `test_viability.py`, `test_competitive_pressure.py` as the spec.
- No script exports businesses, scores and outreach from PostgreSQL into D1. `scripts/precompute_corridors.py` emits only `{ id, in_nof_corridor, nof_corridor_name }`. Phase 0's "export + import" needs a full-table exporter against the new column names.
- The remote D1 (`leadforge-db`) was created with the superseded `schema.sql`. Before `wrangler d1 migrations apply --remote`, drop the old tables or recreate the database; nothing in it is production data.


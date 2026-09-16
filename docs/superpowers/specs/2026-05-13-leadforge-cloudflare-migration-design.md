# LeadForge Cloudflare Migration Design

**Date:** 2026-05-13
**Status:** Draft
**Goal:** Eliminate self-managed infrastructure cost/overhead by migrating LeadForge to Cloudflare Workers, Pages, D1, Queues, Cron Triggers, Workers AI, and KV. Stand up a production-visible application that people can see.

## Architecture Overview

### Current Stack

```
6 Docker containers → ~26GB RAM, 10+ CPUs, self-managed
  - Frontend (React SPA → Nginx)
  - API (FastAPI Python → Uvicorn)
  - Celery worker + Celery beat (2 containers)
  - vLLM CPU inference (Qwen 3B, 20GB RAM)
  - PostgreSQL 16 + PostGIS
  - Redis 7
```

All containerized via docker-compose. Running on the user's machine, not production-deployed.

### Target Stack

```
0 self-managed containers → pay-per-use serverless
  - Frontend (React SPA → Cloudflare Pages)
  - API (Hono/TypeScript → Cloudflare Workers)
  - Task pipeline (Queues + Workflows + Cron Triggers)
  - LLM inference (Workers AI)
  - Database (D1 - SQLite-based, global)
  - Cache/Config (Workers KV)
```

## Database Design: Pre-compute + D1

### Problem
The current scoring engine uses PostGIS spatial queries (`ST_Contains`) to check whether a business falls within a municipal grant corridor (NOF). Cloudflare D1 (SQLite) does not support spatial extensions.

### Solution: One-Time Spatial Pre-compute

1. Run a one-time Python script using the existing PostGIS container
2. For each business with lat/lng coordinates, query corridor intersection:
   ```sql
   SELECT ST_Contains(nof_corridors.geometry, businesses.location)
   ```
3. Write the result as simple boolean fields on the business record:
   - `in_nof_corridor` (BOOLEAN)
   - `nof_corridor_name` (TEXT, nullable)
4. Export the full dataset as JSON
5. Import into D1 via `wrangler d1 execute`

After pre-compute, all spatial queries become simple:
```sql
SELECT * FROM businesses WHERE in_nof_corridor = true;
```

New businesses discovered after the migration get corridor membership checked at ingest time via a lightweight bounding-box comparison or geocoding API call — no PostGIS required.

### D1 Tables

10 tables, all flat (no geometry types, no spatial dependency):

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `businesses` | Core business entities | id, name, address, lat, lng, zip_code, niche, in_nof_corridor, nof_corridor_name, license_status |
| `digital_presence` | Website, reviews, ratings | business_id, has_website, website_url, google_review_count, google_avg_rating, yelp_review_count, yelp_rating, website_quality_score |
| `lead_scores` | Versioned scoring history | business_id, score_version, digital_deficit_score, viability_score, competitive_pressure_score, composite_acquisition_score, price_tier |
| `competitive_contexts` | Per-zip+niche market data | zip_code, niche, business_density, avg_rating, total_reviews |
| `outreach_records` | Voice call logs | business_id, call_id, status, duration, transcript, disposition, sentiment_score |
| `grant_applications` | 13-stage grant pipeline | business_id, stage, corridor_name, amount_requested, documents, status |
| `grant_documents` | File metadata for grants | grant_application_id, filename, uploaded_at |
| `nof_corridors` | Corridor metadata (no geometry) | name, description, boundary_description |
| `users` | Auth + roles | email, hashed_password, name, role (admin/viewer) |
| `scoring_weights` | Config for scoring algorithm | weight_name, value |

### D1 Configuration

```jsonc
{
  "d1_databases": [
    { "binding": "DB", "database_name": "leadforge", "database_id": "<DB_ID>" }
  ]
}
```

## Workers API Architecture

### Tech Stack

| Python (Current) | JS/TS (Target) |
|------------------|----------------|
| FastAPI | Hono |
| Pydantic v2 | Zod |
| SQLAlchemy async | D1 `env.DB.prepare()` |
| python-jose (JWT) | Web Crypto API |
| structlog | console.log |
| pydantic-settings | env vars + Secrets Store |
| httpx | fetch() |
| Celery | Queues binding |

### File Structure

```
src/
├── index.ts                 # Hono app entry + bindings + middleware
├── db/
│   ├── schema.sql           # D1 init SQL (CREATE TABLE statements)
│   └── queries.ts           # Shared query helpers
├── routes/
│   ├── auth.ts              # POST /login, POST /refresh, POST /logout, GET /profile
│   ├── businesses.ts        # GET /businesses, GET /businesses/:id, PATCH /businesses/:id
│   ├── leads.ts             # GET /leads (ranked), GET /leads/:id/history
│   ├── pipeline.ts          # GET /pipeline (kanban), POST /pipeline/transition
│   ├── outreach.ts          # GET /outreach, GET /outreach/:id, GET /outreach/:id/transcript
│   ├── grants.ts            # 9 endpoints: CRUD, stages, documents, financial calculator, board
│   ├── reports.ts           # GET /reports/funnel, /reports/scores, /reports/zip-performance
│   └── health.ts            # GET /health
├── middleware/
│   ├── auth.ts              # JWT verification Hono middleware
│   └── cors.ts              # CORS header injection
├── lib/
│   ├── scoring.ts           # Digital deficit, viability, competitive pressure, composite
│   ├── llm.ts               # Workers AI client wrapper
│   ├── voice.ts             # Retell AI API client
│   ├── grants.ts            # Financial calculator
│   └── export.ts            # CSV export
└── types/
    └── index.ts             # Shared TypeScript types
```

### Route-by-Route Migration Strategy

Each route module is ported independently. During the migration window, a reverse proxy (or frontend config) routes requests to either the old Python API or the new Workers endpoint:

```
Frontend request → /api/auth/* → Workers ✅
                → /api/businesses/* → Python (old) until ported
                → /api/leads/* → Workers ✅
                → etc.
```

This allows shipping working endpoints incrementally — no big-bang cutover. The old Python API stays running until all 8 route modules are ported.

### Auth Flow

Unchanged from current design:
- JWT with access tokens (60min) + refresh tokens (30 days)
- Refresh token stored in HTTP-only cookie
- Login returns access token + sets refresh cookie
- All routes except `/health`, `/auth/login`, and webhooks require valid JWT
- Admin role vs viewer role enforced at middleware level

Web Crypto API replaces python-jose:
```typescript
const key = await crypto.subtle.importKey(
  "raw",
  encoder.encode(JWT_SECRET),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["verify"]
);
```

### Wrangler Configuration

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
    ],
    "consumers": [
      { "queue": "leadforge-enrichment", "max_batch_size": 10, "max_batch_timeout": 30 },
      { "queue": "leadforge-outreach", "max_batch_size": 5, "max_batch_timeout": 30 },
      { "queue": "leadforge-sentiment", "max_batch_size": 10, "max_batch_timeout": 30 },
      { "queue": "leadforge-recalibration", "max_batch_size": 10, "max_batch_timeout": 30 }
    ]
  },

  "triggers": {
    "crons": [
      "0 6 * * *",   // Daily enrichment pipeline
      "30 6 * * *",  // Daily scoring recalibration
      "0 7 * * 1",   // Weekly corridor refresh
      "0 8 * * *"    // Daily outreach dispatch
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

## Migration Phases

### Phase 0: Prerequisites
- Set up Cloudflare account + Workers + Pages + D1
- Create D1 database: `wrangler d1 create leadforge-db`
- Pre-compute spatial data using existing PostGIS
- Export + import into D1

### Phase 1: Database + API Core
- Write D1 schema (schema.sql)
- Scaffold Workers project with Hono
- Implement auth middleware (JWT via Web Crypto)
- Implement D1 query helpers
- First route: `/health` and `/auth/*`
- Deploy Workers → people can see auth works

### Phase 2: Business Routes
- Port `businesses.ts` — CRUD + enrichment endpoints
- Port `leads.ts` — ranked list + score history
- Port `pipeline.ts` — kanban board + stage transitions
- These 3 routes cover the core CRM experience

### Phase 3: Outreach + Grants
- Port `outreach.ts` — call history, transcripts, updates
- Port `grants.ts` — full 13-stage pipeline + financial calculator
- Port `reports.ts` — funnel, score distribution, zip performance

At this point the full API is live on Workers. Old Python API can be turned off.

### Phase 4: Frontend
- Deploy React SPA to Cloudflare Pages
- Update API base URL to Workers endpoint
- Set up Pages Functions for any server-side needs (or remove proxy)
- `wrangler pages deploy ./dist`

**Can be pulled forward.** The frontend is a standalone React SPA with zero server-side dependencies. It can be deployed to Pages at any time — even pointing at the old Python API during early phases. This gives a visible live deployment early.

### Phase 5: LLM (Workers AI)
- Replace vLLM CPU container with Workers AI
- Workers AI supports various open models — check current catalog at `https://developers.cloudflare.com/workers-ai/models/`. The Qwen 3B/8B class is well-covered
- Entity resolution, data extraction → Workers AI via `env.AI.run()`
- All LLM calls → Workers AI via `env.AI.run()`. No external LLM APIs.

### Phase 6: Task Pipeline (Queues + Cron)
- Port 5 Celery task types to Queue consumers
- Auth webhook handler → Workers `fetch()` handler with Retell signature verification
- Sentiment analysis → Queue consumer + Workers AI
- Recalibration → Cron-triggered Worker

### Phase 7: Scrapers
- Port all 11 scraper clients from Python httpx to Workers `fetch()`
- Rate limiting per source via Durable Object (counter + alarm pattern)
- Cookie management (Nextdoor) via KV
- browser-based scraping (DFPR, IL SOS) → Workers Browser Rendering

### Phase 8: Cleanup
- Decommission Docker containers
- Archive Python codebase as reference for future self-hosted hardware
- Document operational runbook for Cloudflare deployment

## Things That Stay (for now)

- **Everything on Workers AI** — All LLM tasks (entity resolution, extraction, outreach briefs, sentiment analysis) run on Workers AI models. No external API keys, no Azure, no Anthropic. Well-prompted open models (Llama 3, Mistral, DeepSeek, Qwen) handle outreach briefs. Some prompt engineering iteration expected to match Claude quality.
- **Retell AI** — Voice calls remain a third-party service. Workers wraps the Retell API and handles webhooks.
- **Google Places + Socrata** — External data sources remain unchanged. Workers wraps the API calls.

## Infrastructure Comparison

Current setup runs locally (no ongoing hosting cost). The savings represent what self-managed cloud hosting would cost vs going serverless.

| Resource | Before (self-hosted cloud) | After (Cloudflare) |
|----------|---------------------------|-------------------|
| Frontend hosting | Nginx container (~$5/mo) | Cloudflare Pages (free) |
| API server | Docker container (~$5-10/mo) | Workers (100k req/day free) |
| vLLM inference | 20GB RAM + 6 CPUs (~$30-50/mo) | Workers AI (pay-per-inference) |
| Redis / Celery broker | Docker container (~$5/mo) | Managed Queues (free tier) |
| Database | PostgreSQL + PostGIS (~$10-15/mo) | D1 (free tier) |
| Task scheduling | Celery Beat container (~$5/mo) | Cron Triggers (free) |
| **Total self-managed** | **~$60-90/mo** | **$0 + Workers AI usage** |

## Open Questions / Future Considerations

1. **D1 limits** — Check current D1 pricing and read/write limits at `https://developers.cloudflare.com/d1/platform/pricing/`. LeadForge's daily scoring pipeline may need batch size adjustments depending on the per-query row limits.
2. **Workers CPU time** — Entity resolution and scoring could take >10ms per request. If the pipeline processes 1000s of businesses, consider splitting into multiple Queue messages to avoid per-request CPU limits.
3. **Self-hosted hardware** — If the user later moves to self-hosted hardware, the Python codebase remains available as reference. The D1 data can be exported and re-imported into PostGIS.
4. **Browser Rendering** — Phase 7 scrapers that need headless browsing (DFPR, IL SOS) will use Workers Browser Rendering. This is a paid add-on ($0.005/request). Evaluate if worth the cost vs alternative approaches.

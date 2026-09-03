# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

LeadForge discovers under-digitized Chicago small businesses from public data, scores them, generates LLM outreach briefs, and runs AI voice calls (Retell). A React CRM tracks outreach and a parallel NOF grant pipeline.

**Two backends coexist.** The `refactor/cf-migration` branch is porting the app from self-hosted Python to Cloudflare, route by route:

| | Legacy (reference implementation) | Target (in progress) |
|---|---|---|
| Location | `src/leadforge/` | `api/` |
| Stack | FastAPI, SQLAlchemy 2 async, PostgreSQL+PostGIS, Celery+Redis, vLLM + Claude (Azure Foundry) | Hono, Zod, D1 (SQLite), Queues, Cron Triggers, Workers AI, KV |
| Tests | `tests/` (pytest, 158 tests) | `api/test/` (vitest on `@cloudflare/vitest-plugin`, 126 tests mirroring `tests/api/`) |

The Python code is the behavioral spec. When porting a route, read the matching module under `src/leadforge/api/routes/` and its tests first, and reproduce stage transitions, scoring math, and auth rules exactly. Design and task-by-task plan: `docs/superpowers/specs/2026-05-13-leadforge-cloudflare-migration-design.md` and `docs/superpowers/plans/2026-05-13-leadforge-cloudflare-migration.md`.

Migration status as of 2026-09-02: the Workers API is re-ported to the Python contract (ADR-026, spec `docs/superpowers/specs/2026-09-02-workers-contract-reconciliation-design.md`) with a vitest suite under `api/test/` mirroring `tests/api/`, and the frontend is deployed to Pages at https://leadforge-frontend-80u.pages.dev (task 2.4, ADR-027). The Worker is deployed at https://leadforge-api.crichalchemist.workers.dev with the remote D1 migrated, both secrets set, and the first admin user inserted. The Workers AI client and prompt modules are ported under `api/src/lib/llm/` (task 3.1) with no HTTP routes; consumers arrive with the queue handlers. Remaining: queue consumers + cron handlers, scrapers, scoring re-port, decommission.

## Commands

### Python backend (`src/leadforge`)

```bash
uv sync --all-extras                       # install incl. dev extras
make dev                                   # docker compose up -d db redis
make migrate                               # uv run alembic upgrade head
uv run alembic revision --autogenerate -m "msg"
uv run uvicorn leadforge.api.app:app --reload   # API on :8000
uv run leadforge --help                    # Typer CLI: pipeline, enrich, score, context, outreach, call-status, export, create-user
make test                                  # pytest with coverage
uv run pytest tests/unit/test_composite.py -v          # one file
uv run pytest tests/api -k "transition" -v             # by keyword
make lint                                  # ruff check + ruff format --check
make format
```

Ruff rules: E, F, I, N, W. Tests use `asyncio_mode = "auto"`, so async tests need no marker.

### Workers API (`api/`)

```bash
cd api
npm install
npm run dev            # wrangler dev, local miniflare D1/KV under api/.wrangler/state
npm run typecheck      # tsc --noEmit (strict)
npm run build          # wrangler deploy --dry-run
npm test               # vitest
npx wrangler d1 migrations apply leadforge-db --local   # apply migrations locally; drop --local for remote
npx wrangler secret put JWT_SECRET
npx wrangler secret put RETELL_API_KEY   # HMAC key for the Retell webhook
npx wrangler deploy    # single production deployment: https://leadforge-api.crichalchemist.workers.dev
```

`wrangler.jsonc` holds production values; `api/.dev.vars` overrides `CORS_ORIGINS` to the Vite origin for `wrangler dev`.

### Frontend (`frontend/`)

```bash
cd frontend
npm install
npm run dev            # Vite on :5173
npm run build          # tsc -b && vite build; .env.production bakes VITE_API_BASE_URL into dist/
npx wrangler pages deploy dist --project-name=leadforge-frontend --branch=master   # Pages: https://leadforge-frontend-80u.pages.dev
```

## Architecture notes that span files

**Route prefixes differ between backends.** The frontend axios client uses `baseURL: '/api'`. The Vite dev proxy forwards `/api/*` to `localhost:8000` and strips the `/api` prefix because FastAPI mounts routers at the root. The Workers app mounts everything under `/api/*`. The production build points at the Worker directly through `VITE_API_BASE_URL` in `frontend/.env.production` (ADR 027); in dev the value is unset and the proxy applies, so the prefix is stripped only for FastAPI.

**Auth.** Both backends issue HS256 JWTs with `sub`, `role` (`admin` | `viewer`), and `type` (`access` | `refresh`) in the payload — no `email`. Access tokens 60 min, refresh tokens 30 days in an HTTP-only cookie. On Workers the cookie is `SameSite=None; Secure` because the Pages frontend is cross-site (ADR 027), and the production `CORS_ORIGINS` var must list the Pages origin exactly. Public routes: health, login/refresh, and the Retell webhook. Every other route requires a token, and writes require `admin`. In Workers, `requireAuth` sets `user` on the Hono context and `requireAdmin` reads it, so `requireAdmin` must be chained after `requireAuth`. `JWT_SECRET` is required: auth routes and middleware return 500 `{ detail: 'JWT_SECRET not configured' }` when it is unset. Set it with `wrangler secret put JWT_SECRET` before deploying.

D1 queries are inline in each route. Table names, column lists and ORDER BY fragments are literals from code; every value from a request goes through `.bind()`. The `LATEST_SCORE_JOIN` and `LATEST_OUTREACH_JOIN` fragments in `routes/businesses.ts` are the one place that picks the current score and stage per business.

**No spatial queries on D1.** NOF corridor membership was computed once against PostGIS with a 50 m `ST_DWithin` buffer (`scripts/precompute_corridors.py`) and stored as `in_nof_corridor` / `nof_corridor_name` on `businesses`. New businesses need a non-PostGIS check at ingest.

**Scoring.** Composite = 0.40 digital deficit + 0.35 viability + 0.25 competitive pressure, capped at 100, plus a price tier (1 to 3) derived from revenue, headcount, and pressure. Python versions are pure functions in `src/leadforge/scoring/` and `api/src/lib/scoring.ts` is a frozen, unreferenced placeholder whose formulas diverge from Python; it is re-ported in the Phase 3 scoring task. Scores are versioned rows in `lead_scores`, never overwritten. Post-call sentiment adjusts the composite multiplicatively, once per call (ADR 014).

**Pipeline stages.** Outreach stages and the allowed transitions live in `VALID_TRANSITIONS` in `src/leadforge/api/routes/pipeline.py`. The grant pipeline has 13 stages on `GrantApplication` and is a separate track from outreach (ADR 023). Backends reject invalid transitions; the frontend does optimistic updates.

**Retell webhook** verifies the `X-Retell-Signature` HMAC against the raw request body, not the parsed JSON. Handlers are idempotent on `call_id`.

**Python test fixtures.** API tests run on in-memory aiosqlite. `tests/api/conftest.py` swaps GeoAlchemy2 `Geometry` columns to `String` and registers stub spatial functions, so any new model with a geometry column must survive that shim. `settings = Settings()` is evaluated at import time in `leadforge/config.py`, so conftests set env vars before importing anything from `leadforge`. Scoring unit tests pass `MagicMock(spec=DigitalPresence)` objects rather than DB rows.

**LLM routing.** In Python, vLLM handles high-volume batch tasks (entity resolution, GBP assessment) and Claude handles outreach briefs and sentiment (ADR 011). On Workers the same split is `fastClient` and `qualityClient` in `api/src/lib/llm/client.ts`, both on Workers AI; the prompt modules beside it (`entity-resolution`, `outreach-brief`, `sentiment`) port their Python namesakes and take a client argument so tests inject a fake. Python's website extraction, revenue estimate, and GBP assessment have no callers and were not ported. All LLM outputs are parsed from JSON with fence stripping, and every function returns a documented fallback instead of throwing when the model fails.

**Celery to Queues.** Five task modules under `src/leadforge/tasks/` map onto the four queues and four crons declared in `api/wrangler.jsonc`. Queue consumers and cron handlers are meant to live in the same Worker as the HTTP app.

## Docs conventions

- Architecture decisions are ADRs in `docs/vault/NNN-title.md`, indexed in `docs/vault/README.md` with reserved number blocks per phase. Record a new ADR when changing an architectural choice; supersede rather than edit accepted ones.
- Feature specs and implementation plans go under `docs/superpowers/specs/` and `docs/superpowers/plans/`, dated `YYYY-MM-DD-slug.md`.
- Operational env-var reference and troubleshooting: `docs/vault/operations-guide.md`.

## Known discrepancies

- `Dockerfile` CMD runs `leadforge.api.main:app`, but the app object is `leadforge.api.app:app`. The README and Makefile use the correct path.
- `api/wrangler.jsonc` declares four cron triggers and four queue producers, but `src/index.ts` exports no `scheduled` or `queue` handler yet, so each cron firing logs a handler error until task 3.2 lands. `COOKIE_STORE` is bound but unused by any route.
- There is no CI workflow or pre-commit config in the repo.

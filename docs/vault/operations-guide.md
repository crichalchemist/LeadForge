# LeadForge Operations Guide

Internal reference for team setup, daily operations, and troubleshooting.

Two backends coexist on `main`, and almost nothing about their operation is shared. The Python
backend under `src/leadforge/` runs locally against PostgreSQL and is the reference
implementation; the Workers backend under `api/` is what is deployed. Configuration, secrets,
migrations, and the cookie rules all differ. Each section below says which backend it applies to.

- Python backend: [Environment variables](#environment-variables-python-backend) onwards
- Workers backend: [Workers API operations](#workers-api-operations)
- Both: [CI and commit hooks](#ci-and-commit-hooks)

## Environment Variables (Python backend)

Copy `.env.example` to `.env` and fill in all values. Here's what each one does. The Workers
backend reads none of these — see [Workers API operations](#workers-api-operations) for its
`wrangler.jsonc` vars and secrets.

### Infrastructure

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Default: `postgresql+asyncpg://leadforge:leadforge@localhost:5432/leadforge` |
| `REDIS_URL` | Yes | Redis connection string for Celery. Default: `redis://localhost:6379/0` |

### Authentication

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET_KEY` | Yes | Random 64-char hex string. Generate: `openssl rand -hex 32`. Changing this invalidates all active sessions. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | Access token lifetime. Default: `60` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | No | Refresh token lifetime. Default: `30` |

### Data Sources

| Variable | Required | Description |
|----------|----------|-------------|
| `SOCRATA_APP_TOKEN` | Yes | Chicago Data Portal app token. Get from [data.cityofchicago.org](https://data.cityofchicago.org/profile/edit/developer_settings) |
| `GOOGLE_PLACES_API_KEY` | Yes | Google Places API key. Enable Places API in GCP console. |
| `GOOGLE_PLACES_API_SECRET` | No | For signed requests. |

### LLM

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_FOUNDRY_RESOURCE` | Yes | Azure Foundry resource name |
| `ANTHROPIC_FOUNDRY_API_KEY` | Yes | Azure Foundry API key. Auth header is `x-api-key` (NOT `api-key`). |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | No | Deployment name. Default: `claude-sonnet-4-5-2` |
| `OPENROUTER_API_KEY` | No | OpenRouter API key for routing |
| `OPENROUTER_MODEL_ID` | No | Default model for OpenRouter |
| `VLLM_BASE_URL` | No | vLLM endpoint. Default: `http://localhost:8001/v1` |
| `VLLM_MODEL` | No | Model served by vLLM. Default: `Qwen/Qwen2.5-3B-Instruct` |

ADR 008 and ADR 011 both discuss Qwen2.5-**7B**; the shipped default is the **3B** instruct model,
because the decision was to pick by available VRAM and this runs on CPU. The config is correct and
the ADRs record the earlier sizing — treat `.env.example` as the source of truth.

### Voice Outreach

| Variable | Required | Description |
|----------|----------|-------------|
| `RETELL_API_KEY` | Yes | Retell AI API key from dashboard |
| `RETELL_FROM_NUMBER` | Yes | E.164 phone number purchased in Retell. Example: `+17731234567` |

### Tuning

| Variable | Required | Description |
|----------|----------|-------------|
| `CORS_ORIGINS` | No | JSON array of allowed origins. Default: `["http://localhost:5173"]` |
| `RECALIBRATION_SCORE_CHANGE_THRESHOLD` | No | Score delta to flag as significant. Default: `0.10` (10%) |
| `NOF_ELIGIBILITY_THRESHOLD` | No | Min NOF eligibility score for grant-first pitch. Default: `50.0` |

## Database (Python backend)

### Start PostgreSQL + PostGIS

```bash
docker compose up -d db
```

Uses `postgis/postgis:16-3.4`. Data persists in the `pgdata` Docker volume.

### Run migrations

```bash
uv run alembic upgrade head
```

### Check migration status

```bash
uv run alembic current
```

### Create a fresh migration

```bash
uv run alembic revision -m "description_here"
```

Then edit the file in `migrations/versions/`. Follow the pattern in existing migrations (manual SQL for enum types, `op.create_table` for tables).

### Reset database (destructive)

```bash
docker compose down -v   # deletes pgdata volume
docker compose up -d db
uv run alembic upgrade head
```

## User Management (Python backend)

The Workers backend has no CLI. Its first admin user was inserted into D1 directly; subsequent
users go through `POST /api/auth/signup`, which requires an existing admin token. See
[Workers API operations](#workers-api-operations).

### Create a user

```bash
uv run leadforge create-user --email admin@example.com --name "Jane Doe" --role admin
```

- Prompts for password interactively (not stored in shell history)
- Password must be at least 12 characters
- Roles: `admin` (full read/write) or `viewer` (read-only)
- Duplicate emails are rejected

### Roles

| Role | Can do | Cannot do |
|------|--------|-----------|
| `admin` | Everything: view data, edit businesses, transition pipeline stages, manage grants | — |
| `viewer` | View all data, dashboards, reports | Edit, transition stages, create grants |

### Deactivating a user

No CLI command yet. Update directly in the database:

```sql
UPDATE users SET is_active = false WHERE email = 'user@example.com';
```

Their next API request or token refresh will fail with 401.

## Running Locally (Python backend)

### API server

```bash
uv run uvicorn leadforge.api.app:app --reload --host 0.0.0.0 --port 8000
```

### Frontend dev server

```bash
cd frontend
npm install   # first time only
npm run dev   # serves on http://localhost:5173
```

Since CRM wave 1 (2026-09-26) the proxy forwards `/api/*` requests to `wrangler dev` on
`http://localhost:8787` and keeps the prefix, so the FastAPI server is no longer reachable from
`npm run dev`. See `frontend/vite.config.ts`.

### vLLM (local CPU inference)

```bash
docker compose up -d vllm
```

- First run downloads ~6GB model to `vllm-cache` volume (takes a while)
- Serves on `http://localhost:8001/v1` (OpenAI-compatible API)
- Needs ~20GB RAM (12GB weights + KV cache)
- CPU inference is slow (~30-120s per request). Set `VLLM_TIMEOUT=120` if you hit timeouts.

### Celery worker (background tasks)

```bash
uv run celery -A leadforge.tasks.celery_app worker --loglevel=info
```

### Celery beat (scheduled tasks)

```bash
uv run celery -A leadforge.tasks.celery_app beat --loglevel=info
```

### Full stack via Docker Compose

```bash
docker compose up -d
```

Starts: PostgreSQL, Redis, API, Celery worker, Celery beat, vLLM, and frontend (nginx on port 3000).

## CLI Commands (Python backend)

All commands: `uv run leadforge --help`

| Command | Description | Example |
|---------|-------------|---------|
| `pipeline` | Run discovery: Socrata → Google Places → Score → Persist | `uv run leadforge pipeline --zip 60619 --niche barbershops` |
| `enrich` | Enrich businesses with Google Places data | `uv run leadforge enrich --zip 60619 --niche barbershops` |
| `score` | Run full scoring pipeline for a zip+niche | `uv run leadforge score --zip 60619 --niche barbershops` |
| `context` | Compute competitive context for a zip+niche | `uv run leadforge context --zip 60619 --niche barbershops` |
| `outreach` | Run outreach pipeline (brief → call) | `uv run leadforge outreach --zip 60619 --niche barbershops --dry-run` |
| `call-status` | Check status of outreach calls | `uv run leadforge call-status --zip 60619` |
| `export` | Export scored leads to CSV | `uv run leadforge export --min-score 40 -o leads.csv` |
| `create-user` | Create a CRM user | `uv run leadforge create-user --email a@b.com --name "Name" --role admin` |

Valid niches — fifteen, identical in both backends (`NICHE_MAPPING` in
`src/leadforge/scrapers/socrata.py` and `NICHES` in `api/src/lib/stages.ts`):
`barbershops`, `bars`, `beauty_shops`, `beauty_supply`, `lawn_services`, `meat_markets`,
`mobile_mechanics`, `nail_salons`, `security_services`, `septic_services`, `smoke_shops`,
`tire_shops`, `towing`, `used_auto_parts`, `veterinarians`.

An earlier version of this guide listed six, three of which (`auto_repair`, `restaurants`,
`laundromats`) have never existed in either mapping. A niche with no mapping logs a warning and
returns nothing, so a typo here reads as "no businesses found" rather than as an error.

## Deployment Notes (Python backend)

### JWT secret rotation

1. Generate a new secret: `openssl rand -hex 32`
2. Update `JWT_SECRET_KEY` in `.env`
3. Restart the API server
4. All existing tokens (access + refresh) are immediately invalid — everyone must re-login

On Workers the same secret is named `JWT_SECRET` and is rotated with
`npx wrangler secret put JWT_SECRET` followed by a deploy. The two backends do not share a secret,
so a token issued by one is not valid at the other.

### CORS for production

Update `CORS_ORIGINS` in `.env` to your actual frontend domain:

```
CORS_ORIGINS=["https://crm.yourdomain.com"]
```

### Cookie settings for production

In **Python**, the refresh token cookie is set with `secure=True` and `samesite=lax`. This requires
HTTPS in production. If running behind a reverse proxy, ensure `X-Forwarded-Proto: https` is set.

In **Workers** it is `SameSite=None; Secure` instead, because the Pages frontend is a different
origin from the Worker and `Lax` would suppress the cookie on the cross-site refresh request
(ADR 027). That also means the production `CORS_ORIGINS` var must list the Pages origin exactly —
a wildcard will not do, since credentialed requests reject `*`.

### Anthropic (Azure Foundry) gotchas

- Endpoint format: `https://{resource}.cognitiveservices.azure.com/anthropic/`
- Auth header is `x-api-key` (NOT the standard Azure `api-key` header)
- The Anthropic SDK's `base_url` should NOT include `/v1/` — the SDK adds it

## Workers API operations

Everything here runs from `api/`. The deployed Worker is
https://leadforge-api.crichalchemist.workers.dev

### Configuration

Non-secret values live in `api/wrangler.jsonc`, which is tracked:

| Binding | What it is |
|---|---|
| `DB` | D1 database `leadforge-db`, migrations in `api/migrations/` |
| `AI` | Workers AI, used by both the fast and quality LLM clients |
| `ENRICHMENT_QUEUE`, `OUTREACH_QUEUE`, `SENTIMENT_QUEUE`, `RECALIBRATION_QUEUE` | Queue producers |
| consumer | `leadforge-sentiment` only, 2 retries with a 60 s delay, matching the Celery policy |
| `COOKIE_STORE` | KV namespace, bound but not read by any route |
| `vars.CORS_ORIGINS` | The Pages origin, listed exactly |
| `triggers.crons` | Empty. Add each cron together with its handler, never before |

Three of the four queues have a producer bound that nothing sends to, and no consumer that would
read it; they wait on the scraper, voice, and scoring ports. The sentiment consumer has no
dead-letter queue, matching Celery, so a message that exhausts its retries leaves only the logged
errors as a trace.

The one live path is: `POST /api/webhooks/retell/*` enqueues on `SENTIMENT_QUEUE`, and
`tasks/sentiment.ts` consumes it, calls Workers AI, and applies the score feedback. It is the only
caller of `api/src/lib/llm/` — the outreach-brief and entity-resolution modules are ported and
tested but reached by nothing.

CRM wave 1 (2026-09-26) added three routes worth naming here: `GET /api/businesses/:id/provenance`
admits any signed-in user (not just admin) and returns which source — Google's verdict, Overture's,
or the licence itself — backs each fact on the record (ADR 031); `POST /api/outreach` is admin-only
and puts a business on the outreach line, answering `201` on success or `409` (with the existing
record's id) if it is already there; and `GET /api/pipeline/transitions` returns the same
`VALID_TRANSITIONS` map the stage-change route enforces, so the frontend never keeps a second copy
that could drift from it.

### Local development against the Worker

Since CRM wave 1, local frontend development runs against a real Worker instead of the Python
backend (see [Frontend dev server](#frontend-dev-server)):

```bash
cd api && npx wrangler d1 migrations apply leadforge-db --local
npx wrangler dev --local --var JWT_SECRET:<any-local-value> --var GOOGLE_PLACES_API_KEY:<key from the gitignored .env>
cd frontend && npm run dev       # http://localhost:5173, proxied to the Worker on 8787
npm run e2e                      # Playwright: its own fresh seeded D1; stop the two servers above first
```

The Places key is passed with `--var` and never written to `api/.dev.vars` — that file is tracked in
git, so anything placed there is staged by default (see [Secrets](#secrets) below). On macOS 13
Intel, Playwright ships no Chromium, so `npm run e2e` fails to launch there; any OS Playwright
supports can run it locally, and it otherwise runs in CI.

### Secrets

```bash
npx wrangler secret put JWT_SECRET               # required; auth 500s without it
npx wrangler secret put RETELL_API_KEY           # HMAC key for the webhook signature
npx wrangler secret put GOOGLE_PLACES_API_KEY    # discovery enrichment (ADR 030)
```

Optional: `GOOGLE_PLACES_API_SECRET` (URL signing; unset, and `buildSignedUrl` only signs when it
is set). `YELP_API_KEY` is safe to set — no scoring module reads the Yelp columns. **`APIFY_API_TOKEN`
is not**: setting it starts writing `has_meta_ads`, which feeds the digital deficit and competitive
context, and would make Workers score differently from Python.

> **`api/.dev.vars` is tracked in git and has no `.gitignore` rule.** It is the file wrangler reads
> for local secrets, so anything put there is staged by default. It currently holds only
> `CORS_ORIGINS`. Pass throwaway local values with `wrangler dev --var KEY:value` instead.

### D1 migrations

```bash
npx wrangler d1 migrations apply leadforge-db            # LOCAL miniflare state
npx wrangler d1 migrations apply leadforge-db --remote   # production
```

`--remote` is the opt-in, and there is no `--local` to forget: wrangler 4 defaults to local, so
dropping the flag silently migrates the miniflare database in `api/.wrangler/state` and reports
success. Verify a production migration by querying for something it created rather than by trusting
the exit code.

### Deploy

```bash
npm run typecheck      # tsc --noEmit, strict
npm test               # vitest on workerd
npm run build          # wrangler deploy --dry-run: bundles and validates bindings, no credentials
npx wrangler deploy
```

**Deploy CRM wave 1 in this order**, because it carries migration 0005 and new routes:

```bash
npx wrangler d1 migrations apply leadforge-db --remote   # 1. the schema
npx wrangler deploy                                      # 2. the Worker
# 3. the Pages deploy, --branch=master (Frontend on Pages, below)
```

The migration goes first because a Worker without 0005 fails every discovered business in its batch after
its Places calls are paid for. The Worker goes before Pages because a frontend ahead of the Worker gets
404s on the new routes.

### Frontend on Pages

```bash
cd frontend && npm run build
npx wrangler pages deploy dist --project-name=leadforge-frontend --branch=master
```

**`--branch=master` is deliberate and outlived the git rename to `main`.** Pages decides
production-versus-preview by matching that value against the *project's* own production branch
setting, which is independent of git and was fixed as `master` when the project was created.
Passing `--branch=main` before changing the dashboard setting publishes to a preview URL instead of
production, silently. Change the dashboard setting first, then the flag.

`frontend/.env.production` bakes `VITE_API_BASE_URL` into `dist/`, so the production bundle talks to
the Worker directly rather than through a dev proxy.

### Users

The Workers user table is not interchangeable with Python's. Passwords are PBKDF2-SHA256 via Web
Crypto, stored as `pbkdf2$<iterations>$<salt_b64url>$<hash_b64url>`; Python's bcrypt hashes are not
portable to the Workers runtime, so no user row migrates between backends.

There is still no bootstrap CLI for the *remote* D1 — the first production admin row was inserted by
hand, and `POST /api/auth/signup` creates every user after that, requiring an existing admin token.

Locally this is no longer a procedure nobody has run. `frontend/e2e/seed.mjs`'s `admin` CLI form
prints the same insert, hashed in the format above, for one operator-supplied admin against the
default local D1:

```bash
cd frontend
LEADFORGE_LOCAL_PASSWORD=<password> node e2e/seed.mjs admin <you@example.com> > ../api/.wrangler/local-admin.sql
cd ../api && npx wrangler d1 execute leadforge-db --local --file .wrangler/local-admin.sql
```

The identical `adminSql()` path — same file, called from `frontend/e2e/start-api.mjs` via
`seedSql()` — now runs unattended on every push: the `e2e` CI job seeds a fresh local D1 this way
before each Playwright run, just with its own fixture credentials rather than an operator-supplied
email and password.

### Rebuilding the Overture match table

`scripts/build_overture_matches.py` runs a DuckDB query over Overture's Parquet release and emits
SQL chunks that load into `overture_matches` (migration 0004). Overture cannot be queried from a
Worker, so this is always precomputed, never live.

- **Run it from the repo root.** It resolves the bundled IDF table by the relative path
  `api/src/data/name-idf.json`.
- **Rebuilds are wholesale.** The first chunk truncates the table, so recovery is always to restart
  from chunk 000. Resuming midway is not safe.
- **Do not run discovery while the table is truncated.** Dedup happens before enrichment, so a
  business discovered in that window is never revisited, and only the backfill can repair it.
- A partial load can therefore only produce *missing* data, never wrong data: an absent row means
  "not yet covered", and both consumers handle that.

`POST /api/enrichment/overture-backfill` improves businesses already stored. Its limit is 15 per
call by design — each candidate costs a 3-statement batch plus a select — and it is idempotent, so a
small limit just means calling it again.

## CI and commit hooks

Applies to both backends. `.github/workflows/ci.yml` runs on every push and pull request as four
parallel jobs: ruff check, `ruff format --check`, and pytest; then typecheck, vitest, and
`wrangler deploy --dry-run`; then the frontend's Vitest suite followed by its build (the job is still
named `Frontend (build)`, because branch protection requires that name); and `e2e`, which installs
Chromium and runs Playwright against `wrangler dev --local` on a freshly seeded local D1. The `e2e`
job uploads `finish-review-captures` on every run, pass or fail, and the Playwright report only on
failure; it is not yet a required check, so a red run reports without blocking a merge. It needs
**no secrets**.

Install the hooks once per clone:

```bash
uvx pre-commit install
uvx pre-commit run --all-files                            # run over everything
git config blame.ignoreRevsFile .git-blame-ignore-revs    # skip the formatting-only commit
```

The hooks are the fast gates only — whitespace, `ruff --fix`, `ruff-format`, and `tsc`. The full
suites belong in CI, because a hook slow enough to be annoying gets bypassed with `--no-verify`, and
CI cannot be. `api/src/data/` and `api/test/fixtures/` are excluded from every formatting hook: a
single byte there breaks the fixtures that pin the Python scorers to their TypeScript ports.

GitHub honours `.git-blame-ignore-revs` automatically; the `git config` line is what makes local
`git blame` skip the same commit.

## Troubleshooting

### PostGIS errors on local dev

If you see `Geometry` column errors, make sure you're running the PostGIS image, not plain PostgreSQL:

```bash
docker compose up -d db   # uses postgis/postgis:16-3.4
```

### vLLM out of memory

The Qwen 3B model in float32 needs ~20GB. If Docker kills the container:

```bash
# Check logs
docker compose logs vllm

# Increase Docker memory limit or reduce model context
# In docker-compose.yml, lower --max-model-len from 4096
```

### bcrypt errors

If you see `passlib` errors — this project uses `bcrypt` directly, not through `passlib`. Make sure you're on the latest deps:

```bash
uv sync --all-extras
```

### LLM JSON parsing errors

Both vLLM and Claude sometimes wrap JSON in markdown fences (` ```json ... ``` `). All LLM modules strip these with `_strip_fences()` before parsing. If you add a new LLM call, use the same pattern.

### SQLite test errors with UUID

Tests use SQLite in-memory. UUID columns are stored as strings in SQLite, so any code that compares UUIDs must convert strings to `uuid.UUID` objects first. See the `get_current_user` dependency for the pattern.

### Tests failing after auth changes

The test conftest creates real JWT tokens and User records. If auth behavior changes, update the fixtures in `tests/api/conftest.py`. The `auth_headers` fixture provides admin-level access; `viewer_headers` provides read-only access.

### Workers: `table users already exists` on a local migration

A local D1 created before the ADR-026 schema reconciliation has the old shape (`users.name`, no
`is_active`, `digital_presence` singular), and `wrangler d1 migrations apply` refuses it. Login then
401s on an undefined `is_active`. Delete `api/.wrangler/state/v3/d1` and re-apply.

### Workers: tests pass locally, fail in CI with an auth error

`api/vitest.config.ts` sets `remoteBindings: false`. Without it the pool opens a remote proxy session
for the declared `ai` binding, which succeeds locally off a cached `wrangler login` token and fails in
CI with an authentication error that looks nothing like a test failure. If you add a binding that has
a remote counterpart, keep that flag in mind.

### Workers: a discovery run that reads as clean but measured nothing

Google answers a denied key, an exhausted quota, and a malformed request with **HTTP 200** plus a
`status` field, so nothing throws and the payload merely lacks its results key. Check the `places`
object in the route's response, not the exit status: it tallies lookups that failed for a
configuration or quota reason, separately from businesses Google genuinely has no record of. A
business whose lookup failed is stored with a **null** `digital_deficit_score` — deliberately, rather
than with Python's constant 74 — and every later run then skips it at the pre-lookup dedup. Recovery
is to delete those `businesses` rows and re-run; all five child tables cascade (`digital_presences`,
`lead_scores`, `outreach_records`, `grant_applications` and `google_matches`), and `grant_documents`
cascades beneath `grant_applications`. `SELECT business_id FROM google_matches WHERE status = 'unavailable'`
finds the unmeasured rows (on the remote only once migration 0005 is applied there).

Since CRM wave 1, the response also answers `created` (equal to `discovered`), `skipped_known`
(licences already stored, skipped before any Places call), and `failed`, so those no longer have to
be inferred from `places` alone. Each business's Google verdict survives the run in `google_matches`
(ADR 031) — but only once migration 0005 has reached the target D1, which as of this writing is true
for the throwaway databases the test suites create and not yet for the remote:

```bash
npx wrangler d1 execute leadforge-db --remote --command "SELECT status, count(*) AS n FROM google_matches GROUP BY status"
```

### Workers: the Overture backfill returns `{examined: 0, updated: 0, skipped: 0}`

That is the correct answer when no stored business has a match row, and also when the only candidates
are businesses whose latest score carries the deliberate NULL from an incomplete Places lookup. Those
are excluded on purpose: their stored `has_google_business_profile = 0` means *unknown*, so scoring
them would charge points on no evidence and overwrite the marker recording that they were never
measured. They need Google first, not Overture.

### Workers: `{"detail": "JWT_SECRET not configured"}` with a 500

The secret is unset on the deployed Worker. `npx wrangler secret put JWT_SECRET`, then deploy. Auth
routes and middleware both fail closed rather than falling back to a default.

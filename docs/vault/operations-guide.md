# LeadForge Operations Guide

Internal reference for team setup, daily operations, and troubleshooting.

## Environment Variables

Copy `.env.example` to `.env` and fill in all values. Here's what each one does:

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

## Database

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

## User Management

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

## Running Locally

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

The Vite dev server proxies `/api` requests to `http://localhost:8000`. See `frontend/vite.config.ts`.

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

## CLI Commands

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

Valid niches: `barbershops`, `bars`, `nail_salons`, `auto_repair`, `restaurants`, `laundromats`

## Deployment Notes

### JWT secret rotation

1. Generate a new secret: `openssl rand -hex 32`
2. Update `JWT_SECRET_KEY` in `.env`
3. Restart the API server
4. All existing tokens (access + refresh) are immediately invalid — everyone must re-login

### CORS for production

Update `CORS_ORIGINS` in `.env` to your actual frontend domain:

```
CORS_ORIGINS=["https://crm.yourdomain.com"]
```

### Cookie settings for production

The refresh token cookie is set with `secure=True` and `samesite=lax`. This requires HTTPS in production. If running behind a reverse proxy, ensure `X-Forwarded-Proto: https` is set.

### Anthropic (Azure Foundry) gotchas

- Endpoint format: `https://{resource}.cognitiveservices.azure.com/anthropic/`
- Auth header is `x-api-key` (NOT the standard Azure `api-key` header)
- The Anthropic SDK's `base_url` should NOT include `/v1/` — the SDK adds it

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

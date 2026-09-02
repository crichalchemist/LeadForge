# Workers API Contract Reconciliation

**Date:** 2026-09-02
**Status:** Accepted
**Supersedes:** the D1 schema and route contracts pasted into `2026-05-13-leadforge-cloudflare-migration.md` tasks 1.2, 1.3, 1.5, 1.6, 1.7, 2.1, 2.2

## Problem

The Workers routes ported on 2026-05-13 implement a schema and HTTP contract that the migration plan's author invented. They match neither the Python API (`src/leadforge/api`) nor the React frontend (`frontend/src/api/client.ts`, `frontend/src/types/index.ts`), which was built against the Python API and is backed by ADRs 018 and 020 through 025.

Concretely, against Workers today the frontend would fail on: ranked leads, score history, the pipeline board and stage transitions, outreach history and transcripts, the grant board, grant stage transitions, grant documents, grant financials, and pagination shape everywhere. The pipeline stage vocabulary (7 invented stages) and grant stage vocabulary (10 invented stages) do not match the 12 outreach stages and 13 NOF stages the product defines.

## Decision

The Python API is the behavioral contract. The Workers API is re-ported to it. The frontend is not changed.

Source of truth, in order of precedence when they disagree:

1. `frontend/src/api/client.ts` and `frontend/src/types/index.ts` (what the consumer actually calls and reads)
2. `src/leadforge/api/routes/*.py` and `src/leadforge/api/schemas/*.py` (paths, query params, status codes, response shapes, transition rules)
3. `src/leadforge/db/models/*.py` (table and column definitions, enums, defaults)
4. `tests/api/test_*.py` (acceptance behavior; ported to vitest as the Workers test suite)

## D1 schema

One table per SQLAlchemy model, same table and column names, plus the two pre-computed corridor columns from the original migration design. Mapping rules:

| SQLAlchemy | D1 |
|---|---|
| UUID primary key | `TEXT PRIMARY KEY`, value from `crypto.randomUUID()` |
| `Boolean` | `INTEGER NOT NULL DEFAULT 0`, serialized to JSON `true`/`false` by the API |
| `DateTime(timezone=True)` | `TEXT` ISO-8601 UTC with `Z`, default `(strftime('%Y-%m-%dT%H:%M:%SZ','now'))` |
| `Date` | `TEXT` `YYYY-MM-DD` |
| `Enum` | `TEXT` with a `CHECK (col IN (...))` listing the Python enum values |
| `Geometry(POINT)` on businesses | `latitude REAL`, `longitude REAL`, `in_nof_corridor INTEGER`, `nof_corridor_name TEXT` |
| `Geometry(MULTILINESTRING)` on nof_corridors | dropped; corridor membership is pre-computed |
| `UniqueConstraint(business_id, score_version)` | same; lead scores are versioned history, latest is `MAX(score_version)` |

Dropped from the current Workers schema: `pipeline_items` (pipeline state lives on `outreach_records.status`), `scoring_weights` (unused). `digital_presence` is renamed `digital_presences` to match the model.

Schema ships as `api/migrations/0001_initial.sql` and is applied with `wrangler d1 migrations apply`. The old `api/src/db/schema.sql` is removed. The remote `leadforge-db` predates this migration and was created from the old `schema.sql`; drop its tables or recreate the database before the first remote apply.

## HTTP contract

Every route mounts under `/api`. Paths, query parameters, status codes and JSON shapes match the Python routes exactly. Pagination is `{ items, total, page, page_size }`. Exception: `GET /grants` returns a bare array, as the Python route does. Errors are `{ detail: string }` with FastAPI's status codes (401 unauthenticated, 403 non-admin on writes, 404 missing, 400 invalid enum value, 422 invalid stage transition or validation failure).

Endpoints removed because neither Python nor the frontend has them: `POST /businesses`, `DELETE /businesses/:id`, `GET /leads`, `GET /leads/:id`, `POST /leads/calculate/:businessId`, `DELETE /leads/:id`, `GET /pipeline`, `GET /pipeline/:id`, `POST /pipeline`, `PATCH /pipeline/:id`, `DELETE /pipeline/:id`, `GET /outreach`, `POST /outreach`, `GET /grants/board/summary`, `POST /grants/financial-calculator`, `POST /grants/:id/documents`, `GET /reports/corridor`.

## Deliberate deviations from Python

- **Password hashing** is PBKDF2-SHA256 via Web Crypto, stored as `pbkdf2$<iterations>$<salt_b64>$<hash_b64>`. bcrypt is unavailable on Workers without a dependency, and no Python user rows are migrated, so the two formats never meet.
- **JWT** payload is `{ sub, role, type, iat, exp }` with `type` in `access` | `refresh`, matching Python. HS256 via Web Crypto. `email` is no longer in the payload.
- **Auth middleware** verifies the token, requires `type === 'access'`, and loads the user row to check `is_active`, as Python's `get_current_user` does.
- **`POST /auth/signup`** is kept as the only way to create users on Workers (Python uses a CLI). It requires an admin token and accepts `role`. The first admin is inserted with `wrangler d1 execute` using a hash from `api/scripts/hash-password.mjs`.
- **Retell webhook** lives at `/api/webhooks/retell/call-complete` and `/api/webhooks/retell/call-event`. Signature is HMAC-SHA256 hex over the raw body keyed by the `RETELL_API_KEY` secret, as in Python. The `RETELL_WEBHOOK_SECRET` var is removed. After a `call_ended` with a transcript, the handler enqueues `{ outreach_id }` on `SENTIMENT_QUEUE` in place of the Celery task. As in Python, verification is skipped when the `x-retell-signature` header is absent; this is an inherited weakness, pinned by a test, to be tightened once Retell's header behavior is confirmed in production.
- **`lib/scoring.ts`** is left in place but unreferenced. Its formulas diverge from `src/leadforge/scoring/` and are re-ported in the Phase 3 scoring task, not here.

## Testing

`@cloudflare/vitest-pool-workers` runs each spec inside workerd with an isolated local D1. The migrations directory is applied before each test file. Every test in `tests/api/test_*.py` is ported one-to-one to `api/test/<route>.test.ts`, keeping the Python test names so coverage can be diffed.

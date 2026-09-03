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

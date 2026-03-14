# ADR Vault

This directory contains Architecture Decision Records (ADRs) for LeadForge.

## Naming Convention

ADRs follow the format: `NNN-short-title.md`
- `NNN`: Zero-padded 3-digit number (e.g., 001, 002, 015)
- `short-title`: Kebab-case title describing the decision

## Status Values

- **Proposed**: Under review, not yet approved
- **Accepted**: Approved and active
- **Superseded**: Replaced by a newer ADR (link to successor)
- **Deprecated**: No longer relevant but kept for historical context

## Phase Block Reservations

To maintain organization across the 4-phase build:

- **Phase 1 (Data Pipeline MVP)**: 001-006
- **Phase 2 (Full Scoring + Platform Scrapers)**: 007-010
- **Phase 3 (LLM Integration + Voice Outreach)**: 011-014
- **Phase 4 (CRM + Dashboard)**: 015-018

## ADR Index

| # | Title | Status | Date |
|---|-------|--------|------|
| 001 | Project scaffolding: uv + hatchling, src layout, Docker Compose | Accepted | 2026-03-14 |
| 002 | ORM and migration: SQLAlchemy 2.0 async + asyncpg, Alembic, UUID PKs | Accepted | 2026-03-14 |
| 003 | Scraping library: Scrapling for static+headless, Apify for Meta only | Accepted | 2026-03-14 |
| 004 | Entity deduplication: google_place_id primary, fuzzy name+address fallback | Accepted | 2026-03-14 |
| 005 | API cost management: Google Places field masks, Socrata pagination | Accepted | 2026-03-14 |
| 006 | Niche-to-Socrata mapping: configurable dict, not hardcoded | Accepted | 2026-03-14 |
| 007 | Scraper resilience: independent scrapers, failures logged not fatal, Celery retry | Accepted | 2026-03-14 |
| 008 | vLLM model selection: based on VRAM, Qwen2.5-7B default | Accepted | 2026-03-14 |
| 009 | Nextdoor cookie management: Redis-backed store with TTL, dedicated account | Accepted | 2026-03-14 |
| 010 | Rate limiting: per-source limits in config, asyncio.Semaphore + httpx transport | Accepted | 2026-03-14 |
| 011 | LLM task routing: vLLM for volume, Claude for nuance | Accepted | 2026-03-14 |
| 012 | TCPA compliance: business lines only, one concurrent call, flag mobiles | Accepted | 2026-03-14 |
| 013 | Retell integration: webhook-driven async, idempotent handlers | Accepted | 2026-03-14 |
| 014 | Sentiment feedback: multiplicative on composite, one adjustment per call, capped at 100 | Accepted | 2026-03-14 |
| 015 | Frontend stack: React + Vite + Tailwind, React Query for server state, @dnd-kit for DnD | Accepted | 2026-03-14 |
| 016 | API auth: API key for MVP, upgrade path to OAuth2/OIDC | Accepted | 2026-03-14 |
| 017 | Recalibration: 90-day full re-enrichment, score versioning for audit trail | Accepted | 2026-03-14 |
| 018 | Pipeline transitions: valid transition enforcement in backend, optimistic updates in frontend | Accepted | 2026-03-14 |

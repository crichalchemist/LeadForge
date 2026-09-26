# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

LeadForge discovers under-digitized Chicago small businesses from public data, scores them, generates LLM outreach briefs, and runs AI voice calls (Retell). A React CRM tracks outreach and a parallel NOF grant pipeline.

**Two backends coexist.** The Cloudflare port was developed on `refactor/cf-migration` and MERGED into
the default branch on 2026-09-26, which was renamed `master` -> `main` at the same time (GitHub keeps a
redirect for the old name, so stale clones still fetch). Both backends now live on `main`:

| | Legacy (reference implementation) | Target (in progress) |
|---|---|---|
| Location | `src/leadforge/` | `api/` |
| Stack | FastAPI, SQLAlchemy 2 async, PostgreSQL+PostGIS, Celery+Redis, vLLM + Claude (Azure Foundry) | Hono, Zod, D1 (SQLite), Queues, Cron Triggers, Workers AI, KV |
| Tests | `tests/` (pytest, 158 tests) | `api/test/` (vitest on `@cloudflare/vitest-plugin`, 601 tests across 23 files, mirroring `tests/api/` and `tests/unit/`) |

The Python code is the behavioral spec. When porting a route, read the matching module under `src/leadforge/api/routes/` and its tests first, and reproduce stage transitions, scoring math, and auth rules exactly. Design and task-by-task plan: `docs/superpowers/specs/2026-05-13-leadforge-cloudflare-migration-design.md` and `docs/superpowers/plans/2026-05-13-leadforge-cloudflare-migration.md`.

Migration status as of 2026-09-26: the Workers API is re-ported to the Python contract (ADR-026, spec `docs/superpowers/specs/2026-09-02-workers-contract-reconciliation-design.md`) with a vitest suite under `api/test/` mirroring `tests/api/`, and the frontend is deployed to Pages at https://leadforge-frontend-80u.pages.dev (task 2.4, ADR-027). The Worker is deployed at https://leadforge-api.crichalchemist.workers.dev with the remote D1 migrated, both secrets set, and the first admin user inserted. The Workers AI client and prompt modules are ported under `api/src/lib/llm/` (task 3.1) with no HTTP routes. The sentiment queue consumer is live (task 3.2): `src/index.ts` exports `queue`, and `wrangler.jsonc` binds a consumer for `leadforge-sentiment` only. The scraper clients are ported under `api/src/scrapers/` with `lib/enrichment.ts` (task 3.3), again with no HTTP route and no queue consumer. The scoring functions are re-ported in `api/src/lib/scoring.ts` and pinned to Python by a differential suite (below). The discovery slice is built: `lib/discovery.ts` ports `pipeline/discovery.py` and `POST /api/discovery/run` triggers it. The pipeline has had its first live run (local D1, real Socrata, 2026-09-15): 50 licence rows in 60619 collapsed to 5 businesses, all geocoded by the city, all on an NOF corridor, each stored unmeasured because Places was unavailable. Google Places was replaced by Foursquare (ADR 029) and then restored as the source of record once its billing worked again (ADR 030, 2026-09-25): identity is now the city's licence account, enrichment is Google gated on name corroboration, and Foursquare is dropped. Migration 0003 IS applied to the remote D1 (verified 2026-09-25: `idx_businesses_licence_account` present, both identity columns on `businesses`), `GOOGLE_PLACES_API_KEY` is set as a Worker secret, and the first production discovery run HAS happened — 3 businesses, identity columns written, one corroborated match carrying a real rating, and a re-run correctly discovering 0. **The Overture slice (ADR 030 slice 2) shipped on 2026-09-26, code and production together.** The code: migration 0004 adds `overture_matches`, `scripts/build_overture_matches.py` builds it offline, `api/src/lib/overture.ts` merges it under a never-downgrade rule, `lib/discovery.ts` composes it at ingest, and `POST /api/enrichment/overture-backfill` improves businesses already stored. Production: migration 0004 applied remotely, all 95 chunks loaded (23,571 rows / 10,166 matched / 20,782 distinct accounts, matching the local build exactly), Worker deployed at version 1073b156, and the backfill run returning `{examined: 0, updated: 0, skipped: 0}` — the correct result, because all three businesses stored so far have `matched = 0`, so nothing was eligible. What has NOT happened is a discovery run under the composed pipeline, so no production business yet carries Overture-sourced signal. Remaining: that first composed discovery run, the scoring pipeline that adds viability/pressure once a competitive context exists, the enrichment/recalibration consumers and the crons, the voice port, and decommission.

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
npx wrangler d1 migrations apply leadforge-db            # local: wrangler 4 defaults to local
npx wrangler d1 migrations apply leadforge-db --remote   # production. --remote is the opt-in, NOT --local:
                                                         # dropping --local silently migrates miniflare instead
npx wrangler secret put JWT_SECRET
npx wrangler secret put RETELL_API_KEY   # HMAC key for the Retell webhook
npx wrangler secret put GOOGLE_PLACES_API_KEY  # discovery enrichment source (ADR 030); IS set
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
# ^ `--branch=master` is DELIBERATE and outlives the git rename to `main` (2026-09-26).
# Pages decides production-vs-preview by matching this value against the PROJECT's own production
# branch setting, which is independent of git and was fixed as `master` when the project was created.
# Passing `--branch=main` before changing that setting in the Pages dashboard would publish to a
# PREVIEW url instead of production, silently. Change the dashboard setting first, then this flag.
```

## Architecture notes that span files

**Route prefixes differ between backends.** The frontend axios client uses `baseURL: '/api'`. The Vite dev proxy forwards `/api/*` to `localhost:8000` and strips the `/api` prefix because FastAPI mounts routers at the root. The Workers app mounts everything under `/api/*`. The production build points at the Worker directly through `VITE_API_BASE_URL` in `frontend/.env.production` (ADR 027); in dev the value is unset and the proxy applies, so the prefix is stripped only for FastAPI.

**Auth.** Both backends issue HS256 JWTs with `sub`, `role` (`admin` | `viewer`), and `type` (`access` | `refresh`) in the payload — no `email`. Access tokens 60 min, refresh tokens 30 days in an HTTP-only cookie. On Workers the cookie is `SameSite=None; Secure` because the Pages frontend is cross-site (ADR 027), and the production `CORS_ORIGINS` var must list the Pages origin exactly. Public routes: health, login/refresh, and the Retell webhook. Every other route requires a token, and writes require `admin`. In Workers, `requireAuth` sets `user` on the Hono context and `requireAdmin` reads it, so `requireAdmin` must be chained after `requireAuth`. `JWT_SECRET` is required: auth routes and middleware return 500 `{ detail: 'JWT_SECRET not configured' }` when it is unset. Set it with `wrangler secret put JWT_SECRET` before deploying.

D1 queries are inline in each route. Table names, column lists and ORDER BY fragments are literals from code; every value from a request goes through `.bind()`. The `LATEST_SCORE_JOIN` and `LATEST_OUTREACH_JOIN` fragments in `routes/businesses.ts` pick the current score and stage per business; `lib/sentiment-feedback.ts` applies the same `score_version DESC` rule when it adjusts the latest score.

**No spatial queries on D1.** NOF corridor membership is decided at ingest by `lib/corridors.ts`, which bundles the City's two ArcGIS corridor polygon layers as `api/src/data/nof-corridors.json` and runs point-in-polygon (ADR 028, superseding 021). Regenerate with `uv run python scripts/fetch_nof_corridors.py`; the asset is a snapshot, so refreshing means re-running that and deploying. Python's approach is dead, not merely unported: it buffered street centre-lines by 50 m from a Socrata dataset that now 404s under both documented ids, and its only writer was the one-off `scripts/precompute_corridors.py`. The layers carry no name attribute, so `nof_corridor_name` is a synthesised `Priority corridor <FID>` label.

**Scoring.** Composite = 0.40 digital deficit + 0.35 viability + 0.25 competitive pressure, capped at 100, plus a price tier (1 to 3) derived from revenue, headcount, and pressure. Both are pure functions: `src/leadforge/scoring/` and `api/src/lib/scoring.ts`. The Workers port is pinned to Python by `api/test/scoring-parity.test.ts`, which replays 150 random inputs scored by the Python package (`api/test/fixtures/scoring-vectors.json`, regenerate with `uv run python scripts/gen_scoring_vectors.py`); Python's own unit tests assert mostly with `>=` and would pass for a drifted formula, so change a weight and expect that suite to fail. `lib/discovery.ts` is the first caller: it stores a version-1 row whose composite is the deficit alone, as Python's Phase 1 does. Scores are versioned rows in `lead_scores`, never overwritten. Post-call sentiment adjusts the composite multiplicatively, once per call (ADR 014).

**Pipeline stages.** Outreach stages and the allowed transitions live in `VALID_TRANSITIONS` in `src/leadforge/api/routes/pipeline.py`. The grant pipeline has 13 stages on `GrantApplication` and is a separate track from outreach (ADR 023). Backends reject invalid transitions; the frontend does optimistic updates.

**Retell webhook** verifies the `X-Retell-Signature` HMAC against the raw request body, not the parsed JSON. Handlers are idempotent on `call_id`.

**Python test fixtures.** API tests run on in-memory aiosqlite. `tests/api/conftest.py` swaps GeoAlchemy2 `Geometry` columns to `String` and registers stub spatial functions, so any new model with a geometry column must survive that shim. `settings = Settings()` is evaluated at import time in `leadforge/config.py`, so conftests set env vars before importing anything from `leadforge`. Scoring unit tests pass `MagicMock(spec=DigitalPresence)` objects rather than DB rows.

**LLM routing.** In Python, vLLM handles high-volume batch tasks (entity resolution, GBP assessment) and Claude handles outreach briefs and sentiment (ADR 011). On Workers the same split is `fastClient` and `qualityClient` in `api/src/lib/llm/client.ts`, both on Workers AI; the prompt modules beside it (`entity-resolution`, `outreach-brief`, `sentiment`) port their Python namesakes and take a client argument so tests inject a fake. Python's website extraction, revenue estimate, and GBP assessment have no callers and were not ported. All LLM outputs are parsed from JSON with fence stripping, and every function returns a documented fallback instead of throwing when the model fails.

**Celery to Queues.** Five task modules under `src/leadforge/tasks/` map onto the four queues declared in `api/wrangler.jsonc`; consumers live in the same Worker as the HTTP app, under `api/src/tasks/`, and are dispatched by queue name from the `queue` export in `src/index.ts`. Only `leadforge-sentiment` has a consumer bound: `tasks/sentiment.ts` ports `process_sentiment_task` and `lib/sentiment-feedback.ts` ports `pipeline/sentiment_feedback.py`, with the Celery retry policy (2 retries, 60 s) set on the consumer in `wrangler.jsonc`. Per-message `ack`/`retry` mirrors `task_acks_late`; a malformed body is acked and logged rather than retried. The other three queues have producers bound but no consumer until the scraper, voice, and scoring ports land. Python's two beat entries (quarterly recalibration, weekly corridor refresh) have no portable body yet, so `triggers.crons` is an empty list; add each cron together with its handler.

**Scrapers.** `api/src/scrapers/` ports `src/leadforge/scrapers/`, one file per Python module; `base.ts` is what survives of `BaseAPIClient` once `fetch` is global (per-source timeout, `raise_for_status`, the shared LD+JSON and form-encoding helpers). Every credential is an optional `Bindings` field set with `wrangler secret put`, and a client whose key is unset logs and returns its empty result exactly as Python does. Google Places URL signing is HMAC-SHA1 through WebCrypto, pinned in `api/test/scrapers.test.ts` to a known-answer vector generated from Python's `_sign_url` — Google rejects a signature that differs by so much as its base64 padding. `lib/enrichment.ts` ports `pipeline/enrichment.py` and has no caller yet: `enrich_business_task` has no producer in Python either, and `recalibration_tasks.py` calls `enrich_business` inline, so the caller arrives with the scoring re-port. `pipeline/discovery.py` IS ported now, as `lib/discovery.ts` — it was blocked on the digital deficit score, which arrived with the scoring re-port (see **Discovery** below); `scrapers/dfpr.py` and `scrapers/il_sos.py` have no Python caller and need Browser Rendering.

**Discovery.** `lib/discovery.ts` ports `pipeline/discovery.py`: Socrata search, licence-row dedup, dedup on the licence account, Google Places enrichment gated on name corroboration (ADR 030), an overlay of the precomputed Overture match via `applyOvertureMatch`/`fetchOvertureMatch` in `lib/overture.ts` (ADR 030 slice 2) — which is why the version-1 score already reflects both sources and needs no second write — then one D1 batch per business writing `businesses`, `digital_presences` and a version-1 `lead_scores` row. Socrata returns one row per licence renewal — a single shop can hold dozens — so `dedupeLicenseRows` collapses them on the city's `account_number`/`site_number` and keeps the newest licence before any paid lookup runs; `limit` therefore counts businesses, and the pipeline over-fetches rows by `LICENSE_OVERFETCH` to fill it. Measured on the live data, a barbershop/salon query averages 3.0 licence rows per business, so `LICENSE_OVERFETCH = 10` is headroom rather than a fit. Every Socrata value arrives as text, coordinates included. The city geocodes 92% of licence rows, so `latitude`/`longitude` come from Socrata and Places only fills gaps — Python extracts neither. Python has no HTTP route for this — it runs from the Typer CLI — so `POST /api/discovery/run` is the Workers stand-in, admin-only and called by nothing in the frontend. Discovery does not set `in_nof_corridor` — neither does Python, which precomputed it in a script.

**Identity is the licence account, not a place id** (ADR 030, migration 0003). `businesses.account_number` + `site_number` carry a UNIQUE index and are the dedup key; `google_place_id` and `fsq_place_id` are enrichment attributes. This closes a trap that followed every source choice: dedup on a source id wrote NULL for every business whose lookup missed, NULLs stay distinct in a UNIQUE index, so the next run stored the business again and nothing backfilled the first copy (`lib/enrichment.ts` still has no caller). Because the key arrives with the Socrata row, **dedup runs before anything billable** — a re-run of a stored business costs zero Places calls. Rows written before 0003 carry neither column, so they do not collide and are rediscovered once under the new key.

**The bad-key hazard changed shape rather than going away, so the key must still work before this route is pointed at production.** A run with no key, or one that trips the 1,000/day Places quota partway through, stores businesses with a null `digital_deficit_score`. Every later run then skips exactly those rows at the pre-lookup dedup, before any Places call, and nothing ever enriches them because `lib/enrichment.ts` has no caller. The failure is now silent non-enrichment instead of duplicate rows. What genuinely improved is recovery: deleting the affected `businesses` rows and re-running is clean, because all four child tables (`digital_presences`, `lead_scores`, and the two outreach/grant tables) are `ON DELETE CASCADE`, and the re-insert no longer collides the way a NULL-keyed row did. Note also that the quota's failure mode is unverified: a capped quota answering HTTP 200 with `OVER_QUERY_LIMIT` stores rows unmeasured and tallies into `PlacesHealth`, but a real HTTP 429 would make `base.ts`'s `fetchJson` throw, drop the business through `runDiscovery`'s per-business catch, and leave `places.unavailable` at 0 — a run that reads as clean. Check `places` in the response after the first small run.

**Corroboration happens before the Details call.** Google returns the nearest candidate whatever its name, so `lib/name-match.ts` scores the Find Place `name` against the licence name and `distanceMeters` applies a 200 m cut — `locationbias` is a bias, not a filter, so Google answers outside the circle rather than returning nothing. Details, the dearer SKU, is called only for a corroborated match: 77 of 102 in-radius candidates, measured. A false match is worse than no match — it flips the deficit's 30-point website term on another business's evidence. The scorer's IDF weights are precomputed by `scripts/gen_name_idf.py` into the bundled `api/src/data/name-idf.json` (412 KiB; the Worker gzips to 308 KiB) and the port is pinned by `api/test/name-match.test.ts`. `limit` is capped at 20 because each business costs up to two Places subrequests on top of the Socrata page against a 50-subrequest invocation budget, so the worst case is 41.

**`GOOGLE_PLACES_API_KEY` is required for the output to mean anything**: without it `findPlace` returns null and every business is stored unmeasured. Google answers a denied key, an exhausted quota and a malformed request with HTTP 200 plus a `status` field, so nothing throws and the payload merely lacks its results key — `placesUnavailable` checks `status` and tallies into a per-run `PlacesHealth` that the route returns as `places`, so a run that looked nothing up cannot read as a clean one. `ZERO_RESULTS` is a genuine no-match and scores as a measurement. Google rates 0.0–5.0 natively, so unlike Foursquare nothing is halved at ingest. `has_google_business_profile` means "the source returned a record", not that an owner-managed profile exists. **A business whose lookup failed is stored with a null `digital_deficit_score` and null composite, not with the 74.** Python writes the 74; Workers diverges deliberately, because 74 is the same constant for every unlooked-up business on earth — it would rank nothing while occupying 40% of the composite, and it clears `computeNofEligibility`'s `digital_deficit_score > 60` property-need bonus on no evidence (that scorer's `?? 0` already treats null as absent). **Google reports no social presence**, so `has_facebook_page`/`has_instagram` are 0 and every business pays `computeDigitalDeficit`'s +12 — a uniform constant, so ranking is unaffected, but absolute deficits are inflated by 12 and can trip that same `> 60` bonus. Overture now supplies those flags (ADR 030 slice 2): a matched business stores a real 1, and across the
city-wide build 6,864 of 10,166 matched businesses carry a social link. A stored 0 is therefore
ambiguous in a narrow way worth knowing: it means EITHER Overture matched and found no link, a real
measurement, OR there is no match row and nothing is known. The columns are `INTEGER NOT NULL DEFAULT 0`
per ADR 026 so they cannot say "unknown", and the scorer tests falsiness, so both cases pay the +12.
That residual is deliberate; making the columns nullable would fork the schema from Python for no gain.

**Overture composition (ADR 030 slice 2).** Overture is a DuckDB query over Parquet on S3, so it cannot
run in a Worker and is never queried live. `scripts/build_overture_matches.py` matches every licensed
Chicago business against it offline and emits SQL chunks that load into the `overture_matches` table
(migration 0004). Mirroring the POIs instead was ruled out by measurement, not taste: Chicago holds
**214,735** named Overture places against a D1 Free budget of 100,000 row writes/day, so one load would
burn three full days and so would every refresh. Matches are ~23.5k rows instead, about a quarter of one
day. Run it from the REPO ROOT — `load_idf()` defaults to the relative path `api/src/data/name-idf.json`.

Rebuilds are **wholesale**: the first chunk truncates, so no row outlives a rebuild and nothing depends on
Overture's GERS ids being stable across releases. A partial load can therefore only produce *missing* data,
never wrong data, because an absent row means "not yet covered" and both consumers handle that. Recovery is
always to restart from chunk 000; resuming midway is not safe. Do not run discovery while the table is
truncated — dedup runs before enrichment, so a business discovered in that window is never revisited and can
only be repaired by the backfill. A licence the city never geocoded gets **no row** rather than
`matched = 0`, because the build could not look at it, which is not the same as looking and finding nothing.

`api/src/lib/overture.ts` is the single merge point, deliberately: `applyOvertureMatch` implements the
never-downgrade rule (a true value never becomes false; Google's live value outranks Overture's month-old
one) and both writers call it — `lib/discovery.ts` at ingest and `POST /api/enrichment/overture-backfill`
for businesses already stored. Measured yield across the city: 7,640 websites and 6,864 social links that
Google alone does not see. Overture's social data is essentially Facebook-only (**127,259** Facebook links
against **960** Instagram), which is harmless because the deficit's social term is a single combined
`if (!has_facebook_page && !has_instagram) score += 12`.

Two things about that route are load-bearing and non-obvious. **It excludes businesses whose latest score is
the deliberate NULL** from an incomplete Places lookup: their stored `has_google_business_profile = 0` means
*unknown*, so scoring them would charge +15 on no evidence and overwrite the very marker that records they
were never measured. They need Google first, not Overture. And **`MAX_LIMIT` is 15** because each candidate
costs a 3-statement `DB.batch` plus the one candidate SELECT; the route is idempotent, so a small limit just
means calling it again. Blank values are normalised to NULL by the BUILD, not only by the readers, because
SQLite's `TRIM` and JavaScript's `.trim()` strip different character sets and chasing that equivalence in two
languages is how the copies drift.

The bundled corridor polygons were checked against live licence coordinates and discriminate as NOF does: 60619 76% on-corridor and 60620 85% (South Side, most of the priority hits), against 0% in both 60614 and 60611.

Test helpers in `api/test/helpers.ts` bind fixed column lists: `createBusiness` silently drops overrides outside its list (`google_place_id` and `fsq_place_id` among them), so a test that needs another column must insert the row itself.

## Agent tooling

**Serena (`mcp__plugin_serena_serena__*`) is the right tool for symbol-level work, not grep.** It is
LSP-backed, so it answers "who calls this", "what is this symbol's body", and "what does this file
export" across both backends without reading whole files into context — which matters here, where a
port is verified by comparing a TypeScript symbol against its Python namesake. The useful ones:
`find_symbol`, `find_referencing_symbols`, `find_implementations`, `get_symbols_overview`,
`search_for_pattern`, and for edits `replace_symbol_body` / `insert_after_symbol` /
`replace_in_files`. Reach for it before hand-rolling a `grep | sed` pass over `src/leadforge/` and
`api/src/`.

Two mechanics: call `initial_instructions` first (the server asks for it), and its tools are
**deferred** — load them with `ToolSearch` (`select:mcp__plugin_serena_serena__find_symbol,...`,
batched in one call) before calling, or they fail with `InputValidationError`.

If the tools are absent, that is a connection failure, not a missing capability — serena failed to
connect (`CONNECTION_CLOSED`) on 2026-09-25, and the fix is to restart or retry the server, not to
conclude it is unconfigured and fall back to grep silently.

## Docs conventions

- Architecture decisions are ADRs in `docs/vault/NNN-title.md`, indexed in `docs/vault/README.md` with reserved number blocks per phase. Record a new ADR when changing an architectural choice; supersede rather than edit accepted ones.
- Feature specs and implementation plans go under `docs/superpowers/specs/` and `docs/superpowers/plans/`, dated `YYYY-MM-DD-slug.md`.
- Operational env-var reference and troubleshooting: `docs/vault/operations-guide.md`.

## Data sources

**Google Places works again as of 2026-09-25**, correcting this file's previous "unavailable
indefinitely". Billing is enabled on project `leadforge-509800`, the legacy
`places-backend.googleapis.com` (the surface `api/src/scrapers/google-places.ts` actually calls)
enabled without refusal, and a key restricted to that one service returns `status: OK` on both
`findplacefromtext` and `details` with ratings included. `buildSignedUrl` signs only when
`GOOGLE_PLACES_API_SECRET` is set, so no Maps signing secret is needed. The key is set both as a Worker secret (for
`discovery.ts`, which calls Google and no longer calls Foursquare — ADR 030) and in the gitignored
`.env` (for the offline measurement scripts); it is never in `api/.dev.vars`, which is tracked. Google is the only measured source carrying `rating` and `user_ratings_total`.
Each business costs **two** calls (Find Place then Details), and Details requesting
`rating`/`reviews` bills a dearer SKU than the Basic fields; per-SKU prices were not verified, so
check the console before pointing a run at it.

Measured alternatives, 2026-09-15 — OpenStreetMap via Nominatim matched 0 of 5 real 60619
businesses and Overpass failed on three mirrors across two sessions; Yelp Fusion's free tier has
ended (~$8/1,000 calls).

**Foursquare is NOT the enrichment source any more** — ADR 030 superseded ADR 029 and dropped it, and
`discovery.ts` no longer calls it. What follows is the measured record of that evaluation, kept because
the entitlement boundary explains why no free Foursquare key can restore ratings, and because
`fsq_place_id` survives as a dead column. `GET https://places-api.foursquare.com/places/search`,
`Authorization: Bearer <key>` — a **Service Key** from the Developer Console, not a legacy `fsq3…`
API key; v3 is sunset and returns 410, and an `fsq3` key on the new host 401s. Required header
`X-Places-Api-Version: 2025-06-17`.

**`SEARCH_FIELDS` is an entitlement boundary, not a preference.** Measured 2026-09-16 on a free
Service Key: `rating`, `stats`, `hours`, `price` and `popularity` return HTTP 429 with
`x-ratelimit-limit: 0` — an allowance the plan never had, not an exhausted quota — and they fail
the *whole request*, so adding one silently breaks every lookup. Entitled: `fsq_place_id`, `name`,
`location`, `latitude`, `longitude`, `website`, `tel`, `email`, `social_media`, `categories`.
No `stats` means no review count, which must be stored as **null, never 0** (see Discovery).
Rate limits observed: `x-ratelimit-burst-limit: 150` alongside `x-ratelimit-limit: 180000`; a
burst breach 429s everything until it refills, so lookups must be serial and paced (~1/s), not
concurrent.

**Measured coverage, all 157 licensed `hair service` businesses in 60619** (one lookup each, city
geocode + 200 m radius, `limit=1`): 140/157 matched *something* (89%), but only **~48% are
name-corroborated** — `limit=1` returns the nearest place whatever its name, so `ACHOTI SALON LLC`
matched a law firm whose website would be imported as the salon's. Among matches: website 33%,
phone 71%, Facebook/Instagram 10%. **A false match is worse than no match**: it flips the
deficit's 30-point website term on fabricated evidence. Untried and likely to beat any
string-similarity threshold: `limit=10` with a `fsq_category_ids` filter, and a radius tighter
than 200 m.

**Paginate Socrata with `$order` on a UNIQUE column, or it silently skips rows.** SoQL offset
paging without a total order has no stable page boundary, so rows shift between requests and pages
lose them without any error. Measured 2026-09-25 on `r5kz-chrr` across the 15 niches: unordered
offset paging collected 22,251 distinct `(account_number, site_number)` pairs where the true count is
**23,969** — 1,718 pairs, 7.2%, gone with a clean exit. `$order: ":id"` fixes it and is verified to
work on this dataset. Ordering by a non-unique column is not enough: ties at a page boundary are
orderable arbitrarily, which is why `searchBusinesses` in `api/src/scrapers/socrata.ts` should use
`:id` rather than its current `legal_name ASC` (latent, not live — see Known discrepancies).

Verified counts for this dataset and filter, useful as a regression anchor: **113,383** licence rows,
**23,969** distinct `(account_number, site_number)` pairs, **21,004** distinct `account_number`
values. A business holding several site numbers is why the last two differ; only 146 distinct
`site_number` values exist in the whole filtered set.

**Overture Maps is ADOPTED as the second enrichment source (ADR 030 slice 2, shipped 2026-09-26).**
Measured 2026-09-16, composed into the pipeline 2026-09-26. Mechanics below; what ships is a
precomputed match table, never a live query. Foursquare
donated its places data to Overture, whose release bucket is anonymously readable with no key, no
gate and no rate limit: `s3://overturemaps-us-west-2/release/<version>/theme=places/type=place/*`
(latest `2026-08-19.0`). Parquet with bbox row-group statistics, so a DuckDB query with a bounding
box pulls the whole south side in ~5 s. Carries `names`, `categories`, `websites`, `socials`,
`phones`, `emails`, `addresses`, `confidence`, `operating_status` — **but no rating and no review
count**, so no free path restores those and `computeViability`'s rating block stays dead whichever
source wins. Correction: this file previously said the bulk dataset "carries the denied fields";
that is false for Overture and unverified for `fsq-os-places`, which cannot be read to check.

Measured head-to-head on the same 157 licensed 60619 businesses with one name scorer
(`scripts/measure_overture_match.py`): the API matched 140 but only 57 survive name corroboration
(**83 false matches**), yielding 17 usable website and 4 usable social signals. Overture matched
**74, all corroborated**, yielding **55 website and 60 social** signals. Fewer matches, 3x the
usable website signal and 15x the social. Matching is an offline problem there, so experiments are
free instead of one API call each.

The two blockers that once stood in the way are both DISSOLVED, not worked around. Dedup no longer
needs any source id: migration 0003 made the city's licence account the identity, so the fact that
only 4 of 74 Overture matches carry a Foursquare id stopped mattering, and GERS id stability across
monthly releases stopped mattering with it — `overture_matches` is rebuilt wholesale, so no row
outlives a rebuild and nothing depends on an id meaning the same thing next month.

**Three-way head-to-head, 2026-09-25** — `scripts/fetch_places_candidates.mjs` then
`scripts/measure_places_sources.py`. One name scorer, one candidate corpus, one 200 m radius, the
same 157 licensed `hair service` businesses in 60619:

| source | returned | name-corroborated | false | website | phone | social | rating | reviews ≥5 |
|---|---|---|---|---|---|---|---|---|
| Google | 102 | **77** (49%) | 25 | 23 | 65 | — | **74** | **63** |
| Foursquare | 140 | 57 (36%) | **83** | 17 | 44 | 4 | 0 | 0 |
| Overture | 157 | 74 (47%) | n/a | **55** | 73 | **60** | 0 | 0 |

Overture's "returned" is 157 because every business has *some* POI within 200 m, and its matching
is exhaustive and offline, so it has no false-match count comparable to a single nearest API
result. Google's `locationbias` is a bias and not a filter, so the 200 m cut is applied at scoring
time from a recorded distance; unrestricted, Google returns 144 and corroborates 86 but at 58 false.

**Foursquare is dominated on every axis and carries no field the others lack**: fewer corroborated
matches than either (57), the most false matches by far (83), under a third of Overture's website
coverage, and no rating. It adds only 12 businesses over Google ∪ Overture. Unions:
Google ∪ Overture **93/157** (59%), all three 105 (67%). Overture covers 16 businesses Google
misses; Google covers 19 Overture misses; Google supplies a rating for 58 of Overture's 74.
Website coverage is Overture's strength and Google's weakness — 55 against 23, 40 of them
Overture-only — which matters because the website term is 30 of the deficit's points.

**Corroborate before the Details call.** Find Place already returns `name` and `geometry`, so
scoring the name and applying the 200 m cut before the second call takes Details from 102 to 77 —
about 234 calls per 157 businesses instead of the 307 this measurement paid — and means a false
match is never billed and never stored.

**There is one canonical Python scorer**, `scripts/lib/name_match.py`, which
`measure_places_sources.py` imports; `api/src/lib/name-match.ts` is its TypeScript port, pinned by
`api/test/fixtures/name-match-vectors.json`. `measure_overture_match.py` keeps its own older copy on
purpose, as the historical record of the run it made — so do not "fix" it into agreement. The two are
**not** behaviourally identical: they break a tied max-weight head token differently, and because
every token with `df = 1` scores exactly `log(N/1)`, singleton proper nouns tie by construction rather
than by accident. Measured 2026-09-25: 6 of the 157 names have a tied head token and the divergence
moved **zero** businesses in all three sources. That is a property of this corpus, not a guarantee —
`measure_places_sources.py`'s module docstring is the authoritative record of the divergence and of
how the check was reproduced, deliberately kept in one place so the two cannot drift apart again.
The table above reproduces the Overture-only run's 74 and the Foursquare run's 57-with-83-false
exactly.

That agreement took a bug fix worth remembering: **key businesses by the city's
`account_number`/`site_number`, never by name.** Five names among the 157 are held by two or three
different licence accounts, so a dict keyed by name silently merged 6 businesses and under-reported
*every* source at once (Overture read 71, Foursquare 56/84). An earlier commit here explained that
gap as a bbox/IDF difference; that was wrong. The script now asserts key uniqueness and asserts that
each fetcher's output is positionally aligned with the licence list.

The 12 lowest-scoring accepted Google pairs were hand-audited and all 12 read correct;
`REGINA AFRICAN IMPACT → Regina African Braiding` (6 m apart) is the one genuinely uncertain.

`hf://datasets/foursquare/fsq-os-places` (Apache-2.0) remains gated: `gated: auto`, token scoped
correctly (`canReadGatedRepos: true`), but the account is not on the authorized list and the access
form needs Organization, Title, Country and an intended-use declaration that only the owner can
give. Overture makes that gate moot. The AWS open-data bucket `fsq-os-places-us-east-1` still
exists but now holds only `LICENSE.txt` and `NOTICE.txt` — the data is gone from it.

## Known discrepancies

- `Dockerfile` CMD runs `leadforge.api.main:app`, but the app object is `leadforge.api.app:app`. The README and Makefile use the correct path.
- `call_attempts` is never incremented on Workers (the only Python writer, `voice/call_manager.py`, is unported), so the 0.90 no-answer multiplier in `lib/sentiment-feedback.ts` cannot fire in production until the voice port lands.
- `api/wrangler.jsonc` binds `ENRICHMENT_QUEUE`, `OUTREACH_QUEUE`, and `RECALIBRATION_QUEUE` producers that nothing sends to and no consumer reads. The sentiment consumer has no dead-letter queue, matching Celery, so a message that exhausts its retries is dropped with only the logged errors as a trace. `COOKIE_STORE` is bound but unused by any route.
- Yelp and Apify read their credentials with `getattr(settings, "YELP_API_KEY"/"APIFY_API_TOKEN", "")` and `Settings` declares neither field (`extra="ignore"`), so both clients are permanently disabled in Python. The Workers ports are gated the same way but the secrets are real: setting `APIFY_API_TOKEN` starts writing `has_meta_ads`, which feeds `digital_deficit` and `competitive_context` and would make Workers score differently from Python. `YELP_API_KEY` is safe — no scoring module reads the Yelp columns.
- Nothing in either backend ever persists Thumbtack, Nextdoor, Angi or Craigslist data: the Thumbtack parser always returns a null hire count, Nextdoor is never given cookies, and the other two are informational. `viability.py` still reads `thumbtack_hires` and `nextdoor_recommendations`, so those branches are dead.
- `scrapers/domain.ts` replaces Python's socket-and-TLS check with an HTTPS request, because Workers has no raw sockets. Only `has_ssl` is persisted, so the collapsed `dns_resolves` signal is not observable. Apify's actor-polling loop is ported but untested — it is unreachable without a token, and faking its 5-second sleeps under the workers pool is not worth the risk.
- The `nof_corridors` D1 table is unused: it has no geometry column and no route reads it. Corridor data lives in the bundled asset instead (ADR 028).
- Neither `scrapers/google_places.py` nor its Workers port originally inspected Google's `status` field, so a denied key was indistinguishable from a business Google has no record of. Workers now checks it; Python still does not, per the rule that Workers is the implementation of record for the never-run half. `scrapers/google-places.ts` is back in the pipeline (ADR 030); its HMAC-SHA1 known-answer vector remains the only pin on the signing code, which stays dormant because `buildSignedUrl` signs only when `GOOGLE_PLACES_API_SECRET` is set and it is not.
- Deficit scores from Workers still are not comparable with Python's, but for narrower reasons than before: both now enrich from Google Places with the same 0.0-5.0 rating scale, but Workers additionally overlays Overture, so its social flags carry real signal where Python's are hardcoded to 0, so the remaining divergences are that Workers stores a null deficit where Python writes the 74, and that Workers discards a candidate whose name does not corroborate the licence where Python accepts Google's nearest answer (ADR 030). `fsq_place_id` is now a dead column retained alongside its UNIQUE index; `google_place_id` is written again but as an enrichment attribute, not identity.
- `api/.dev.vars` is tracked in git with no `.gitignore` rule, while `.env` is ignored. It currently holds only `CORS_ORIGINS`, but it is the file wrangler reads for local secrets, so anything put there is staged by default. Pass throwaway local values with `wrangler dev --var KEY:value` instead.
- A local D1 created before the ADR-026 reconciliation has the old schema (`users.name`, no `is_active`, `digital_presence` singular) and `wrangler d1 migrations apply --local` refuses it with `table users already exists`, so login 401s on an undefined `is_active`. Delete `api/.wrangler/state/v3/d1` and re-apply.
- `searchBusinesses` in `api/src/scrapers/socrata.ts` pages with `$order: 'legal_name ASC'`, a
  non-unique column, so ties at a page boundary could skip or duplicate rows (see the Socrata note
  above; the correct order key is `:id`). **Latent, not live:** the only caller asks for at most
  `limit * LICENSE_OVERFETCH` = 200 rows, `searchBusinesses` shrinks `pageSize` to that, and it
  returns as soon as it has `limit` rows — so the multi-page path is currently unreachable and one
  page is always enough. It becomes a real bug the moment a caller requests more than
  `SOCRATA_PAGE_SIZE` rows.
- CI runs on every push and pull request (`.github/workflows/ci.yml`): three parallel jobs covering
  ruff + pytest (158), tsc + vitest + `wrangler deploy --dry-run` (601), and the frontend build. It needs
  **no secrets** -- but only after `remoteBindings: false` was set in `api/vitest.config.ts`. Without it
  the pool opens a remote proxy session for the `ai` binding, which succeeds locally off a cached
  `wrangler login` token and fails in CI with an auth error that looks nothing like a test failure.
  `main` requires all three checks (strict), with `enforce_admins` off so a direct push is still possible.
- **The tree is ruff-formatted, as of the dedicated commit listed in `.git-blame-ignore-revs`**, and both
  `ruff format --check` and the whitespace fixers are now enforced by pre-commit and by CI's `Format`
  step. That commit rewrote 76 files; trailing whitespace existed on exactly three lines of
  `.editorconfig` and one plan document lacked its final newline, so the earlier "136 and 6 files" note
  in this file was wrong -- it counted the working directory, not the tracked tree. Every one of the 76
  files was verified to parse to a byte-identical AST across the change, with both suites green.
  `api/src/data/` and `api/test/fixtures/` are excluded from all four formatting hooks, because a single
  byte there breaks the fixtures that pin the Python scorers to their TypeScript ports.
  Run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone; GitHub honours the file
  automatically. Measured, its local effect is nil on this particular commit: only 64 lines across the 76
  files end up credited to it at all, and those are blank lines ruff-format inserted, which git cannot
  reassign to any earlier commit. The file earns its place for the next formatting commit, not this one.
  Ruff's lint config: `line-length = 120` against a 97-char p99, `migrations` excluded as
  Alembic-generated, and style rules relaxed for `scripts/*.py` while the correctness rules stay on.
  `scripts/lib/` is NOT relaxed, because `name_match.py` is pinned to the TypeScript port by a fixture.
- `src/leadforge/voice/call_manager.py` builds an agent prompt and never passes it to the Retell call, so
  the agent would run without it. Found by ruff (F841) while wiring CI; marked with a `noqa` and a comment
  rather than deleted, since deleting the assignment would have hidden the defect. Belongs with the voice
  port, which is unported on Workers.
- ADR 008 and ADR 011 both discuss Qwen2.5-**7B**, but `.env.example` ships the **3B** instruct model,
  because the decision was to size by available VRAM and this runs on CPU. The config is right and the
  ADRs record the earlier sizing; `.env.example` is the source of truth. Not worth a new ADR.
- `README.md` states the licence as MIT, but the repo has **no `LICENSE` file**. Either the file is
  missing or the statement is wrong, and which one is the owner's call — do not resolve it by writing
  a licence file.
- There is no bootstrap command for the first Workers admin user. Python has
  `leadforge create-user`; on Workers the row has to be inserted into D1 by hand with a
  `pbkdf2$<iterations>$<salt>$<hash>` value, because bcrypt hashes from Python are not portable to the
  Workers runtime and `POST /api/auth/signup` needs an existing admin token. Recorded in the
  operations guide as a gap rather than papered over with a procedure nobody has run.

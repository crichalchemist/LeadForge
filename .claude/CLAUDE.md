# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

LeadForge discovers under-digitized Chicago small businesses from public data, scores them, generates LLM outreach briefs, and runs AI voice calls (Retell). A React CRM tracks outreach and a parallel NOF grant pipeline.

**Two backends coexist.** The `refactor/cf-migration` branch is porting the app from self-hosted Python to Cloudflare, route by route:

| | Legacy (reference implementation) | Target (in progress) |
|---|---|---|
| Location | `src/leadforge/` | `api/` |
| Stack | FastAPI, SQLAlchemy 2 async, PostgreSQL+PostGIS, Celery+Redis, vLLM + Claude (Azure Foundry) | Hono, Zod, D1 (SQLite), Queues, Cron Triggers, Workers AI, KV |
| Tests | `tests/` (pytest, 158 tests) | `api/test/` (vitest on `@cloudflare/vitest-plugin`, 438 tests mirroring `tests/api/` and `tests/unit/`) |

The Python code is the behavioral spec. When porting a route, read the matching module under `src/leadforge/api/routes/` and its tests first, and reproduce stage transitions, scoring math, and auth rules exactly. Design and task-by-task plan: `docs/superpowers/specs/2026-05-13-leadforge-cloudflare-migration-design.md` and `docs/superpowers/plans/2026-05-13-leadforge-cloudflare-migration.md`.

Migration status as of 2026-09-02: the Workers API is re-ported to the Python contract (ADR-026, spec `docs/superpowers/specs/2026-09-02-workers-contract-reconciliation-design.md`) with a vitest suite under `api/test/` mirroring `tests/api/`, and the frontend is deployed to Pages at https://leadforge-frontend-80u.pages.dev (task 2.4, ADR-027). The Worker is deployed at https://leadforge-api.crichalchemist.workers.dev with the remote D1 migrated, both secrets set, and the first admin user inserted. The Workers AI client and prompt modules are ported under `api/src/lib/llm/` (task 3.1) with no HTTP routes. The sentiment queue consumer is live (task 3.2): `src/index.ts` exports `queue`, and `wrangler.jsonc` binds a consumer for `leadforge-sentiment` only. The scraper clients are ported under `api/src/scrapers/` with `lib/enrichment.ts` (task 3.3), again with no HTTP route and no queue consumer. The scoring functions are re-ported in `api/src/lib/scoring.ts` and pinned to Python by a differential suite (below). The discovery slice is built: `lib/discovery.ts` ports `pipeline/discovery.py` and `POST /api/discovery/run` triggers it. The pipeline has had its first live run (local D1, real Socrata, 2026-09-15): 50 licence rows in 60619 collapsed to 5 businesses, all geocoded by the city, all on an NOF corridor, each stored unmeasured because Places was unavailable. Foursquare has since
replaced Google Places as the enrichment source (ADR 029) and is waiting on a key. Remaining: the first *production* run, the scoring pipeline that adds viability/pressure once a competitive context exists, the enrichment/recalibration consumers and the crons, the voice port, and decommission.

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
npx wrangler secret put FOURSQUARE_API_KEY  # discovery enrichment source (ADR 029)
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

D1 queries are inline in each route. Table names, column lists and ORDER BY fragments are literals from code; every value from a request goes through `.bind()`. The `LATEST_SCORE_JOIN` and `LATEST_OUTREACH_JOIN` fragments in `routes/businesses.ts` pick the current score and stage per business; `lib/sentiment-feedback.ts` applies the same `score_version DESC` rule when it adjusts the latest score.

**No spatial queries on D1.** NOF corridor membership is decided at ingest by `lib/corridors.ts`, which bundles the City's two ArcGIS corridor polygon layers as `api/src/data/nof-corridors.json` and runs point-in-polygon (ADR 028, superseding 021). Regenerate with `uv run python scripts/fetch_nof_corridors.py`; the asset is a snapshot, so refreshing means re-running that and deploying. Python's approach is dead, not merely unported: it buffered street centre-lines by 50 m from a Socrata dataset that now 404s under both documented ids, and its only writer was the one-off `scripts/precompute_corridors.py`. The layers carry no name attribute, so `nof_corridor_name` is a synthesised `Priority corridor <FID>` label.

**Scoring.** Composite = 0.40 digital deficit + 0.35 viability + 0.25 competitive pressure, capped at 100, plus a price tier (1 to 3) derived from revenue, headcount, and pressure. Both are pure functions: `src/leadforge/scoring/` and `api/src/lib/scoring.ts`. The Workers port is pinned to Python by `api/test/scoring-parity.test.ts`, which replays 150 random inputs scored by the Python package (`api/test/fixtures/scoring-vectors.json`, regenerate with `uv run python scripts/gen_scoring_vectors.py`); Python's own unit tests assert mostly with `>=` and would pass for a drifted formula, so change a weight and expect that suite to fail. `lib/discovery.ts` is the first caller: it stores a version-1 row whose composite is the deficit alone, as Python's Phase 1 does. Scores are versioned rows in `lead_scores`, never overwritten. Post-call sentiment adjusts the composite multiplicatively, once per call (ADR 014).

**Pipeline stages.** Outreach stages and the allowed transitions live in `VALID_TRANSITIONS` in `src/leadforge/api/routes/pipeline.py`. The grant pipeline has 13 stages on `GrantApplication` and is a separate track from outreach (ADR 023). Backends reject invalid transitions; the frontend does optimistic updates.

**Retell webhook** verifies the `X-Retell-Signature` HMAC against the raw request body, not the parsed JSON. Handlers are idempotent on `call_id`.

**Python test fixtures.** API tests run on in-memory aiosqlite. `tests/api/conftest.py` swaps GeoAlchemy2 `Geometry` columns to `String` and registers stub spatial functions, so any new model with a geometry column must survive that shim. `settings = Settings()` is evaluated at import time in `leadforge/config.py`, so conftests set env vars before importing anything from `leadforge`. Scoring unit tests pass `MagicMock(spec=DigitalPresence)` objects rather than DB rows.

**LLM routing.** In Python, vLLM handles high-volume batch tasks (entity resolution, GBP assessment) and Claude handles outreach briefs and sentiment (ADR 011). On Workers the same split is `fastClient` and `qualityClient` in `api/src/lib/llm/client.ts`, both on Workers AI; the prompt modules beside it (`entity-resolution`, `outreach-brief`, `sentiment`) port their Python namesakes and take a client argument so tests inject a fake. Python's website extraction, revenue estimate, and GBP assessment have no callers and were not ported. All LLM outputs are parsed from JSON with fence stripping, and every function returns a documented fallback instead of throwing when the model fails.

**Celery to Queues.** Five task modules under `src/leadforge/tasks/` map onto the four queues declared in `api/wrangler.jsonc`; consumers live in the same Worker as the HTTP app, under `api/src/tasks/`, and are dispatched by queue name from the `queue` export in `src/index.ts`. Only `leadforge-sentiment` has a consumer bound: `tasks/sentiment.ts` ports `process_sentiment_task` and `lib/sentiment-feedback.ts` ports `pipeline/sentiment_feedback.py`, with the Celery retry policy (2 retries, 60 s) set on the consumer in `wrangler.jsonc`. Per-message `ack`/`retry` mirrors `task_acks_late`; a malformed body is acked and logged rather than retried. The other three queues have producers bound but no consumer until the scraper, voice, and scoring ports land. Python's two beat entries (quarterly recalibration, weekly corridor refresh) have no portable body yet, so `triggers.crons` is an empty list; add each cron together with its handler.

**Scrapers.** `api/src/scrapers/` ports `src/leadforge/scrapers/`, one file per Python module; `base.ts` is what survives of `BaseAPIClient` once `fetch` is global (per-source timeout, `raise_for_status`, the shared LD+JSON and form-encoding helpers). Every credential is an optional `Bindings` field set with `wrangler secret put`, and a client whose key is unset logs and returns its empty result exactly as Python does. Google Places URL signing is HMAC-SHA1 through WebCrypto, pinned in `api/test/scrapers.test.ts` to a known-answer vector generated from Python's `_sign_url` — Google rejects a signature that differs by so much as its base64 padding. `lib/enrichment.ts` ports `pipeline/enrichment.py` and has no caller yet: `enrich_business_task` has no producer in Python either, and `recalibration_tasks.py` calls `enrich_business` inline, so the caller arrives with the scoring re-port. `pipeline/discovery.py` is unported because it computes a digital deficit score, which belongs to that same re-port; `scrapers/dfpr.py` and `scrapers/il_sos.py` have no Python caller and need Browser Rendering.

**Discovery.** `lib/discovery.ts` ports `pipeline/discovery.py`: Socrata search, licence-row dedup, Foursquare enrichment (ADR 029), dedup on `fsq_place_id` (falling back to name+zip when the lookup returns nothing), then one D1 batch per business writing `businesses`, `digital_presences` and a version-1 `lead_scores` row. Socrata returns one row per licence renewal — a single shop can hold dozens — so `dedupeLicenseRows` collapses them on the city's `account_number`/`site_number` and keeps the newest licence before any paid lookup runs; `limit` therefore counts businesses, and the pipeline over-fetches rows by `LICENSE_OVERFETCH` to fill it. Every Socrata value arrives as text, coordinates included. The city geocodes 92% of licence rows, so `latitude`/`longitude` come from Socrata and Places only fills gaps — Python extracts neither. Python has no HTTP route for this — it runs from the Typer CLI — so `POST /api/discovery/run` is the Workers stand-in, admin-only and called by nothing in the frontend. Its `limit` is capped at 20 because each business costs one Foursquare subrequest on top of the Socrata page and a Worker invocation gets 50 on the free plan — a search response carries the fields Google needed a second details call for, so the worst case is 21 rather than 41. That cap is still untested against a real quota: the one live run made zero enrichment subrequests. **`FOURSQUARE_API_KEY` is required for the output to mean anything**: without it `findPlace` returns null and every business is stored unmeasured. Foursquare fails with real HTTP status codes rather than Google's HTTP-200-plus-`status`, and `base.ts`'s `fetchJson` throws on any non-2xx — that throw would unwind past the health tally into `runDiscovery`'s per-business catch, dropping the business *and* reporting a clean run, so `scrapers/foursquare.ts` reads `response.status` itself and never calls `fetchJson`. 401/403 (`UNAUTHORIZED`), 429 (`RATE_LIMITED`), 5xx, 400 and transport failures each tally into a per-run `FoursquareHealth`; the route returns it as `places` so a run that looked nothing up cannot be read as a clean one. A 200 with an empty `results` array is a genuine no-match and scores as a measurement. Foursquare rates 0.0-10.0 where `google_avg_rating` is consumed as a Google 0.0-5.0 rating, so the client halves it at ingest — left raw, a mediocre 7.2 would clear `computeViability`'s `>= 4.0` top bonus for nearly every business. `social_media` makes `has_facebook_page`/`has_instagram` real signal, where the Google port hardcoded both to 0 and charged every business the same 12-point penalty. `has_google_business_profile` keeps the Google port's meaning — "the source returned a record", not that an owner-managed profile exists. **A business whose lookup failed is stored with a null `digital_deficit_score` and null composite, not with the 74.** Python writes the 74; Workers diverges deliberately, because 74 is the same constant for every unlooked-up business on earth — it would rank nothing while occupying 40% of the composite, and it clears `computeNofEligibility`'s `digital_deficit_score > 60` property-need bonus on no evidence (that scorer's `?? 0` already treats null as absent). Measured on the live data, a barbershop/salon query averages 3.0 licence rows per business, so `LICENSE_OVERFETCH = 10` is headroom rather than a fit. A run whose lookups fail writes rows with a null `fsq_place_id`, and the next run dedups on that column, so it matches nothing and stores the business a second time; nothing backfills the first copy, because `lib/enrichment.ts` has no caller. A discovery run with a dead key is therefore not reversible by re-running it, which is why the key must work before the route is pointed at production. Discovery does not set `in_nof_corridor` — neither does Python, which precomputed it in a script.

The bundled corridor polygons were checked against live licence coordinates and discriminate as NOF does: 60619 76% on-corridor and 60620 85% (South Side, most of the priority hits), against 0% in both 60614 and 60611.

Test helpers in `api/test/helpers.ts` bind fixed column lists: `createBusiness` silently drops overrides outside its list (`google_place_id` and `fsq_place_id` among them), so a test that needs another column must insert the row itself.

## Docs conventions

- Architecture decisions are ADRs in `docs/vault/NNN-title.md`, indexed in `docs/vault/README.md` with reserved number blocks per phase. Record a new ADR when changing an architectural choice; supersede rather than edit accepted ones.
- Feature specs and implementation plans go under `docs/superpowers/specs/` and `docs/superpowers/plans/`, dated `YYYY-MM-DD-slug.md`.
- Operational env-var reference and troubleshooting: `docs/vault/operations-guide.md`.

## Data sources

Google Places is unavailable indefinitely: the Cloud project's billing account is broken and
wants a prepayment the owner has not made. Measured alternatives, 2026-09-15 — OpenStreetMap via
Nominatim matched 0 of 5 real 60619 businesses and Overpass failed on three mirrors across two
sessions; Yelp Fusion's free tier has ended (~$8/1,000 calls).

Foursquare is the enrichment source (ADR 029). `GET https://places-api.foursquare.com/places/search`,
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

The bulk Open Source Places dataset (`hf://datasets/foursquare/fsq-os-places`, Apache-2.0) has no
entitlement tiering and carries the denied fields, which would make matching an offline problem.
As of 2026-09-16 it is still gated: the repo lists, but contents return `not in the authorized
list` for `crichalchemist`. Whether to switch to it is an open question (ADR 029 Correction).

## Known discrepancies

- `Dockerfile` CMD runs `leadforge.api.main:app`, but the app object is `leadforge.api.app:app`. The README and Makefile use the correct path.
- `call_attempts` is never incremented on Workers (the only Python writer, `voice/call_manager.py`, is unported), so the 0.90 no-answer multiplier in `lib/sentiment-feedback.ts` cannot fire in production until the voice port lands.
- `api/wrangler.jsonc` binds `ENRICHMENT_QUEUE`, `OUTREACH_QUEUE`, and `RECALIBRATION_QUEUE` producers that nothing sends to and no consumer reads. The sentiment consumer has no dead-letter queue, matching Celery, so a message that exhausts its retries is dropped with only the logged errors as a trace. `COOKIE_STORE` is bound but unused by any route.
- Yelp and Apify read their credentials with `getattr(settings, "YELP_API_KEY"/"APIFY_API_TOKEN", "")` and `Settings` declares neither field (`extra="ignore"`), so both clients are permanently disabled in Python. The Workers ports are gated the same way but the secrets are real: setting `APIFY_API_TOKEN` starts writing `has_meta_ads`, which feeds `digital_deficit` and `competitive_context` and would make Workers score differently from Python. `YELP_API_KEY` is safe — no scoring module reads the Yelp columns.
- Nothing in either backend ever persists Thumbtack, Nextdoor, Angi or Craigslist data: the Thumbtack parser always returns a null hire count, Nextdoor is never given cookies, and the other two are informational. `viability.py` still reads `thumbtack_hires` and `nextdoor_recommendations`, so those branches are dead.
- `scrapers/domain.ts` replaces Python's socket-and-TLS check with an HTTPS request, because Workers has no raw sockets. Only `has_ssl` is persisted, so the collapsed `dns_resolves` signal is not observable. Apify's actor-polling loop is ported but untested — it is unreachable without a token, and faking its 5-second sleeps under the workers pool is not worth the risk.
- The `nof_corridors` D1 table is unused: it has no geometry column and no route reads it. Corridor data lives in the bundled asset instead (ADR 028).
- Neither `scrapers/google_places.py` nor its Workers port originally inspected Google's `status` field, so a denied key was indistinguishable from a business Google has no record of. Workers now checks it; Python still does not, per the rule that Workers is the implementation of record for the never-run half. `scrapers/google-places.ts` is no longer in the pipeline at all (ADR 029) but stays tested — its HMAC-SHA1 known-answer vector is the only pin on that signing code.
- Deficit scores from Workers are not comparable with Python's: Workers enriches from Foursquare and Python from Google, and the two differ on social presence (real vs. hardcoded 0) and on rating scale. `businesses.google_place_id` is dead on Workers but retained; `fsq_place_id` replaced it as the dedup key.
- `api/.dev.vars` is tracked in git with no `.gitignore` rule, while `.env` is ignored. It currently holds only `CORS_ORIGINS`, but it is the file wrangler reads for local secrets, so anything put there is staged by default. Pass throwaway local values with `wrangler dev --var KEY:value` instead.
- A local D1 created before the ADR-026 reconciliation has the old schema (`users.name`, no `is_active`, `digital_presence` singular) and `wrangler d1 migrations apply --local` refuses it with `table users already exists`, so login 401s on an undefined `is_active`. Delete `api/.wrangler/state/v3/d1` and re-apply.
- There is no CI workflow or pre-commit config in the repo.

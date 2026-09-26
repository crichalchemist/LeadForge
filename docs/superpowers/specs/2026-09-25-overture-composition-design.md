# Overture composition — design

**Date:** 2026-09-25
**ADR:** 030 (this is its second slice; the Google slice shipped in `a8f7c49`)
**Status:** approved, not implemented

## Goal

Compose Overture Maps into discovery's enrichment alongside the live Google Places lookup, so that a
business gets Overture's website and social presence and Google's rating and review count, and so
that businesses already stored are improved rather than left behind.

## Why this slice exists

ADR 030 measured all three candidate sources against the same 157 licensed `hair service` businesses
in 60619, with one name scorer, one candidate corpus and one 200 m radius:

| source | corroborated | false | website | phone | social | rating |
|---|---|---|---|---|---|---|
| Google | 77 | 25 | 23 | 65 | — | 74 |
| Overture | 74 | n/a | 55 | 73 | 60 | 0 |
| Foursquare | 57 | 83 | 17 | 44 | 4 | 0 |

The two survivors are complementary rather than ranked. Google is the only source carrying `rating`
and `user_ratings_total`, the `computeViability` inputs that no free source restores. Overture carries
**55** websites against Google's 23 — 40 of them Overture-only — and social presence for 60 of its 74
matches, where Google reports none at all. Their union reaches 93 of 157 where either alone reaches
about 75.

Two consequences of shipping Google first are still live in production and this slice closes both:

- **Website coverage is 23 rather than 55**, and the website term is 30 of the digital deficit's 100
  points, so deficits are systematically overstated for businesses that do have a site.
- **Every business pays `computeDigitalDeficit`'s +12 "no social presence" term**, because Google
  returns no social fields and `digital_presences.has_facebook_page` / `has_instagram` are
  `INTEGER NOT NULL DEFAULT 0`. It is a uniform constant, so ranking survives, but absolute deficits
  are inflated by 12 and can trip `computeNofEligibility`'s `digital_deficit_score > 60` property-need
  bonus on no evidence.

## Constraints that shaped the design

These are measured or documented, not assumed.

- **Overture cannot be queried from a Worker.** It is a DuckDB query over Parquet on S3. There is no
  DuckDB in Workers, so matching must happen offline. This also means the refresh can never be a
  Workers cron trigger; it is a local or CI action, always.
- **Overture cannot be mirrored into D1.** Chicago holds **214,735** named Overture places. Workers
  Free D1 allows **100,000 row writes per day** (enforced since 2026-09-01), so one load would consume
  the entire daily budget for three days, and so would every refresh. It is also far too large to
  bundle as an asset the way ADR 028 bundles the corridor polygons.
- **Precomputing *matches* instead is affordable.** City-wide across all 15 niches Socrata holds
  113,383 licence rows collapsing to **21,004 distinct licence accounts**; at the measured ~47%
  corroboration that is roughly 10,000 matched rows. Writing all 21,004 rows is one-fifth of a day's
  free-tier budget.
- **Identity is already source-independent.** ADR 030's migration 0003 made
  `account_number`/`site_number` the dedup key, so a match table can be keyed to businesses without
  depending on any place id — and Overture's GERS id stability across monthly releases, still
  unverified, stops mattering (see Rebuilds, below).
- **`computeDigitalDeficit` is pinned to Python** by `api/test/scoring-parity.test.ts` and is not
  changed here. Everything below works by feeding it better inputs, never by editing it.

## Decisions

1. **Coverage: the whole city, all 15 niches.** The Parquet scan is bbox-wide regardless, so the
   marginal cost of covering every niche over covering one is near zero, and it removes any ordering
   prerequisite before discovering a new ZIP or niche. The alternative — build per ZIP+niche on demand
   — was rejected because a skipped build is silent: discovery would store businesses with no Overture
   enrichment and dedup would then never revisit them.
2. **Both ingest and backfill.** Discovery reads the match table when it creates a business, *and* an
   admin route improves businesses already stored. Ingest alone would mean a refresh only ever helps
   future discoveries.
3. **The backfill runs inside the Worker**, as an admin route. It therefore calls the real
   `computeDigitalDeficit` and the real D1 logic. Generating `UPDATE` statements from the offline
   script was rejected: the new deficit would have to be computed locally, which would be a third
   implementation of a scorer already pinned across Python and TypeScript.

## Stage 1 — the offline build

`scripts/build_overture_matches.py`, run as
`uv run --with duckdb python scripts/build_overture_matches.py <outdir>`.

1. Fetch every licence row city-wide whose `business_activity` matches any of the 15 niches'
   `NICHE_MAPPING` terms, paging Socrata at 1,000 rows.
2. Collapse to businesses with the identical rule `scrapers/socrata.ts`'s `dedupeLicenseRows` uses:
   key on `account_number`/`site_number`, newest `license_start_date` wins.
3. One DuckDB pass over `s3://overturemaps-us-west-2/release/<version>/theme=places/type=place/*`
   filtered to the Chicago bbox (`ymin` 41.60–42.05, `xmin` -87.95 to -87.50) using the Parquet bbox
   row-group statistics. Anonymous read; no credentials.
4. For each licence account, take the best-scoring Overture POI within **200 m** at threshold
   **0.50**, breaking ties by distance.
5. Emit the rows for loading, chunked.

**The scorer must not be duplicated a third time.** There are currently two Python copies
(`scripts/measure_overture_match.py`, `scripts/measure_places_sources.py`) and one TypeScript port
(`api/src/lib/name-match.ts`). This slice extracts the canonical Python implementation to
`scripts/lib/name_match.py` and has all three Python callers import it. `api/test/name-match.test.ts`
and `api/test/fixtures/name-match-vectors.json` remain the pin between Python and TypeScript, and
`scripts/gen_name_match_vectors.py` regenerates the fixture from the shared module.

## Stage 2 — migration 0004 and the table

```sql
CREATE TABLE overture_matches (
  account_number TEXT NOT NULL,
  site_number TEXT,
  matched INTEGER NOT NULL,      -- 0 = the build looked and found nothing
  gers_id TEXT,
  matched_name TEXT,
  score REAL,
  distance_m INTEGER,
  website TEXT,
  has_facebook INTEGER NOT NULL DEFAULT 0,
  has_instagram INTEGER NOT NULL DEFAULT 0,
  phone TEXT,
  built_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_overture_matches_account ON overture_matches(account_number, site_number);
```

**Unmatched accounts get a row.** The absence of a row means *the build has not covered this business
yet*; a row with `matched = 0` means *the build looked and Overture has nothing*. The pipeline already
takes this distinction seriously — it stores a null deficit rather than a fabricated one for a business
it never looked up — and collapsing the two would make a gap in coverage indistinguishable from a
genuine no-match.

**Rebuilds are wholesale, never diffed.** A refresh loads a fresh set and replaces the table's
contents. This is what makes GERS id stability across monthly Overture releases irrelevant: no row
outlives a rebuild, so nothing depends on an id meaning the same thing next month. It is also why
`gers_id` is stored for provenance only and is never a key.

Loading is chunked at a conservative ~500 rows per statement batch. D1's per-statement ceiling is not
documented in the material available, so the chunk size is deliberately well under any plausible limit
rather than tuned to one.

## Stage 3 — composition at ingest

`lib/discovery.ts` reads `overture_matches` by the licence account it already has in hand — one
indexed D1 read per business, no subrequest — and merges under a **never-downgrade** rule:

| field | rule |
|---|---|
| `has_website` | Google OR Overture. Once true, never set false. |
| `website_url` | Google preferred (fetched live), Overture as fallback. |
| `has_facebook_page`, `has_instagram` | Overture only. Google reports neither. |
| `google_avg_rating`, `google_review_count` | Google only. Overture carries neither. |
| `phone` | Google preferred, Overture as fallback. |

The deficit is computed once from the merged presence, so discovery's version-1 `lead_scores` row
already reflects both sources and no second write is needed for a new business.

This is what repairs the +12 without editing the pinned scorer: a matched business with a social link
stores a real `1`, so the term stops firing for 60 of every 74 matches. **Residual, stated plainly:** a
business with no Overture match still stores 0 and still pays +12 on no evidence. Fixing that would
require the column to express "unknown", which means making it nullable and forking the schema from
the SQLAlchemy model ADR 026 mirrors. Out of scope here.

## Stage 4 — the backfill route

`POST /api/enrichment/overture-backfill`, `requireAuth` + `requireAdmin`, body `{ limit }` (default 50, maximum 500). Follows the precedent of `POST /api/discovery/run`, which exists because Python runs this kind
of job from its Typer CLI and a Worker has none.

It selects businesses whose `overture_matches` row would **add** something the stored presence lacks —
a website where `has_website` is 0, or a social link where both flags are 0. That predicate is the
idempotency mechanism: a second run finds nothing to do. For each business:

1. `UPDATE digital_presences` under the same never-downgrade merge rule.
2. Recompute the deficit with `computeDigitalDeficit` from the updated row.
3. `INSERT` a new `lead_scores` row at `MAX(score_version) + 1`, composite = deficit.

Composite is the deficit alone because the other sub-scores need a competitive context that does not
exist yet — the same Phase 1 semantics `runDiscovery` already writes. Scores are append-only (ADR 014,
017), and both `LATEST_SCORE_JOIN` in `routes/businesses.ts` and `lib/sentiment-feedback.ts` select on
`score_version DESC`, so a new row is picked up correctly by everything that reads scores.

Response: `{ examined, updated, skipped }`.

**Known interaction, recorded now because it will not be obvious later:** writing a fresh score version
supersedes any sentiment adjustment applied to the previous latest score. This is inert today — no call
has ever run, and `call_attempts` is never incremented on Workers because `voice/call_manager.py` is
unported — but it becomes real when the voice port lands. The backfill does not attempt to re-apply
sentiment; whoever lands the voice port should decide whether recalibration replays adjustments.

## Task 0 — the quota experiment (independent of everything above)

Production currently caps `places-backend.googleapis.com` at 1,000 requests/day, and it is unknown
whether exhaustion returns HTTP 200 with `status: OVER_QUERY_LIMIT` or a real HTTP 429. The difference
matters: the 200 envelope is caught by `placesUnavailable` and tallied into `PlacesHealth`, but a 429
makes `base.ts`'s `fetchJson` throw, which unwinds into `runDiscovery`'s per-business catch — dropping
the business while `places.unavailable` stays 0, so the run reads as clean.

Procedure: lower the quota to 1/day, issue two Find Place calls, record the second response's HTTP
status and body, restore the quota to 1,000. Two billable calls. If it is a 429, `scrapers/google-places.ts` needs to read the HTTP status itself rather than relying on the envelope — exactly
what `scrapers/foursquare.ts` already does and for exactly this reason.

This should precede any discovery run larger than a handful of businesses.

## Testing

- **Scorer consolidation:** the existing 111-vector fixture keeps Python and TypeScript pinned; after
  extraction, regenerate it from `scripts/lib/name_match.py` and confirm it is unchanged.
- **Merge rule:** units in both directions — Overture supplies a website Google lacked; Google supplies
  one Overture lacked; neither clobbers the other; a `matched = 0` row adds nothing.
- **Coverage vs no-match:** a missing `overture_matches` row and a `matched = 0` row must produce
  distinguishable outcomes.
- **Discovery:** with a matching row present, the stored presence carries both sources and the deficit
  drops by the social term relative to the Google-only path.
- **Backfill route:** 401 anonymous, 403 viewer; a second run reports `updated: 0`; `score_version`
  increments and the prior row survives; never-downgrade holds on update.

## Out of scope

- Making the social columns nullable so "unknown" is expressible.
- Any change to `computeDigitalDeficit` or the scoring parity fixture.
- Replaying sentiment adjustments after a backfill (belongs with the voice port).
- Backfilling `latitude`/`longitude` from Overture; the city geocodes 92% of licence rows and Google
  fills the rest.
- Removing `scrapers/foursquare.ts` and its `fsq_place_id` column and index. Dropping them is a
  separate cleanup; keeping them costs nothing.

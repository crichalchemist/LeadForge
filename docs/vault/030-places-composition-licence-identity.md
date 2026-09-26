# ADR 030 — The licence account is identity; Google enriches live, Overture is precomputed

**Status:** Accepted
**Date:** 2026-09-25
**Supersedes:** 029 (Foursquare Places replaces Google Places), and 004's dedup rule as amended by 029

## Context

ADR 029 chose Foursquare because Google Places was unavailable — the Cloud project's billing account
was broken. That premise no longer holds: billing is enabled on `leadforge-509800`, the legacy
`places-backend.googleapis.com` (the surface `api/src/scrapers/google-places.ts` already calls)
enables without refusal, and a restricted key returns `status: OK` on both `findplacefromtext` and
`details`, ratings included.

Foursquare was therefore the best *available* source, not the best source. With the constraint gone,
all three candidates were measured head-to-head: `scripts/fetch_places_candidates.mjs` then
`scripts/measure_places_sources.py`, one name scorer, one candidate corpus, one 200 m radius, the
same 157 licensed `hair service` businesses in 60619.

| source | returned | name-corroborated | false | website | phone | social | rating | reviews ≥5 |
|---|---|---|---|---|---|---|---|---|
| Google | 102 | 77 (49%) | 25 | 23 | 65 | — | 74 | 63 |
| Foursquare | 140 | 57 (36%) | 83 | 17 | 44 | 4 | 0 | 0 |
| Overture | 157 | 74 (47%) | n/a | 55 | 73 | 60 | 0 | 0 |

These reproduce the two earlier independent runs exactly (Overture 74; Foursquare 57 with 83 false),
which is the cross-validation that makes the Google column trustworthy. Overture's "returned" is 157
because every business has *some* POI within 200 m and its matching is exhaustive and offline, so it
has no false-match count comparable to a single nearest API result.

## Decisions

### 1. Identity is the city's licence account, not any source's place id

`businesses` gains `account_number` and `site_number` (migration 0003), and the pair becomes the
dedup key. Measured on the live data: **157 of 157 licences carry both, 157 distinct, zero
collisions.** `dedupeLicenseRows` already computes exactly this key, so the pipeline has been
deriving it and then throwing it away.

This is the load-bearing decision, because it dissolves a trap that has followed every source choice
so far. Dedup on `fsq_place_id` (029) or on a GERS id both fail the same way: NULLs stay distinct in
a UNIQUE index, so a business whose lookup missed is stored again on the next run, and nothing
backfills the first copy. Only 4 of Overture's matches even carry a Foursquare source id. Keying on
the licence removes the dependency entirely — **a source id is an enrichment attribute, not an
identity** — and it also retires the unverified question of whether GERS ids are stable across
monthly Overture releases, because nothing now depends on that.

`google_place_id` (already present, `UNIQUE`, dead since 029) and any Overture GERS id become plain
enrichment columns.

### 2. Google Places is the live enrichment source, and corroboration happens before Details

Google is the only measured source carrying `rating` and `user_ratings_total` — the inputs
`computeViability`'s rating/review block needs, dead under both free alternatives.

Find Place already returns `name` and `geometry`, so the name score and the 200 m distance cut are
applied to *that* response, and Details is called only for a corroborated match. Measured: 157 Find
Place plus **77** Details, about **234** calls per 157 businesses rather than the 307 this
measurement paid, with the entire saving falling on the SKU that carries `rating`, `reviews` and
`website`. A false match is then never billed and never stored — which matters because a false match
is worse than no match: it flips the deficit's 30-point website term on fabricated evidence.

`locationbias` is a bias and not a filter, so the distance cut is ours to enforce. Unrestricted,
Google returns 144 and corroborates 86 — at 58 false matches.

### 3. Overture is a precomputed match table, never a POI mirror, and never queried live

Overture is a DuckDB/parquet query against S3; Workers cannot run DuckDB, so it cannot be called at
request time. The obvious alternative — mirror the POIs into D1 and match in the Worker — is ruled
out by measurement, not by taste:

- Chicago holds **214,735** Overture POIs.
- Workers Free D1 allows **100,000 rows written per day**, enforced since 2026-09-01.

A single load would consume the entire daily write budget for three days, and so would every monthly
refresh. It is also far too large to bundle as an asset the way ADR 028 bundles corridor polygons.

So an offline script matches licences against Overture and writes only the **matched** rows, keyed by
the licence account — thousands of rows, not 214,735. The cost of this design is staleness: a licence
issued between refreshes has no Overture row until the next run. Google covers those businesses live,
so the failure mode is reduced enrichment, not a missing business.

### 4. Foursquare is dropped

It is dominated on every axis and carries no field the others lack: fewer corroborated matches than
either alternative (57), the most false matches by far (83), under a third of Overture's website
coverage, and no rating — its rating and review count are precisely the entitlement-denied fields
that 429 the whole request. It adds 12 businesses over Google ∪ Overture, and collecting them means
filtering 83 false matches.

Consequence: `e203656`, which fixed the Foursquare field entitlement, is moot and stays undeployed.

## Sequencing

Google first, Overture second — per the standing rule to take a thin slice to live data before
building more. Google needs no new infrastructure: the client is already ported and tested, and the
only schema change is the identity key, which is wanted regardless.

**Until Overture lands, deficits are inflated.** Google finds a website for 23 businesses where
Overture finds 55 (40 of them Overture-only), and the website term is 30 of the digital deficit's
100 points. Scores written in the Google-only interval are therefore not comparable with scores
written after Overture is composed in — the same versioned-score caution ADR 014 already applies.

## Consequences

- Migration 0003 adds `account_number`/`site_number` and a UNIQUE index on the pair. Rows already
  written carry neither, so they do not collide; the existing `fsq_place_id` index stays until the
  Foursquare client is removed, to avoid a migration that rewrites history.
- `lib/discovery.ts` returns to `scrapers/google-places.ts` and stops calling `scrapers/foursquare.ts`.
- Google's rating is a 0.0–5.0 scale, so the halving that `scrapers/foursquare.ts` applied must not
  be carried over. `has_google_business_profile` keeps its 029 meaning: the source returned a record.
- Spend is capped at **1,000 Places requests/day** on the project, so a runaway run cannot bill
  unbounded. Per-SKU prices are unverified; check the console before widening.
- The subrequest cap that set `limit <= 20` is unchanged in spirit but its arithmetic moves: worst
  case is again two subrequests per business, so the cap stays at 20 with 41 worst-case subrequests
  against the free plan's 50.

# ADR-028: NOF corridors as a bundled polygon asset, point-in-polygon at ingest

## Status

Accepted. Supersedes ADR-021.

## Date

2026-09-02

## Context

ADR-021 fetches corridor GeoJSON from the Chicago Data Portal and stores it as PostGIS
MULTILINESTRING geometry, testing membership with `ST_DWithin(..., 50)` against street
centre-lines. Three things have since broken that decision.

The data source is gone. ADR-021 names dataset `k3jz-zhsb`; `data/nof_corridors.py` fetches
`bfbm-fall`. The two disagree, and both return 404 and are absent from the Socrata catalog
entirely. Searches of the portal for the corridor boundaries return only the NOF *awarded
project* datasets, which are grant records rather than geometry.

D1 has no PostGIS, so the spatial query has no equivalent on the target stack.

Nothing populated the column anyway. `in_nof_corridor` has exactly one writer in the
repository — `scripts/precompute_corridors.py`, a one-off run against PostGIS — and nothing on
Workers reads or writes it. A business discovered after that run is silently off-corridor, and
because `compute_nof_eligibility` hard-gates on corridor membership, every such business scores
zero NOF eligibility. The grant track (ADR-020, ADR-023) would never see a new lead.

The City does still publish the corridors: the NOF programme site links an eligibility lookup
app whose web map draws two ArcGIS feature layers, `NOF_EligibleCorridor_20241112` and
`NOF_PriorityCorridor_20241112`. They are **polygons**, not centre-lines — 22 and 23 features,
45 outer rings, 21,886 vertices between them — and they are split by type, which removes
ADR-021's heuristic of scanning every property value for the word "priority".

## Decision

Bundle the corridors with the Worker as a generated static asset and test membership with
point-in-polygon at ingest.

`scripts/fetch_nof_corridors.py` fetches both layers, keeps each polygon's outer ring, rounds
coordinates to five decimals (~1.1 m, far finer than a corridor boundary is meaningful to),
records a bounding box per ring, and writes `api/src/data/nof-corridors.json`.

`lib/corridors.ts` exposes `locateCorridor(lat, lng)`: a bounding-box prefilter, then ray
casting against the rings. Priority wins over eligible where they overlap, matching ADR-021's
ordering. Off-corridor returns null, which is the hard gate `computeNofEligibility` expects.

`lib/discovery.ts` calls it for every business it stores, writing `in_nof_corridor` and
`nof_corridor_name`.

Because the layers are polygons, no distance buffer is used. The 50 m buffer in ADR-021 existed
to give centre-lines width; a published boundary already has it.

The layers carry no name attribute — only a FID — so a corridor is labelled by its layer and id,
for example `Priority corridor 8`. Refreshing means re-running the script and deploying, which
replaces ADR-021's weekly Celery Beat refresh.

## Consequences

### Positive
- Works on D1 with no spatial extension and no external call at ingest
- Exact boundary test rather than a buffered approximation of a centre-line
- Priority and eligible come from separate published layers, not a string heuristic
- The corridor check costs no query and no network round trip
- Fixes a silent zero: businesses discovered on Workers can now be NOF-eligible at all

### Negative
- The asset is a point-in-time snapshot; staleness is now a deploy concern rather than a cron
- Adds ~85 KB gzipped to the Worker bundle (197.86 KiB total, against a 1 MB free-plan limit)
- Corridor names are synthesised from layer and FID, because the City publishes none
- The `nof_corridors` D1 table remains unused; it has no geometry column and nothing reads it

### Neutral
- The source layers are dated 20241112, so a future refresh may need new service URLs
- Holes in polygons are discarded; the published bands have none, and a hole could only shrink a
  corridor

## Alternatives Considered

1. **Store the rings in D1 and query by bounding box** — Rejected. At 45 rings the whole set is
   smaller than the query machinery needed to avoid loading it, and it would add a read to every
   ingested business.

2. **Query the ArcGIS layer per business** — Rejected for the reason ADR-021 gave for the same
   idea: it adds latency and an external dependency to every eligibility check, and it would put
   a third-party outage in the ingest path.

3. **Use the licence dataset's `ssa` field as a proxy** — Rejected. Special Service Areas are
   taxing districts that happen to overlap commercial corridors; they are not the NOF boundary.
   Eligibility here decides whether someone is told they may qualify for up to $250,000, and a
   proxy that is right most of the time is the wrong shape of error for that.

4. **Derive corridors from awarded NOF projects** — Rejected. The two surviving portal datasets
   record where grants were made, not where they are permitted; it would encode past awards as
   present eligibility.

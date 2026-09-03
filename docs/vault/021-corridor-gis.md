# ADR-021: Corridor GIS: Chicago Data Portal to PostGIS spatial eligibility

## Status

Superseded by ADR-028. The dataset this decision depends on has been withdrawn
from the Chicago Data Portal and D1 has no PostGIS.

## Date

2026-03-14

## Context

NOF eligibility requires physical location on designated corridors. The City of Chicago publishes corridor data as GeoJSON on the Chicago Data Portal (Socrata API). These corridors are linear geometries representing commercial streets eligible for renovation funding.

Corridor data is the source of truth for spatial eligibility and must be reliable and current. Naive approaches like zip codes or manual lists are too imprecise and don't reflect the actual corridor boundaries. The system must support fast, meter-accurate spatial queries to determine if a business location is within the buffer zone.

The corridor dataset is relatively small (~200 features) and managed by the City; full weekly refreshes are feasible and safe. Incremental sync would require tracking entity IDs and handling deletes, adding complexity for minimal benefit.

## Decision

Fetch corridor GeoJSON from Socrata via the Chicago Data Portal API (dataset ID: k3jz-zhsb). Parse the GeoJSON and upsert into the `nof_corridors` table with PostGIS MULTILINESTRING geometry using `ST_GeomFromGeoJSON`. Use `ST_DWithin` with the geography type (SRID 4326) for meter-accurate 50m buffer distance calculations.

Implement weekly Celery Beat schedule (Sunday 3:00 AM Chicago time) to refresh corridors. Full refresh strategy: delete all existing `nof_corridors` records, then bulk insert new features from the API response. Store metadata: corridor name, corridors ID, geometry, and fetch timestamp.

Add a helper function `is_business_nof_corridor_eligible(lat, lon)` that queries `ST_DWithin(geometry, ST_SetSRID(ST_MakePoint(lon, lat), 4326), 50, true)` and returns boolean. Use this function in eligibility scoring (ADR-022).

## Consequences

### Positive
- Single source of truth: authoritative City of Chicago data, not local cache
- Meter-accurate spatial queries via PostGIS geography type
- Fast eligibility checks (indexed spatial queries on geometry column)
- Automatic weekly refresh prevents staleness
- Simple full-refresh model reduces sync complexity

### Negative
- External dependency on Socrata API uptime; adds latency to initial data load
- Requires PostGIS extension enabled on PostgreSQL instance
- If Socrata is down, corridor data becomes stale after 7 days
- 50m buffer is a fixed constant; cannot be adjusted per corridor without API change

### Neutral
- Adds Socrata API client code (~50 lines)
- Weekly background task adds one Celery Beat schedule

## Alternatives Considered

1. **Static corridor list by zip code** — Maintain a hardcoded list of eligible zip codes. Rejected because corridors follow specific street segments, not zip code boundaries. Many addresses in eligible zip codes would be ineligible, wasting calls.

2. **External GIS API per query** — Call Chicago Data Portal or Mapbox API for each eligibility check. Rejected because adds 200-500ms latency per business lookup, creates external dependency on every scoring request, and increases API costs.

3. **Manual corridor list** — City provides a PDF; manual extraction into database. Rejected because not maintainable; updates require manual re-entry, error-prone, and misses City corrections.

4. **Distance-only, no GIS** — Calculate distance using Haversine formula from City Hall or manually specified corridor points. Rejected because imprecise for corridors that are not circular around a point; corridors are linear and vary in distance.

# ADR-005: API cost management: Google Places field masks, Socrata pagination

## Status

Accepted

## Date

2026-03-14

## Context

LeadForge's Phase 1 pipeline makes thousands of API calls to external services:
- **Google Places API:** ~0.05/request for basic field; $0.017/request for full details. Pricing is per-field-category, so requesting unnecessary fields multiplies cost.
- **Socrata (Chicago Data Portal):** Free, but large result sets timeout without pagination.

At scale (100k businesses × daily updates × multiple queries per business), unconstrained API usage becomes a significant operational cost.

Technical constraints:
- Phase 1 budget is constrained; must minimize external API spend
- Pipeline runs daily; cost reduction compounds over time
- Google Places is the primary canonical source for business info; can't be eliminated, but can be optimized

## Decision

Adopt targeted API cost management:

### Google Places API
- Use **field masks** to request only essential fields:
  - Basic: name, address, formatted_address, geometry
  - Contact: formatted_phone_number, website, opening_hours
  - Atmosphere: types, editorial_summary
- Request only these 3 categories; skip all others (photos, reviews, UTC offset, etc.)
- Cost: ~$0.003-0.005/request vs. $0.017+ without field masks

### Socrata (Chicago Data Portal)
- Use **SoQL query language** with `$limit` and `$offset` pagination
- Configurable page size (suggest 1000 records/page)
- Implement exponential backoff with retry logic for rate limits
- No cost, but avoids timeouts on large result sets

Implementation details:
- Google Places client accepts `fields` parameter in requests; map to field masks via configuration
- Socrata client uses `$offset` parameter to paginate through results
- Configuration file specifies which fields are required for each business type (niche)
- Monitoring tracks cost-per-request to catch configuration regressions

## Consequences

### Positive
- **Cost reduction:** Field masks reduce Google Places cost by 70-80% (e.g., $50/day → $10/day for 10k requests)
- **Predictable budgeting:** Specific field masks make API costs deterministic and controllable
- **No timeout issues:** Socrata pagination eliminates large-query timeouts
- **Configuration flexibility:** Field masks can be tuned per niche if certain fields are only needed for specific business types

### Negative
- **Feature limitation in Phase 1:** Skipping fields like photos and reviews limits early scoring quality; Phase 2 can add these selectively
- **More API requests:** Pagination may increase total requests vs. single large Socrata query (but avoids timeout and is faster)

### Neutral
- Requires upfront configuration mapping (one-time cost); covered in ADR-006

## Alternatives Considered

### 1. Fetch all fields from Google Places (no field masks)
**Why rejected:** 3-5x more expensive with no additional value for Phase 1. Cost compounds daily across 100k businesses.

**Trade-offs:** Simpler initial configuration (no field mask mapping), but 5x higher monthly spend.

### 2. Single large Socrata query (no pagination)
**Why rejected:** Socrata has query size limits (~30 seconds); large queries timeout. Pagination solves this without cost.

**Trade-offs:** Simpler query logic, but unreliable for large result sets.

### 3. Cache Google Places data indefinitely (no daily re-fetch)
**Why rejected:** Businesses update phone numbers, hours, addresses regularly. Caching stale data reduces scoring quality. Daily updates are appropriate for Phase 1.

**Trade-offs:** Lower API cost, but lower data freshness.

### 4. Google Places Nearby Search instead of Text Search
**Why rejected:** Nearby Search is cheaper per request but less precise for location-based queries. Text Search with field masks is the better trade-off.

**Trade-offs:** Nearby Search might find more results, but with lower relevance; Text Search with field masks is recommended by Google for business discovery.

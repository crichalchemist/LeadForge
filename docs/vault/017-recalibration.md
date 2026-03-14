# ADR-017: Recalibration: 90-day full re-enrichment, score versioning for audit trail

## Status

Accepted

## Date

2026-03-14

## Context

Business data degrades over time. Ratings change, new reviews appear, competitors open or close, and online presence shifts. LeadForge scores are only useful if they reflect current reality.

Key forces:

- Small-business data can go stale within weeks (new reviews, hours changes, closures)
- Historical scores must be preserved for audit, reporting, and score-drift analysis
- Re-enrichment is expensive (API calls to Google Places, scraping platforms) and must be batched responsibly
- The scoring model may evolve over time; comparing scores across model versions requires clear versioning

## Decision

We will implement a 90-day full recalibration cycle:

- A **Celery Beat** periodic task triggers every 90 days
- The task re-enriches all businesses with `pipeline_stage != 'closed_lost'` and `pipeline_stage != 'closed_won'` by re-running the full enrichment pipeline (Google Places refresh, platform scraping, competitive context recomputation)
- After re-enrichment, composite scores are recomputed for all affected businesses
- Each scoring run increments `score_version` on the `business_scores` table; previous versions are retained (append-only)
- A `score_versions` table stores metadata: version number, scoring model identifier, timestamp, and parameter snapshot
- The CRM dashboard displays the latest score by default but allows viewing historical versions

Rate limiting and cost controls from ADR-005 and ADR-010 apply to recalibration runs. The batch is processed in chunks with backoff to avoid API throttling.

## Consequences

### Positive
- Full audit trail enables score-drift analysis and reporting over time
- Stale data is systematically refreshed, keeping scores meaningful
- Score versioning supports A/B testing of scoring model changes
- Append-only design simplifies data integrity (no destructive updates)

### Negative
- Storage grows linearly with each recalibration cycle (one new score row per active business per cycle)
- 90-day batches create API cost spikes; must budget accordingly
- Re-enrichment of all active businesses is a long-running process that needs monitoring

### Neutral
- The 90-day interval is a starting default; it can be tuned per niche or adjusted based on observed staleness patterns
- Businesses that enter closed_won or closed_lost between cycles are excluded, naturally pruning the active set

## Alternatives Considered

1. **In-place score updates (overwrite)** — Simpler storage model, no versioning overhead. Rejected because it destroys the audit trail, makes it impossible to detect score drift, and eliminates the ability to compare scoring model changes over time.

2. **Event-driven re-enrichment** — Re-enrich when external signals indicate change (e.g., new review detected). Rejected because small businesses do not reliably emit detectable events, and monitoring for changes across thousands of businesses at multiple sources is more complex and expensive than periodic batch re-enrichment.

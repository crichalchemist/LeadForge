# ADR-010: Rate limiting: per-source limits in config, asyncio.Semaphore + httpx transport

## Status

Accepted

## Date

2026-03-14

## Context

The enrichment pipeline calls 10+ external APIs (Google Places, Yelp, BBB, etc.). Each API has:
- Rate limits (requests/minute, requests/day)
- Cost implications (quota-based pricing)
- Ban risk if limits exceeded (temporary or permanent blocks)
- Throttling behavior (429 Too Many Requests, backoff headers)

Without rate limiting:
- Expensive APIs (Google Places) can burn through monthly quota quickly
- Risk of IP bans or account throttling from multiple providers
- No control over request distribution or throughput

Must implement per-source rate limiting that is:
- Configurable (easy to adjust limits as we learn provider behavior)
- Fair (all tasks respect same limits)
- Simple (no complex algorithms for v1)

## Decision

Implement per-source rate limits in Settings configuration. Each scraper source has a configurable limit: `{source: requests_per_minute}`.

Celery task configuration:
- `worker_prefetch_multiplier=1`: Worker prefetches only 1 task at a time (enforces serialization)
- No concurrent scraping tasks in same worker (conservative, simple)
- httpx client configured with per-source timeout and connection pooling

Rate limit enforcement:
- No token bucket or sliding window (overkill for v1)
- Rely on Celery task serialization + Semaphore for cross-worker fairness
- httpx respects 429 status codes and Retry-After headers

Configuration example:
```
SCRAPER_RATE_LIMITS = {
    'google_places': 50,  # requests/minute
    'yelp': 30,
    'nextdoor': 5,
    'bbb': 20,
}
```

## Consequences

### Positive
- Predictable, controllable API costs (no surprise overages)
- No ban risk from respecting provider rate limits
- Simple to configure and understand (no complex algorithm)
- Worker prefetch=1 ensures one task at a time (natural backpressure)
- httpx timeout config prevents hanging requests
- Per-source limits easy to adjust without code changes

### Negative
- Throughput limited by slowest/most-restricted source
- Conservative approach (worker_prefetch=1) may underutilize fast sources
- No cross-worker rate limiting enforcement (assumes 1-2 workers in v1)
- Multiple Celery workers could overwhelm limits if not coordinated
- 429 responses still possible if limits misconfigured

### Neutral
- Enrichment latency increases with stricter rate limits
- Load distribution depends on source popularity and restrictions

## Alternatives Considered

### 1. Token Bucket Algorithm
**Description**: Implement sliding window or token bucket for fine-grained rate limit control
**Why rejected**: Over-engineered for v1; adds complexity without proportional benefit; httpx + Celery serialization sufficient
**Trade-offs**: More precise control over request distribution but significantly more code

### 2. No Rate Limiting (Rely on Provider Headers)
**Description**: Don't implement rate limiting; just respect 429 responses and Retry-After headers
**Why rejected**: Reactive not proactive; still risk account throttling or bans from burst requests
**Trade-offs**: Simpler code but higher risk of service disruptions and quota overages

### 3. API-Specific Rate Limit Headers (Per-Provider Parsing)
**Description**: Parse X-RateLimit-* headers from each provider and dynamically adjust limits
**Why rejected**: Every provider has different header formats and semantics; too fragile and maintenance-heavy
**Trade-offs**: Theoretically optimal but complexity not worth it for v1

### 4. Centralized Rate Limiter (Redis-backed)
**Description**: Use Redis + Lua script for distributed rate limiting across all workers
**Why rejected**: Added Redis/Lua dependency; unnecessary complexity if only 1-2 workers; Celery serialization sufficient for MVP
**Trade-offs**: Scales better to many workers but overkill for current scale

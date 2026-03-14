# ADR-003: Scraping library: Scrapling for static+headless, Apify for Meta only

## Status

Accepted

## Date

2026-03-14

## Context

LeadForge's Phase 1 data pipeline sources businesses from multiple external providers:
- **APIs:** Google Places, Socrata (Chicago Data Portal)
- **Websites requiring headless browsers:** DFPR (Illinois Department of Financial and Professional Regulation), IL SOS (Secretary of State), Nextdoor, Craigslist, Thumbtack, Angi
- **Meta platforms (Facebook, Instagram):** Require sophisticated anti-bot evasion; high rate-limit enforcement

We need a scraping strategy that:
- Minimizes external dependencies and costs (Apify is expensive at scale)
- Handles both static HTML and JavaScript-rendered content
- Respects robots.txt and rate limits
- Supports stealth techniques (user-agent rotation, header spoofing, etc.)

Technical constraints:
- Phase 1 focuses on Google Places + Socrata (Phase 2 adds headless scraping)
- Meta platforms require advanced anti-detection (fingerprint spoofing, residential proxies)
- Pipeline runs on fixed schedule (not real-time); can tolerate slower scraping

## Decision

Adopt a phased scraping approach:

### Phase 1 (Data Pipeline MVP):
- **Google Places API:** httpx client with field masks (ADR-005)
- **Socrata (Chicago Data Portal):** httpx client with SoQL queries and pagination
- No headless scraping needed yet

### Phase 2+ (Future):
- **Headless scraping (DFPR, IL SOS, Nextdoor, Craigslist, Thumbtack, Angi):** Scrapling's StealthyFetcher with configurable User-Agent rotation and header spoofing
- **Meta platforms (Facebook, Instagram):** Apify actors only—not worth building in-house given their anti-bot measures

Implementation details:
- httpx configured with connection pooling and reasonable timeouts for API calls
- Scrapling integration (Phase 2): instantiate StealthyFetcher per source with role-based browser profiles
- Apify integration (Phase 2): use Apify SDK to trigger actors, poll results via API
- Rate limiting enforced via asyncio.Semaphore per source

## Consequences

### Positive
- **Cost control:** Apify only for Meta platforms (highest ROI data sources); home-grown scraping elsewhere
- **Stealth flexibility:** Scrapling's StealthyFetcher handles fingerprinting better than Scrapy or raw Playwright
- **Minimal Phase 1 scope:** No scraping complexity in MVP; focus on data ingestion pipeline and scoring
- **Separation of concerns:** Different scraping strategies per source type (API vs. headless vs. anti-bot)

### Negative
- **Scrapling adds complexity:** Another dependency with its own learning curve (Phase 2 concern, not Phase 1)
- **Apify costs:** Per-actor execution fees (~$0.03-0.20/run depending on complexity); need to monitor budget
- **Maintenance burden:** Custom scraper maintenance if websites change structure (Apify actors are maintained by Apify, reducing this risk)

### Neutral
- Phase 1 doesn't introduce scraping complexity; deferred to Phase 2

## Alternatives Considered

### 1. All Apify actors (no custom scraping)
**Why rejected:** Cost-prohibitive at scale. Apify's pricing is per-run; with 15 niches × multiple sources × daily runs = high monthly bills. Only economical for high-value sources (Meta).

**Trade-offs:** Guaranteed reliability (Apify maintains scrapers), but loses cost advantage of home-grown solution.

### 2. Scrapy (no Scrapling)
**Why rejected:** Scrapy is sync-first; integrating with async pipeline requires awkward thread pool or process isolation. Scrapy's middleware model is powerful but overkill for this use case.

**Trade-offs:** More mature than Scrapling, but architectural mismatch with async FastAPI pipeline.

### 3. Raw Playwright (no Scrapling, no Apify)
**Why rejected:** Low-level browser automation requires extensive maintenance (fingerprint updates, anti-detection engineering). Better to outsource to Scrapling or Apify.

**Trade-offs:** Maximum control, but unsustainable maintenance burden as anti-bot measures evolve.

### 4. No dedicated headless scraping; use APIs where available
**Why rejected:** DFPR and IL SOS don't expose public APIs; Nextdoor actively blocks all scraping (API-only, but invitation-required). APIs are not viable fallback.

**Trade-offs:** Reduces scope to ~6 data sources instead of 12+; incomplete coverage of the Chicago market.

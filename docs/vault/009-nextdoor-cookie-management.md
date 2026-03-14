# ADR-009: Nextdoor cookie management: Redis-backed store with TTL, dedicated account

## Status

Accepted

## Date

2026-03-14

## Context

Nextdoor is a hyperlocal social network with rich lead-generation signals (neighborhood discussions, recommendations, complaints). Accessing Nextdoor data requires:
- Authenticated sessions (login required)
- Session cookies that expire on variable schedule (typically 5-7 days)
- CAPTCHA and bot-detection evasion

Manual cookie management is unsustainable. Apify offers managed scrapers but at high cost ($0.10-0.50 per request). Skipping Nextdoor means losing a unique hyperlocal signal unavailable elsewhere.

We must automate cookie refresh while managing risk of account lockout.

## Decision

Store Nextdoor session cookies in Redis with 5-day TTL. Celery scheduled task runs every 2 days to refresh cookies by re-authenticating with dedicated account. Dedicated account (not team personal account) isolates risk of lockout to pipeline infrastructure.

When cookies unavailable (expired, refresh failed):
- Scraper gracefully degrades (returns null for Nextdoor fields)
- Viability score reduced by 5 points (manageable penalty, not disqualifying)
- Alert logged for ops team to investigate/refresh manually

Implementation:
- Nextdoor session stored in Redis with key: `nextdoor:session:{account_id}`
- TTL: 5 days (432000 seconds)
- Celery beat task: `refresh_nextdoor_cookies` every 2 days
- Use Scrapling + Playwright to automate login (headless browser)
- Graceful degradation: catch `CookieExpiredError`, log alert, skip enrichment
- Scoring pipeline treats missing Nextdoor data as -5 viability points

## Consequences

### Positive
- Automated cookie refresh: no manual intervention needed
- Dedicated account limits lockout risk to bot infrastructure
- Graceful degradation ensures pipeline doesn't stall if access revoked
- Hyperlocal Nextdoor data significantly improves lead quality (unique signal)
- Redis-backed; no persistent credential storage on disk
- Easy to swap accounts or add backup accounts if needed

### Negative
- Account lockout risk (Nextdoor actively blocks scrapers); may require manual investigation
- Nextdoor ToS violation risk (scraping not officially sanctioned)
- Dependent on Nextdoor's stability and bot-detection persistence
- Requires dedicated account maintenance and monitoring
- Cookie refresh failures not immediately visible; monitoring critical

### Neutral
- Adds Redis and Celery task dependency (already used elsewhere)
- Nextdoor data quality varies by neighborhood and season

## Alternatives Considered

### 1. Manual Cookie Refresh
**Description**: Team member manually logs in, exports cookies, commits to repo or uploads to vault every week
**Why rejected**: Completely unsustainable at scale; human error risk; poor security practice (credentials in git)
**Trade-offs**: Zero infrastructure but not compatible with automated pipeline goals

### 2. Apify Managed Scraper
**Description**: Use Apify's Nextdoor scraper actor (maintained, bot-detection aware)
**Why rejected**: High cost at volume; lock-in to Apify infrastructure; overkill for Nextdoor-only enrichment
**Trade-offs**: Reliability and maintenance-free but 5-10x cost vs. in-house solution

### 3. Skip Nextdoor Entirely
**Description**: Exclude Nextdoor from enrichment pipeline, rely on Google/Yelp only
**Why rejected**: Lose unique hyperlocal signal; competitor advantage lost
**Trade-offs**: Lower operational complexity but significantly reduced lead quality and PDL competitive positioning

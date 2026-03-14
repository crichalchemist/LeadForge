# ADR-007: Scraper resilience: independent scrapers, failures logged not fatal, Celery retry

## Status

Accepted

## Date

2026-03-14

## Context

The enrichment pipeline requires data from 10+ external sources (Google Places, Yelp, Nextdoor, BBB, etc.). Any external source can fail at any time due to:
- Network outages
- API rate limiting or throttling
- Service downtime
- Authentication failures
- Unexpected response formats

A single source failure cannot be allowed to halt the entire pipeline, as we need to proceed with scoring even with partial data. The pipeline must be resilient and continue processing despite individual source failures.

## Decision

Each scraper runs independently in try/except blocks within Celery tasks. Failures are logged via structlog with full context but do not propagate to halt the pipeline. Celery tasks are configured to retry up to 3 times with exponential backoff (default: 2^retry_count seconds) before giving up. Failed enrichment attempts are recorded in the database for monitoring and alerting.

Implementation:
- Wrap each external API call in try/except with structured logging
- Use Celery task retry mechanism: `task.retry(exc=error, countdown=2**self.request.retries)`
- Max retries set to 3 with exponential backoff
- Track failed enrichment attempts in a dedicated log table
- Scoring pipeline treats missing enrichment data as null fields (graceful degradation)

## Consequences

### Positive
- Pipeline always completes, even with multiple source failures
- Scoring model handles partial data gracefully
- Exponential backoff prevents hammering failing services
- Full audit trail of failures for debugging and monitoring
- Easy to add new sources without affecting reliability

### Negative
- Pipeline may complete with significantly incomplete data if multiple sources fail simultaneously
- Monitoring and alerting become critical to detect persistent failures
- Retry delays can slow enrichment for temporarily unavailable sources

### Neutral
- Scoring accuracy may vary depending on which sources successfully return data
- Additional database table needed to track enrichment failures

## Alternatives Considered

### 1. Circuit Breaker Pattern
**Description**: Implement circuit breaker to fail fast and prevent cascading failures
**Why rejected**: Adds significant complexity for a v1 system. Exponential backoff achieves similar goals with less code.
**Trade-offs**: Would reduce noise in logs and prevent repeated failures, but requires state management and monitoring

### 2. All-or-Nothing Enrichment
**Description**: Fail the entire enrichment task if any source fails
**Why rejected**: Too fragile. Single API downtime blocks all scoring. Not aligned with business goal of always delivering leads.
**Trade-offs**: Would guarantee data completeness but at unacceptable cost to availability

### 3. Manual Retry (No Celery Retry)
**Description**: Implement retry logic in application code instead of using Celery's built-in retry
**Why rejected**: Not scalable, duplicates Celery functionality, harder to monitor
**Trade-offs**: More control over retry logic but more code to maintain

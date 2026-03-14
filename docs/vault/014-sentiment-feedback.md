# ADR-014: Sentiment feedback: multiplicative on composite, one adjustment per call, capped at 100

**Status:** Accepted
**Date:** 2026-03-14

## Context

After voice outreach calls complete, we receive transcripts and metadata from Retell. We want to use call sentiment to dynamically reprioritize leads — engaged leads should rise in the queue, unresponsive or hostile leads should drop.

The composite acquisition score (0-100) is calculated in Phase 2 from static signals (digital presence, revenue estimate, GBP completeness). Call sentiment provides dynamic signal about lead engagement and receptiveness.

We need to decide:
- How to adjust scores based on sentiment
- Whether to use additive or multiplicative adjustments
- How to handle multiple calls to the same lead
- How to handle no-answers vs negative sentiment

## Decision

We will implement multiplicative sentiment feedback with the following rules:

**Sentiment Multipliers (applied to `composite_acquisition_score`):**
- **Positive** (sentiment > 0.3): × 1.15
- **Neutral** (sentiment -0.3 to 0.3): no change
- **Negative** (sentiment < -0.3): × 0.75
- **No-answer** after 2+ attempts: × 0.90

**Implementation Details:**
- Feedback is multiplicative (not additive) on `composite_acquisition_score`
- One adjustment per call — idempotency via `sentiment_adjustment` field on `LeadScore`
- Score capped at 100.0 after adjustment
- No-answer check takes priority over sentiment score
- Sentiment score stored on `OutreachRecord`, multiplier stored on `LeadScore`

**Processing Flow:**
1. Retell webhook delivers call result
2. Celery task `analyze_call_sentiment` calls Claude API to score transcript
3. Sentiment score written to `OutreachRecord.sentiment_score`
4. If `LeadScore.sentiment_adjustment` is NULL (first call), apply multiplier
5. Cap adjusted score at 100.0
6. Set `sentiment_adjustment` flag to prevent double-counting

## Consequences

### Positive
- Multiplicative prevents impossible scores — additive could produce >100 or <0
- Idempotency guard prevents double-counting on Celery retries or webhook redelivery
- Engaged leads naturally rise, unresponsive leads drop — automatic prioritization
- No-answer penalization encourages trying different leads vs repeated attempts

### Negative
- Single multiplier is coarse — doesn't consider weighted history across multiple calls
- No-answer penalization may unfairly lower scores for leads who were simply unavailable at call time
- Fixed thresholds (0.3, -0.3) may not be optimal — requires tuning from real data
- One-adjustment-per-lead means first call has outsized influence on future prioritization

## Alternatives Considered

- **Additive adjustment:** Simpler logic (+10 for positive, -15 for negative) but can produce invalid scores outside 0-100 range
- **Weighted moving average:** More accurate representation of sentiment across multiple calls, but significantly more complex and harder to reason about
- **No feedback loop:** Simpler implementation but loses valuable engagement signal — leads would be called in static score order forever

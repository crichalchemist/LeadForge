# ADR-022: NOF eligibility scoring: corridor hard gate plus business signal scoring

## Status

Accepted

## Date

2026-03-14

## Context

Need to determine which businesses should receive the NOF grant pitch vs. the standard marketing pitch. Must balance precision (don't pitch businesses that clearly won't qualify for NOF) with recall (don't miss eligible businesses who would benefit from the information). False positives waste voice calls; false negatives lose pipeline opportunities.

NOF program requirements include location on corridor, business license status, and business type restrictions. Beyond hard gates, softer signals like business age, revenue, employee count, and market activity indicate likelihood of qualifying and interest in renovation. A pure binary gate would miss potentially strong candidates; a regression model would require training data not available at launch.

Scoring must be transparent, configurable, and adjustable in real-time without code changes. Users should understand why a business was scored as eligible and be able to adjust thresholds via environment configuration.

## Decision

Implement a point-based scoring function (0-100, capped) with hard gates and additive signals. Hard gates (return 0 immediately if triggered):
- Not on NOF corridor (hard gate)
- Niche is MOBILE_MECHANICS (hard gate)
- License status is REVOKED (hard gate)

Additive point signals (each conditional):
- Priority corridor (Activating Priority): +30 points
- Standard eligible corridor (Activating Eligible): +20 points
- Eligible niche (Retail, Hospitality, Services): +15 points
- Incorporation age > 2 years: +10 points
- License status is ACTIVE: +5 points
- High digital deficit (no website, low review count): +15 points
- Revenue > $5,000 annually: +8 points
- Employees > 2: +7 points
- Reviews > 10 (Google/Yelp/Nextdoor): +5 points
- Active user-generated content (recent reviews, posts, or photos): +5 points

Sum signals, cap at 100. Threshold for NOF pitch: `nof_eligibility_score >= NOF_ELIGIBILITY_THRESHOLD` (configurable via environment, default 50).

Store `nof_eligibility_score` on Business model. Update score on data refresh and re-enrichment cycles. Expose score in API responses for transparency.

## Consequences

### Positive
- Transparent, explainable logic: users understand why a business is scored as eligible
- Configurable threshold allows A/B testing and tuning without code changes
- Hard gates prevent obvious mismatches (e.g., mobile mechanics, revoked licenses)
- Soft signals capture market strength (revenue, reviews, activity)
- Scores persist for audit trail and historical analysis
- Easy to adjust point values as program requirements clarify

### Negative
- Point values are heuristic, not data-driven (no training data at launch)
- Manual threshold tuning required; may need to experiment in production
- Hard gate on MOBILE_MECHANICS may be too aggressive; some owner-operated mobile mechanics do qualify
- Niche signals require maintaining a list of "eligible niches"; adds configuration burden

### Neutral
- Requires initial calibration; threshold should be monitored and adjusted quarterly
- Score signals depend on quality of enriched business data; gaps in data reduce signal confidence

## Alternatives Considered

1. **Binary eligible/not based only on corridor** — Check corridor eligibility only, no soft signals. Rejected because many corridor businesses won't qualify (no employees, pre-revenue, revoked license). Calling all corridor businesses wastes resources and hurts conversion rates.

2. **ML model** — Train logistic regression or tree model on historical grant applications. Rejected because insufficient training data at launch; LeadForge has no grant application history. Once 100+ applications are collected, revisit and consider ML upgrade (new ADR).

3. **Threshold-only, no hard gates** — Allow MOBILE_MECHANICS and revoked licenses to score based only on corridor + signals. Rejected because these are explicit program ineligibility criteria; hard gates prevent obviously wasted calls.

4. **Rule-based decision tree** — Hardcoded if-then-else for different business profiles. Rejected because becomes unmaintainable as rules grow; point system is more transparent and flexible.

5. **External pre-qualification** — Call out to City of Chicago NOF intake API for real-time eligibility check. Rejected because City does not provide such an API; in-house scoring is necessary.

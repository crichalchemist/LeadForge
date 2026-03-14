# ADR-020: NOF integration: grant-facilitated acquisition as parallel channel

## Status

Accepted

## Date

2026-03-14

## Context

LeadForge targets hyper-local small businesses on Chicago's South, West, and Southwest sides. The Neighborhood Opportunity Fund (NOF) is a City of Chicago DPD reimbursement grant up to $250K for commercial renovation on these exact corridors. Integrating NOF transforms the cold marketing pitch into "you may qualify for $250K in City funding" — a fundamentally warmer opening.

The grant program has a structured lifecycle: eligibility determination, intake, application, finalist selection, construction phases, and graduation. This is distinct from the marketing sales pipeline (scored, contacted, meeting, won) but shares the same business entity data and scoring infrastructure. A single business may pursue both channels simultaneously.

Treating NOF as a parallel acquisition channel (rather than merging it into the marketing pipeline) preserves the integrity of both processes and unlocks the strategic advantage of leading with grant availability to warm up the conversation.

## Decision

NOF is an additional acquisition channel parallel to marketing. A new `GrantApplication` model tracks the NOF lifecycle independently from `OutreachRecord`. Both link to the same `Business` entity. NOF-eligible businesses get a grant-first voice pitch; marketing upsell happens through the relationship built during grant facilitation.

The model separation is enforced at the API level: separate route groups for `/api/grants/applications` and `/api/outreach`, with independent state machines for NOF stages vs. pipeline stages. The CRM frontend has distinct pages for "Pipeline" (marketing) and "Grants" (NOF), allowing users to manage both channels for the same business without confusion.

## Consequences

### Positive
- Clear separation of concerns: grant and marketing lifecycles don't interfere
- Enables warm outreach ("you qualify for $250K") instead of cold spray ("get a website")
- Single business can be pursued via both channels without duplication or conflict
- Scoring infrastructure is shared; reduces code duplication
- Auditability: each pipeline has its own history and stage transitions

### Negative
- Increased API complexity: two separate state machines to maintain and test
- Schema complexity: new GrantApplication, GrantDocument, NOFStage, GrantFinancial tables
- UI requires users to understand two distinct pipeline concepts
- Potential for user confusion if grant and marketing stages are not clearly labeled

### Neutral
- Requires additional training/documentation on dual-pipeline workflow
- Grant and marketing metrics are tracked separately (no single funnel view unless explicitly built)

## Alternatives Considered

1. **Merge grant and marketing into single pipeline** — Track both as stages within OutreachRecord (e.g., "Scored", "Grant Applied", "Marketing Contacted"). Rejected because NOF stages are semantically different (Eligibility → Intake → Finalist), occur on different timelines, and have different stakeholders. Forced merge would create confusion and complex stage logic.

2. **NOF as standalone product** — Build grant facilitation as a completely separate product line with its own Business records. Rejected because it duplicates business data, breaks entity deduplication, and loses the opportunity to cross-sell marketing services to grant applicants.

3. **Single Business with flags** — Keep one Business record but add `is_nof_candidate`, `is_marketing_candidate` flags and union the pipelines in UI. Rejected because the fundamental stage progressions are incompatible; flags don't solve the state machine problem.

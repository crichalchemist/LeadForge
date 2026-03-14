# ADR-023: Dual pipeline CRM: independent GrantApplication and OutreachRecord tracks

## Status

Accepted

## Date

2026-03-14

## Context

A single business can simultaneously be in the marketing pipeline (OutreachRecord) and the grant pipeline (GrantApplication). These have fundamentally different stage progressions:

- **Marketing pipeline**: Sales-oriented (Scored → Contacted → Meeting → Won), governed by PipelineStage enum. Driven by sales rep actions and customer interest.
- **NOF grant pipeline**: Program-compliance-oriented (Eligibility → Intake → Applied → Finalist → Construction Phase 1-5 → Alumnus), governed by NOFStage enum. Driven by application completeness, City review cycles, and construction phases.

These pipelines have different stakeholders (sales reps vs. grant facilitators), different metrics (conversion rate vs. funding rate), and different workflows (quick sales cycle vs. 12-18 month grant cycle). Conflating them in a single state machine would create confusion, broken queries, and complex business logic.

The CRM must surface both pipelines independently while recognizing that a business can be in both simultaneously. Users need separate views, separate stage transition enforcements, and separate reporting.

## Decision

`GrantApplication` is a separate model with its own 13-stage NOFStage enum:
1. Eligibility (pre-intake assessment)
2. Intake (gathering business info, site visit scheduled)
3. Intake Completed (all documents collected)
4. Applied (submitted to City)
5. City Review (awaiting City decision)
6. Finalist (approved; construction planning begins)
7. Construction Phase 1-5 (active renovation work, phases tracked separately)
8. Project Completion (construction finished, final inspection)
9. Alumnus (graduate of program)
10. Declined (rejected by City)
11. Withdrawn (owner withdrew application)

Each GrantApplication tracks:
- Business ID (foreign key)
- NOF stage (NOFStage enum, enforced transitions)
- Created, Updated timestamps
- NOF program year (e.g., 2026)
- Estimated project cost, acquisition cost (for financial calculator)
- City application ID (once submitted)
- Notes, internal flags

`GrantDocument` model tracks the NOF checklist (14 required document types: Business License, Tax Return, Site Photos, Etc.) with status (Required, Pending, Submitted, Approved, Rejected) and upload URL.

Each `Business` model has:
- `outreach_records` (relationship to OutreachRecord for marketing)
- `grant_applications` (relationship to GrantApplication for NOF)

API routes are completely separate:
- `GET /api/grants/applications` — list all applications
- `POST /api/grants/applications` — create new application
- `PATCH /api/grants/applications/{id}` — update stage, cost, notes
- `POST /api/grants/applications/{id}/stage-transition` — enforce NOFStage transitions
- `GET /api/grants/applications/{id}/documents` — list required documents
- `POST /api/grants/applications/{id}/documents/{type}` — upload document

Frontend has separate pages:
- `/crm/pipeline` — marketing OutreachRecords, PipelineStage columns
- `/crm/grants` — GrantApplications, NOFStage columns, document checklist sidebar

Kanban boards use separate models. Stage transitions are enforced at the backend (e.g., can only move from Eligibility → Intake if intake documents are submitted).

## Consequences

### Positive
- Clean separation of concerns: grant and marketing logic don't interfere
- Stage transitions are type-safe (NOFStage vs. PipelineStage are distinct enums)
- Queries are simpler: "all marketing contacts" vs. "all grant applications" are unambiguous
- Users see clear UI distinction; no confusion about which pipeline owns a record
- Auditability: each pipeline has independent history and timestamps
- Easy to add grant-only features (document checklist) without polluting marketing schema

### Negative
- Schema complexity: two separate state machines, two separate models, two separate API routes
- Code duplication: similar CRUD operations for both pipelines
- UI complexity: users must understand and manage two distinct concepts
- Reporting complexity: no single "funnel" view without explicit aggregation logic
- Testing overhead: both pipelines must be tested independently

### Neutral
- Requires user training and documentation on dual-pipeline workflow
- Introduces new database tables and migration complexity
- Grant and marketing metrics are tracked separately by design

## Alternatives Considered

1. **Unified pipeline with flags** — Single OutreachRecord model with `pipeline_type` flag (enum: MARKETING, GRANT) and unified PipelineStage that covers both. Rejected because NOF stages (Intake, City Review, Construction) have no semantic match in sales (Contacted, Meeting); forced union creates invalid state combinations and complex transition logic.

2. **Separate Business records per pipeline** — One Business for marketing, another Business for the same entity's grant application. Rejected because duplicates all business data (name, address, phone), breaks deduplication, and prevents cross-selling (e.g., "this marketing prospect is also a grant applicant").

3. **Nested pipeline within single view** — One OutreachRecord with nested array of "milestones" (grant phases) that can be toggled on/off. Rejected because stage transitions have different validation rules, dates, and stakeholders; nesting doesn't solve the fundamental incompatibility.

4. **Grant as an OutreachRecord subtype** — Use single-table inheritance. Rejected because the schema diverges too much (14-stage enum vs. 4-stage, documents vs. notes, City ID vs. sales rep); inheritance adds query complexity without benefit.

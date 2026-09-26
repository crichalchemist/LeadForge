# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**The operator.** One person, working alone at a desk on a laptop. They run a small digital-marketing
and grant-facilitation practice aimed at small businesses on Chicago's South, West and Southwest
sides, and LeadForge is that practice's private prospecting system and CRM. The one operator holds
every job the product has: running discovery, reading scores, working the outreach board, and
working the NOF grant board. ADR-023 describes separate sales reps and grant facilitators; that is
the original design, not the current reality. The two boards stay separate because the pipelines
differ (see Brand Commitments), not because different people work them.

**Reviewers.** LeadForge is also a portfolio and research project. Reviewers reach it two ways: a
read-only `viewer` login on the live CRM, and the repository itself (code, the ADR vault in
`docs/vault/`, and the measured write-ups in `.claude/CLAUDE.md` and `scripts/`). Reviewers watch;
they never operate.

The small businesses being prospected never see the CRM. They meet LeadForge only through outreach.

## Product Purpose

Find under-digitized small businesses in Chicago from public data and rank them by how much they
stand to gain and how viable they are. Then carry each one through outreach to a signed engagement
for digital-marketing services, and, for businesses on a Neighborhood Opportunity Fund corridor,
through a City grant application. For the operator, success means the best-fit businesses surface
first and every ranking can be trusted. For a reviewer, success means the method is legible: they
can see where each number came from.

## Positioning

Three mechanisms, together:

- **The city's licence records are the universe.** Identity comes from the City of Chicago
  business-licence dataset (Socrata `r5kz-chrr`), keyed on the licence account and site. The
  candidate set is therefore every licensed storefront, including the ones with no online
  footprint, which are exactly the targets. A search engine's index cannot supply that set.
- **Scores refuse to guess.** Composite = 0.40 digital deficit + 0.35 viability + 0.25 competitive
  pressure, plus a price tier. Evidence comes from Google Places, accepted only when the name
  corroborates the licence within 200 m, and from an offline Overture Maps match. A false match
  counts as worse than no match, and a business that could not be measured is stored as unknown
  rather than scored with a default.
- **Grant first on NOF corridors.** Businesses inside the City's Neighborhood Opportunity Fund
  corridors (point-in-polygon against the City's own corridor layers) are approached about NOF
  renovation funding, up to $250K, before any marketing conversation (ADR-020).

## Operating Context

- A single desk session: run discovery for a zip code and niche, review the ranked lead table, open
  a lead to read its score breakdown and digital presence, and move cards on the two boards.
  Discovery is triggered by the admin-only `POST /api/discovery/run`, which nothing in the frontend
  calls yet.
- Fifteen niches, mapped to licence `business_activity` terms: barbershops, bars, beauty shops,
  beauty supply, lawn services, meat markets, mobile mechanics, nail salons, security services,
  septic services, smoke shops, tire shops, towing, used auto parts, veterinarians.
- Two independent pipelines, and one business can be in both. The **outreach** pipeline has 12
  stages (scored, queued, contacted, voicemail, engaged, meeting, proposal, negotiating, won, lost,
  disqualified, nurture) and runs on a sales cycle. The **NOF grant** pipeline has 13 stages
  (eligibility through construction phases to alumnus, or removed) and runs on a 12-18 month
  program-compliance cycle. The backend enforces the allowed transitions on both.
- Roles: `admin` is the operator, with full write access. `viewer` is for reviewers and is
  read-only.
- Deployment: frontend on Cloudflare Pages (https://leadforge-frontend-80u.pages.dev), API on
  Cloudflare Workers. The Python backend in `src/leadforge/` is the legacy reference implementation.

## Capabilities and Constraints

**Working today:** licence discovery with dedup on the licence account; name-corroborated Google
Places enrichment; the Overture overlay; NOF corridor membership decided at ingest; versioned score
rows that are never overwritten; the CRM pages (dashboard, ranked leads with zip and niche filters,
lead detail, outreach board, grant board with document checklist and financial calculator,
reports); and the post-call sentiment consumer.

**Designed but not working. Never describe these as live:**

- AI voice calls through Retell. The voice port to Workers has not been done, and in Python the
  agent prompt is built but never passed to Retell. No call has ever been placed.
- LLM outreach briefs. The module is ported and tested, but nothing calls it.
- TCPA business-line screening. `is_business_line` accepts any number with 10 or more digits, and
  mobile detection does not exist.
- Scoring beyond version 1. Viability and pressure need competitive context that is not built, and
  neither are the enrichment and recalibration consumers or the crons.

**Constraints future work must respect:**

- Unknown is not zero. A business whose lookup failed carries a null deficit and a null composite.
  A stored social flag of 0 is ambiguous: it means either "Overture matched and found no link" or
  "no match row, nothing known". The frontend must never render a null as 0 or as a default.
- Rating and review count exist only for Google-matched businesses; Overture carries neither.
- Stage transitions can be rejected by the backend, so the UI's optimistic moves must survive a
  rejection.
- **Viewer redaction: a confirmed requirement, NOT BUILT.** For the `viewer` role, business names,
  phone numbers and owner names are masked. Still undecided: whether email, street address, call
  transcripts and outreach-brief text are masked too. Open implication, not yet decided: masking
  only in the UI would not satisfy the requirement, because a viewer's token can call the Worker
  API directly.

**Terminology:** a *business* is the licence-identified entity; a *lead* is a business with a score.
*Composite acquisition score*, *digital deficit*, *viability*, *competitive pressure* and *price tier*
(1 premium, 2 standard, 3 economy) are the scoring vocabulary. *NOF* is the City of Chicago
Neighborhood Opportunity Fund, and a *corridor* is either eligible or priority. Corridor names are
synthesised (`Priority corridor <FID>`) because the City's layers carry no name attribute.

**Open decisions:** whether "LeadForge" is the permanent name (it was offered as a binding
commitment and not chosen); dollar pricing for tiers 1-3; the full field list for viewer redaction.

## Brand Commitments

- **Honest AI disclosure.** Nothing in the product hides that outreach calls are placed by an AI.
  The voice agent says so when asked.
- **Grant first on NOF corridors.** For an eligible business, the relationship opens with the grant
  and marketing follows. The outreach and grant pipelines stay distinct, and the product never
  flattens them into a single sales funnel.

## Evidence on Hand

Real, citable:

- Production D1 (measured 2026-09-26): 3 businesses, 0 outreach records, 0 grant applications,
  1 admin user, 0 viewer accounts.
- `overture_matches`: 23,571 rows, 10,166 of them matched, built city-wide.
- Measurements recorded in `.claude/CLAUDE.md`: the three-way enrichment-source comparison on 157
  licensed hair-service businesses in 60619; the licence dataset counts (113,383 rows, 23,969
  businesses); corridor discrimination (60619 at 76% and 60620 at 85% on-corridor, 60614 and 60611
  at 0%).
- 30 ADRs in `docs/vault/`; specs and plans in `docs/superpowers/`.
- Test suites (158 pytest, 601 vitest), enforced by CI on every push.

Absent. Future work must not fabricate any of these:

- Customers, clients, won deals, testimonials or case studies.
- Placed calls, call recordings or transcripts.
- Dollar prices for any tier.
- A logo, wordmark or any other brand asset.
- Filed or funded NOF applications.

## Product Principles

1. **Operator first, self-explaining always.** The tool serves one person's daily work, and nothing
   is added only to impress a reviewer. Every score, tier and stage shows how it was derived, and
   that legibility is also what a reviewer sees.
2. **Unknown is shown as unknown.** A missing measurement is never presented as a zero, a default
   or a guess. A false match is worse than no match.
3. **Grant first, and two pipelines.** On NOF corridors the grant relationship leads, and outreach
   and grant work stay separate tracks.
4. **Say it's an AI.** Outreach never passes itself off as human.
5. **Real data, masked for viewers.** Reviewers see the real system on real public data, with
   identifying fields masked. Nothing fictional stands in for it.

## Accessibility & Inclusion

The target is WCAG 2.2 AA (confirmed). No audit has been run. These are the gaps visible from the
code:

- `frontend/src` contains no ARIA attributes and no screen-reader-only text.
- Moving a card between stages works only by dragging, on both boards (`pages/Pipeline.tsx`,
  `pages/GrantPipeline.tsx`). No single-pointer alternative exists, which SC 2.5.7 (Dragging
  Movements) requires.

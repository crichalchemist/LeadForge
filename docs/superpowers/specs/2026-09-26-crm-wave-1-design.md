# CRM wave 1 — design

**Date:** 2026-09-26
**ADR:** 031, to be written with migration 0005 (provenance of enrichment facts)
**Status:** approved, not implemented
**Context:** `PRODUCT.md`, `DESIGN.md` ("The Loop Diagram"), `.impeccable/design.json`, and the direction
contract in `.impeccable/surfaces/frontend-src-pages-leads-tsx.md`

## Goal

Rebuild the CRM's core loop in the Loop Diagram world: plan a discovery run within its Places budget,
triage the ranked leads, open one lead and read every fact with the source that supplied it, put the
lead on the outreach line and move it between stations without dragging. Wave 1 ships the app shell,
Discovery, Leads and the lead record, plus the backend work those screens need.

Wave 1 is done when it runs locally against `wrangler dev` and the user has clicked through it. Nothing
merges before that.

## Why this wave exists

The frontend predates nearly every backend change since May: licence identity, name-corroborated
Google enrichment, the Overture overlay, NOF corridors at ingest, the deliberate null score. It shows
none of them, and its visual system is stock Tailwind that the user rejected. Five facts, measured on
2026-09-26, shape the work:

1. Discovery computes each Google candidate's name score and distance, keeps only the verdict, and
   discards the numbers (`api/src/lib/discovery.ts`, the corroboration block before `getPlaceDetails`).
2. Discovery overwrites the licence name with Google's (`enrichment.name ?? name`), so the city's own
   name for the business is lost.
3. No Workers code creates an `outreach_records` row, so no discovered business is on the outreach line.
4. `POST /api/discovery/run` returns `discovered` and `places` but no created, skipped or failed counts;
   dedup skips and per-business failures vanish.
5. Vite proxies `/api` to Python's port and strips the prefix, so local development cannot reach the
   Worker. `AuthProvider` also calls `fetch('/api/auth/me')` directly, bypassing the API client's base URL.

## Constraints that shaped the design

- **WCAG 2.2 AA is binding.** Every pairing in DESIGN.md is contrast-checked on both grounds; stage moves
  need a non-drag control (SC 2.5.7).
- **Unknown is shown as unknown.** A null renders as words, never as 0, a dash or a default.
- **Real data only.** The product never renders synthetic businesses. Test fixtures may, labelled as tests.
- **Old pages are deleted when their replacement ships**, never kept alongside it.
- **The Workers API mirrors the Python contract (ADR 026).** Additions are additive; no field changes meaning.
- **No paid lookups to fill history.** Rows stored before this wave keep what they have.

## Decisions

| Question | Decision |
|---|---|
| Build approach | Rebuild in place on React 18, Vite, Tailwind 3, React Query, axios. Tokens become CSS variables. |
| Themes | Enamel and porcelain. System setting by default; a System / Enamel / Porcelain toggle overrides it. |
| New runtime deps | `@fontsource/fira-sans`, `@fontsource/fira-sans-condensed`, `lucide-react` |
| New dev deps | `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `@playwright/test`, `@axe-core/playwright` |
| Outreach start | An admin "Start outreach" action creates the record at Scored |
| Provenance | Persisted at discovery; served by one read route that owns the source rules |
| Existing rows | No backfill; the record says "not recorded" |
| Local secrets | `wrangler dev --var`, never the tracked `api/.dev.vars` |

## Part 1 — backend

### Migration `0005_provenance.sql`

```sql
ALTER TABLE businesses ADD COLUMN license_name TEXT;

CREATE TABLE google_matches (
  business_id  TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN
                 ('matched', 'rejected_distance', 'rejected_name', 'no_candidate', 'unavailable')),
  place_id     TEXT,
  matched_name TEXT,
  score        REAL,
  distance_m   INTEGER,
  website      TEXT,
  phone        TEXT,
  looked_up_at TEXT NOT NULL
);
```

`google_matches` mirrors `overture_matches` so the two sources read alike. `website` and `phone` hold
Google's own values before any merge, which is what lets a fact be credited to the source that supplied
it. `api/test/helpers.ts` `resetDb` gains the new table.

### Discovery

- Store the licence name in `license_name` on every new row; `name` keeps its current behavior.
- For every Find Place candidate, compute the name score (`nameMatchScore`) and, when both sides have
  coordinates, the distance (`distanceMeters`), whether or not the candidate is accepted.
- Write one `google_matches` row per new business, in the same `DB.batch` as the business:
  - `matched`: corroborated; Details fetched; `website` and `phone` from Details.
  - `rejected_distance` / `rejected_name`: the rule that fired, with the score and distance recorded.
  - `no_candidate`: Google answered with no candidate (`ZERO_RESULTS`).
  - `unavailable`: any lookup for this business was refused — no key, denied key, quota, HTTP error —
    including a Details call after an accepted candidate. It takes precedence over every other status
    and matches the existing rule that stores a null deficit (`measured = lookups.unavailable === 0`).
    `findPlace` already tallies a missing key as unavailable. Score and distance are still recorded
    when a candidate came back.
- The response gains `created`, `skipped_known` and `failed`. Existing fields keep their meaning.

### New and extended routes

- **`GET /api/businesses/:id/provenance`** (`requireAuth`; viewers may read). Returns the licence record
  (`license_name`, `account_number`, `site_number`, `license_number`, `license_status`,
  `license_issue_date`), the `google_matches` row or `null`, the `overture_matches` row joined on account
  and site or `null`, and a `facts` list of `{ key, value, sources }`. The source rules live here and only
  here, under one principle: **a source is credited for a fact only when its recorded value equals the
  value the record displays.** Displayed values come from the stored business, where the merge put
  Google's value first and Overture's second (`base.website_url ?? website`, `base.phone ?? phone` in
  `lib/overture.ts`). Overture values are compared after the same `overturePresent` trim the merge applies.
  - `name`: `license` when `name` equals `license_name`; otherwise `google`, because Google's Details
    name is the only other value discovery writes there. Rows without a `license_name` get no source.
  - `website`, `phone`: `google` when the Google row's value equals the displayed one; `overture` when
    the Overture row's value does. Both apply only when both sources returned the same value.
  - `google_business_profile`, `rating`, `review_count`: `google` when the Google row is `matched`;
    Google is the only writer of these columns.
  - `facebook`, `instagram`: `overture` when the Overture row is matched and its flag is set; Google
    never sets them.
  - `license_status`: `license`.
  - A displayed value that no recorded source accounts for, which covers every row stored before
    migration 0005, gets empty `sources`, and the record shows "source not recorded".
  - 404 for an unknown business.

  `google_matches.matched_name` records the Find Place candidate's name, the one the score was computed
  against; `website` and `phone` record what Details returned, before the merge.
- **`POST /api/outreach`** `{ business_id }` (`requireAuth` + `requireAdmin`). Creates an outreach record
  at `scored` and returns it with 201. Returns 409 when the business already has a record (the table
  has no uniqueness, so the route guards it) and 404 for an unknown business.
- **`GET /api/pipeline/transitions`** (`requireAuth`). Returns `VALID_TRANSITIONS` from
  `api/src/lib/stages.ts`, so the frontend never keeps a second copy of the rules.
- **`GET /api/leads/ranked`** items gain `score_version`, `in_nof_corridor`, `nof_corridor_name`,
  `account_number` and `site_number`.

## Part 2 — frontend foundations

- **Tokens.** `src/styles/tokens.css` defines DESIGN.md's colors, type and radii as CSS custom
  properties in an enamel set and a porcelain set. `prefers-color-scheme` selects the set unless
  `data-theme` on `<html>` overrides it. `tailwind.config.js` maps semantic names onto the variables:
  `ground`, `raised`, `seam`, `edge`, `text`, `dim`, `focus`, `error`, `plate`, `line-outreach`,
  `line-grant`, `service`. Components never name a hex value.
- **Theme choice.** `system`, `enamel` or `porcelain`, stored in `localStorage` (wrapped in try/catch)
  and applied by an inline script in `index.html` before first paint.
- **Browser surfaces.** Selection, caret, focus ring, scrollbars and underline offset take theme values.
- **Type and icons.** Fira Sans 400/500/600 and Fira Sans Condensed 500/600 through Fontsource; Lucide
  icons in one stroke weight; station ticks, rings and lines drawn as SVG.
- **Local development.** Vite proxies `/api` to `http://localhost:8787` and keeps the prefix. `AuthProvider`
  loads the user through the API client.
- **Client.** `src/api/client.ts` gains typed `runDiscovery`, `fetchProvenance`, `startOutreach` and
  `fetchTransitions`; the refresh call is exempt from the 401 interceptor so a failed refresh cannot loop.
- **Shell and routes.** `/` redirects to `/leads`. `AppLayout` becomes the line rail: Leads and Discovery
  (new), then Dashboard, Pipeline, Grants and Reports (old, ordinary stations), then Map as planned track.
  The rail's foot holds the theme toggle and the signed-in user.
- **Components** in `src/ui/`: `LineRail`, `ThemeToggle`, `Plate`, `TransferButton`, `SourceBullets`,
  `PlannedMark`, `SuspendedTick`, `StripMap`, `RouteRow`, `ScoreSegments`. `StripMap` keeps its SVG
  styling in a colocated CSS file.
- **One formatter.** `src/lib/measure.ts` renders every measured value; `null` becomes "not measured" or
  "not recorded", never a number.

## Part 3 — screens

### Discovery (`/discovery`, new)

- Form: zip code, niche (the 15 from `api/src/lib/stages.ts`), limit 1-20 (default 10).
- Before the run, an amber service plate: "Up to {2 × limit} Places calls", beside "Places allows 1,000 a day".
- The screen's one scarlet plate: **Run discovery**. In flight it reads "Running…" over a skeleton report.
- The service report: created, skipped as already known, failed; an amber notice when
  `places.unavailable > 0` ("{n} lookups went unanswered ({last_status}); those businesses are stored
  unmeasured"); the created businesses as route rows linking to their records.
- A finished run invalidates the ranked-leads query. Viewers see "Runs are admin-only" and no plate.

### Leads (`/leads`, `/leads/:id`; replaces `Leads.tsx` and `LeadDetail.tsx`)

- Title, zip and niche filters, and the one plate **Plan a run** (admin only), which opens Discovery.
- The ranked table as route rows: rank; the label grid (name, then niche · zip · licence account in that
  order); the composite in tabular figures with a dashed "v1 · preliminary" tag, or a suspended tick
  reading "not measured"; line bullets; the interchange mark for corridor businesses.
- Filters and page live in the query string. Page size 50.
- At 1200px and wider, `/leads/:id` keeps the list in five of twelve columns and opens the record in
  seven. Narrower, the record replaces the list and a back link returns focus to the same row.
- Empty state: "A discovery run looks up licensed businesses for one zip code and niche and puts them
  here," with the plate for admins.

### Lead record

Data: the business detail, the provenance route, and the transitions map (cached for the session).

- **Header:** the business name; the label grid; the licence name with its L bullet when it differs.
- **Strip map:** without an outreach record, the outreach line is planned track ("Not on the outreach line
  yet") and the plate is **Start outreach**. With one, the current station is ringed and each allowed
  next station is a transfer button. A corridor business shows the interchange and the grant line as
  planned track ("Grant line: not started · {corridor}").
- **Score:** the composite and its version inline, never as a big-number tile. Score segments size the
  three terms by weight (40 / 35 / 25); an unmeasured term is a dashed, named segment. A null composite is
  a suspended line with its reason: "Places was unavailable during discovery" when the Google row says
  `unavailable`, "not recorded" when the business predates migration 0005 and has no Google row. A
  rejected or absent candidate still yields a measured deficit, so it never produces a null composite.
- **Evidence:** one row per provenance fact: value, source bullets, one detail line. Wording separates
  "none found" (measured) from "unknown" (not measured).
- **Sources:** City licence (account and site, licence number, status, issue date); Google (verdict in
  words, matched name, name score, distance); Overture (match, name, score, distance, build date).
- **Planned track:** "Outreach briefs: not running yet" and "AI calls: not running yet".
- Start outreach and transfers invalidate the business and ranked-leads queries.

## Part 4 — states, errors and roles

- Loading renders skeleton rows and regions, never a spinner inside content.
- A failed request becomes an inline message in its region that names the problem and offers Retry.
- 401: refresh, retry once, then the login screen. 404 on a lead: "This lead isn't in the system" with a
  way back. 409 on Start outreach: refetch and show its station. 422 on a transfer: name the allowed
  stations and refetch. 403: "Only an admin can do this."
- Discovery 422 marks the fields; a 500 or network failure reads "The run stopped. Businesses already
  stored are skipped next time, so a retry only spends Places calls on the rest."
- Viewers get every read; write controls (Plan a run, Run discovery, Start outreach, transfers) are
  absent, not disabled. Redaction is out of scope; no viewer accounts exist.
- The theme toggle is a three-option radio group, keyboard-operable.
- The route trace is the one authored motion, 220ms, and instant under `prefers-reduced-motion`.
- Route rows are focusable and open on Enter; returning from a record restores focus to its row.

## Testing

**API** (vitest on `@cloudflare/vitest-plugin`, existing harness):
- Migration 0005 applies; `google_matches` cascades with its business.
- Discovery records each verdict with its numbers (matched, rejected on distance, rejected on name, no
  candidate, unavailable), stores `license_name`, and counts created, skipped and failed.
- The provenance route applies each source rule, admits viewers, and returns 404 for an unknown id. It
  must credit only Google when Google and Overture return different websites, both when they return the
  same one, and neither for a pre-0005 row.
- `POST /api/outreach`: 201 at `scored` for an admin, 403 for a viewer, 409 on a duplicate, 404 unknown.
- The transitions route returns exactly `VALID_TRANSITIONS`; ranked leads carry the new fields.

**Frontend** (vitest, Testing Library, jsdom): mocks only `src/api/client.ts`, the HTTP boundary. Tests
are named for outcomes: an unmeasured lead never shows a number; a version-1 score is labelled
preliminary; source bullets match the provenance facts; transfers offer only allowed stations; viewers
see no write controls; the theme follows the system until overridden and the override persists; the
discovery estimate is twice the limit; the report separates skipped from created; a failed refresh does
not loop.

**Browser** (Playwright, Chromium): against `wrangler dev` with a migrated local D1, a test-only seed
(synthetic names marked as test data, a test admin), and the Vite dev server. The core loop: sign in,
Leads, open a record and see its sources, Start outreach, transfer to Queued, reload with the theme
choice intact. Discovery shows its estimate, then runs against an intercepted `/api/discovery/run`, so
CI never calls Socrata or Google. `@axe-core/playwright` checks each screen in both themes. The run
captures `desktop.png` and `mobile.png` into `.impeccable/review/`.

**CI:** the frontend job adds `npm test`. A new `e2e` job runs Playwright on every push, outside `main`'s
required checks until it proves stable. Known risk: `wrangler dev` with the Workers AI binding may need
remote credentials; the plan confirms a local-only configuration before the job lands.

## Finish

1. Run `impeccable detect` once over the changed UI files; fix what is mechanical.
2. A fresh `impeccable-finish-reviewer` audits the build against the direction contract and captures.
3. Reconcile DESIGN.md with what was built; update `.claude/CLAUDE.md` and the operations guide (local
   development now targets the Worker; the new routes; the e2e job).
4. The user clicks through locally. Merge follows their approval.

## Out of scope (wave 2 and later)

The home screen (needs-attention queue and both lines as diagrams), the map room, rebuilding the boards,
grants and reports, viewer redaction, AI calls, outreach briefs, TCPA screening, scoring beyond version
1, and any backfill of rows stored before migration 0005.

When viewer redaction is built, it must cover the provenance route too: that route returns the licence
account and site, Google's matched name, and the raw website and phone from both sources.

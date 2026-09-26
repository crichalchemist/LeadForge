---
version: 1
slug: "frontend-src-pages-leads-tsx"
primary_target: "frontend/src/pages/Leads.tsx"
related_targets: ["frontend/src/pages/LeadDetail.tsx","frontend/src/components/layout/AppLayout.tsx"]
---

# Surface brief: CRM core loop (wave 1)

Mode: Operate. The ranked leads screen is the wave-1 landing route; this brief governs the rebuilt app
shell, Discovery runs, Ranked leads and the Lead record. Wave 2 (home = needs-attention queue plus both
pipelines drawn as lines, the corridor map room, grants detail, reports) inherits the same world.

## Audience, job, constraints

- The solo operator at a desk: plan a discovery run within its Places budget, triage the ranking, read
  one lead's evidence with its sources, and move it along either pipeline without dragging.
- Reviewers see the same screens through the `viewer` role; redaction is Worker API work, not styling.
- Real data only: 3 businesses in production today, up to ~24k licensed businesses city-wide, 0 outreach
  and 0 grant records. Empty states teach; nothing synthetic ever renders.
- Wave 1 includes backend work: a provenance read route (licence + Overture joined on the licence
  account) and persisting Google's name-match score and distance at discovery.
- Two themes, dark enamel and porcelain daylight, sharing the line inks.

## Direction contract

THESIS: LeadForge is a transit system: both pipelines are lines, every stage a station, grant-first an
interchange, and anything unmeasured or not yet running is drawn as planned track, never as solid line.
It refuses the admin-template arrangement of stat tiles over pastel kanban columns.

OWN-WORLD: Midnight enamel ground (porcelain in daylight), porcelain station ticks, one line ink per
meaning (cobalt outreach, green grant, amber discovery), a single scarlet action plate per screen,
lines bending only at 45 and 90 degrees, Fira Sans Condensed station labels over Fira Sans tabular data,
lettered source bullets (L, G, O) on every fact.

STORY: The operator plans a service (zip + niche, worst-case Places calls shown first), reads the service
report, triages riders in rank order, opens one lead and sees its route, its measured and suspended
signals with sources, then transfers it to its next station by explicit control.

FIRST VIEWPORT: Line-rail nav at the left edge; the Leads title with filters and the one scarlet "Plan a
run" plate on one row; the ranked table filling the width, each row a station on a vertical route line
with its label grid, tabular composite, source bullets and line bullets. Selecting a row opens the lead
record beside the list, its strip map at the top.

FORM: Midnight transit diagram (catalog challenger, bolder re-roll 1, chosen by the user over the roll's
leader and their own steer); grounded list position 4 (CTA-style diagram) in round 1. Seed key 8a5e1665.
Signature interaction: selecting a lead traces its route, the line drawing from origin to its current
station while other lines dim.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Unresolved

- DESIGN.md is written before the build at the user's request and reconciled at finish; divergence
  found mid-build is resolved by editing DESIGN.md deliberately.
- New dependencies to approve at build time: self-hosted Fira Sans + Fira Sans Condensed, Lucide icons.
- The map room draws corridors from the bundled polygons; whether to add any basemap is undecided and
  must never assume paid tiles.

---
name: LeadForge
description: Chicago's licence records run as a transit system, two pipelines drawn as lines and every fact carrying its source.
colors:
  midnight-enamel: "#0B1230"
  enamel-raised: "#131C45"
  enamel-rule: "#2B3769"
  enamel-edge: "#7C87AA"
  porcelain: "#F2F0EA"
  porcelain-dim: "#A9B1CB"
  porcelain-ground: "#F5F6F8"
  porcelain-raised: "#FFFFFF"
  porcelain-rule: "#D7DCE6"
  porcelain-edge: "#7A849E"
  ink-dim: "#4A5578"
  scarlet: "#D71A2A"
  scarlet-deep: "#B8141F"
  scarlet-light: "#FF7A7A"
  plate-text: "#FFFFFF"
  cobalt-line-dark: "#3D74FF"
  cobalt-line-light: "#1E5BFF"
  cobalt-ink-dark: "#8FAEFF"
  cobalt-ink-light: "#1A4BD6"
  green-line-dark: "#22B14C"
  green-line-light: "#178A3C"
  green-ink-dark: "#62D38A"
  green-ink-light: "#11702F"
  amber: "#FFC20E"
  amber-line-light: "#B07A00"
  amber-ink-light: "#7A5300"
typography:
  display:
    fontFamily: "Fira Sans Condensed, Fira Sans, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Fira Sans Condensed, Fira Sans, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Fira Sans Condensed, Fira Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.02em"
  body:
    fontFamily: "Fira Sans, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "Fira Sans, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.4
    fontFeature: "tnum"
  label:
    fontFamily: "Fira Sans Condensed, Fira Sans, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  plate: "4px"
  control: "6px"
  region: "10px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.scarlet}"
    textColor: "{colors.plate-text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.scarlet-deep}"
    textColor: "{colors.plate-text}"
  button-primary-disabled:
    backgroundColor: "{colors.enamel-rule}"
    textColor: "{colors.porcelain-dim}"
  button-secondary:
    textColor: "{colors.porcelain}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.enamel-raised}"
    textColor: "{colors.porcelain}"
  button-secondary-disabled:
    backgroundColor: "{colors.enamel-rule}"
    textColor: "{colors.porcelain-dim}"
  input-field:
    backgroundColor: "{colors.enamel-raised}"
    textColor: "{colors.porcelain}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  nav-item:
    textColor: "{colors.porcelain-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  nav-item-active:
    textColor: "{colors.porcelain}"
  source-bullet:
    textColor: "{colors.porcelain}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    size: "18px"
  station-tick:
    backgroundColor: "{colors.porcelain}"
    rounded: "{rounded.full}"
    size: "10px"
  service-plate:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.midnight-enamel}"
    typography: "{typography.label}"
    rounded: "{rounded.plate}"
    padding: "4px 8px"
  route-row:
    textColor: "{colors.porcelain}"
    typography: "{typography.data}"
    padding: "10px 16px"
    height: "52px"
---

# Design System: LeadForge

## Overview

**Creative North Star: "The Loop Diagram"**

LeadForge is drawn as a transit system. The outreach pipeline is a line, the NOF grant pipeline is a
second line, every stage is a station, and a business sitting on a City corridor meets both lines at an
interchange where the grant line leads. The grammar is the metropolitan rail diagram fired in enamel:
disciplined lines that bend only at 45 and 90 degrees, station ticks knocked out of the
ground, one ink per meaning, and labels set at a fixed size so the network reads the same everywhere. It
is borrowed grammar, not borrowed identity: the marks, names and colors are LeadForge's own.

The diagram's honesty is the point. A transit map distinguishes service that runs from service that is
planned or suspended, and LeadForge uses exactly that vocabulary for evidence: a version-1 score, a
feature that does not run yet and a value nobody measured are drawn as planned or suspended track,
dashed or hollow and named in words, never as a solid mark or a zero. Every fact in a lead's record
carries lettered source bullets the way a station lists the lines that serve it. Density is welcome;
this is an operator's tool, and the ranking is a long table read at a desk.

Two grounds carry one world. Midnight enamel is the native ground; porcelain tile is the daylight ground
for long desk sessions. The line inks are shared and tuned per ground so every pairing holds WCAG 2.2 AA.
Confirmed rejections: the generic SaaS admin template (stat tiles over pastel kanban columns), and
confidence the data has not earned (bold numbers and clean charts that hide what is unmeasured).

**Key Characteristics:**
- Pipelines are lines, stages are stations, grant-first is an interchange.
- Planned and suspended marks stand for anything preliminary, unmeasured or not running.
- One ink per meaning; one scarlet action plate per screen.
- Lettered source bullets (L, G, O) on every fact in the lead record.
- Condensed station labels over tabular data, one type family throughout.
- Flat enamel: depth from tone and seams, never from decoration.

## Colors

A restrained system on two grounds: neutrals in enamel and porcelain, three line inks that each own one
meaning, and a single scarlet reserved for action.

Components never name a hex value. Each theme publishes the palette as roles, and every surface names a
role: `ground`, `raised`, `seam`, `edge`, `text`, `dim`, `focus`, `error`, `plate`, `plate-deep`,
`on-plate`, `service-plate`, `on-service-plate`, and for each line a `line-*` role (strokes, bars, ticks)
and an `ink-*` role (text that names the line): `line-outreach`/`ink-outreach`, `line-grant`/`ink-grant`,
`line-service`/`ink-service`. The line/ink split is load-bearing: a stroke meets 3:1, text meets 4.5:1,
and on enamel the two are different colors.

### Primary
- **Scarlet Plate** (`scarlet`, role `plate`): the filled primary action, at most one per screen, always
  lettered in **Plate White** (`plate-text`, role `on-plate`). Hover deepens to **Scarlet Deep**
  (`scarlet-deep`, role `plate-deep`), which also sets error text on the porcelain ground. On enamel,
  error text uses **Scarlet Light** (`scarlet-light`). Scarlet means "act" or "attention"; it is never a
  line.

### Secondary
- **Cobalt Line** (`cobalt-line-dark` on enamel, `cobalt-line-light` on porcelain; role `line-outreach`):
  the outreach pipeline. Its track, its current-station ring, its planned stations and its line bullet.
  Text that names the outreach line uses the ink variants (`cobalt-ink-dark`, `cobalt-ink-light`; role
  `ink-outreach`).

### Tertiary
- **Grant Green** (`green-line-dark`, `green-line-light`, role `line-grant`; text `green-ink-dark`,
  `green-ink-light`, role `ink-grant`): the NOF grant pipeline and the interchange where a corridor
  business meets it.
- **Service Amber** (`amber` on enamel; `amber-line-light` and `amber-ink-light` on porcelain; roles
  `line-service`, `ink-service`, `service-plate`): discovery runs, the Places-call budget and service
  notices. As a filled plate it always carries `midnight-enamel` text (role `on-service-plate`), on either
  ground. Wave 1 uses only the plate; the service line and ink roles are published for the runs history.

### Neutral
| Role | Enamel ground | Porcelain ground |
|---|---|---|
| `ground` | **Midnight Enamel** `midnight-enamel` | **Porcelain Tile** `porcelain-ground` |
| `raised` (rail, hovered and selected rows, inputs) | **Raised Enamel** `enamel-raised` | **Glazed White** `porcelain-raised` |
| `seam` (decorative divider, disabled fill) | **Enamel Seam** `enamel-rule` | **Grout Line** `porcelain-rule` |
| `edge` (control edges, route lines, neutral planned track) | **Enamel Edge** `enamel-edge` | **Tile Edge** `porcelain-edge` |
| `text` | **Porcelain** `porcelain` | **Midnight Enamel** `midnight-enamel` |
| `dim` (secondary text, dimmed ticks and lines) | **Dim Porcelain** `porcelain-dim` | **Faded Enamel** `ink-dim` |
| `focus` | `porcelain` | `midnight-enamel` |
| `error` | `scarlet-light` | `scarlet-deep` |

Every text pairing above measures at least 4.5:1, and every line ink and control edge at least 3:1, on
both the ground and the raised region of its theme. Seams sit near 1.3-1.6:1 on purpose: they separate
regions and never identify a control.

Theme selection follows the system by default. A three-way toggle (System, Enamel, Porcelain) overrides
it and is stored per viewer; System is stored as the absence of a pick. The page always carries the
RESOLVED theme, enamel or porcelain, never "system": a script in the document head resolves it before
first paint so neither ground ever flashes the other, and while the pick is System the page follows the
operating system as it changes. Each theme also sets the browser's own color scheme (dark for enamel,
light for porcelain).

### Named Rules
**The Line Owns Its Ink Rule.** Cobalt is outreach, green is grant, amber is discovery. A line ink never
decorates, never marks a generic state, and never appears on a surface that is not about its line.

**The One Plate Rule.** A screen has at most one scarlet filled action. Everything else is a secondary
button, a link, or a transfer control. When a lead record opens beside the list, the record owns the
plate (Start outreach) and the list's "Plan a run" steps down to a secondary link.

**The Never Color Alone Rule.** Every state a color marks is also marked by shape, pattern or words: line
bullets carry the station's name, planned track is dashed, suspended stations are hollow, and a disabled
control says why or is drawn from different roles, never only fainter.

**The Palette Disabled Rule.** A disabled plate or secondary control is drawn from the palette's roles,
a `seam` fill with `dim` lettering, never by lowering the opacity of its live colors.

## Typography

**Display Font:** Fira Sans Condensed (with Fira Sans, system-ui), self-hosted at 500 and 600
**Body Font:** Fira Sans (with system-ui), self-hosted at 400, 500 and 600

**Character:** One humanist superfamily in two widths. The condensed cut is the signage voice: station
names, section heads, buttons and column labels, set at fixed sizes the way a diagram fixes its labels.
The regular width carries reading text and every number, always with tabular figures so columns align.

### Hierarchy
- **Display** (condensed 600, 2rem, 1.1, -0.01em, mixed case): the screen title only, one per route.
  Never a hero headline.
- **Headline** (condensed 600, 1.5rem, 1.2, mixed case): a lead record's business name.
- **Title** (condensed 600, 1.125rem, 1.3, +0.02em, capitals): region heads such as "Route", "Score",
  "Evidence" and "Sources", and the rail's name.
- **Body** (400, 0.9375rem, 1.5): notes, explanations and empty-state teaching copy, at most 65ch.
- **Data** (500, 0.9375rem, 1.4, tabular figures): scores, counts, call budgets, distances, dates.
- **Label** (condensed 500, 0.8125rem, 1.2, +0.06em, capitals): station names, column and field labels,
  buttons, the label grid's second line, line bullets and source bullets.

### Named Rules
**The Size Carries No Voice Rule.** A size role sets size, line height, weight and tracking only. The
condensed family, capitals and tabular figures are each applied explicitly beside it, so a station label
is always condensed family + label size + capitals, a region head condensed + title size + capitals, a
screen title condensed + display size, and a score data size + tabular figures. A label size without the
condensed family is a defect, not a variant.

**The Fixed Label Rule.** Station and column labels keep one size everywhere; hierarchy comes from the
line and its position, never from enlarging a label.

**The Tabular Rule.** Every number that can sit in a column sets in tabular figures, on screen and in
tables alike.

## Layout

A left line rail and a working field. The rail is a raised region with a seam on its inner edge, sticky
at full height from 900px, and it has three widths:
- **1200px and wider:** 240px, listing destinations as stations on a 2px vertical line with icons and
  names, the theme toggle and the signed-in operator below.
- **900px to 1199px:** a 64px column of ticks and icons. Names become screen-reader text and
  appear beside the icon on keyboard focus, floating over the page; the rail's name shortens to "LF" and
  the theme toggle stacks its three icons.
- **Below 900px:** a top bar with a menu control that opens the stations as a list beneath it.

Nothing shrinks the network into an unreadable miniature: a narrow screen shows one line at a time and
keeps its transfer context.

The core loop is master-detail. At 1200px and wider with no record open, the ranked list fills the
width, and its first row holds the screen title, the filters and the "Plan a run" plate at the far end.
With a record open, the list holds five of twelve columns (a seam on its right) and the record seven.
Below 1200px the record replaces the list, a "Back to leads" control returns to it, and focus lands on
the row the record was opened from. Tables run full width with no max width; prose holds at 65ch.

Spacing runs on a 4px base (`xs` 4 to `3xl` 40). Screens pad 24px by 32px, widening to 40px at the
side from 1200px. Groups are tight (`sm`, `md`), a record's regions are separated by `3xl`, and a
heading always has more space above it than below. Density is the default: route rows are at least 52px.

## Elevation & Depth

Flat enamel. Depth comes from tone (the raised region against the ground) and from seams, never from
stacked shadows. The only shadow belongs to something that genuinely floats: in wave 1 that is the
condensed rail's station name shown on focus (full values per theme in the sidecar). Nothing glows.

A station tick's 2px ring in the ground color is not a shadow. It is the transit diagram's knockout, the
gap that separates a station from the line running through it, and it takes the color of whatever
surface the tick sits on.

### Named Rules
**The Flat Enamel Rule.** Surfaces rest flat. A cast shadow appears only on something that floats above
the page, and a region is never a card inside a card. A tick's ground-colored knockout ring is part of
the mark, not elevation.

## Shapes

Lines bend only at 45 and 90 degrees. The strip map's line is a 4px stroke with round ends;
the route line threading the ranked list and the rail's line are 2px in the `edge` role. Station ticks
are 10px discs knocked out of the ground by a 2px ring; the current station and the interchange are a
14px hollow ring with a 3px stroke. Planned track is dashed 6/4 with hollow 10px ticks bordered 2px. A
suspended station is a hollow tick with the line broken on either side of it, drawn in the `edge` role
beside the words for its reason.

Corners are modest and consistent: 10px for regions, 6px for controls, 4px for plates, and full rounds
for bullets and ticks. Borders are 1px.

### Named Rules
**The 45/90 Rule.** No drawn line bends at any angle but 45 or 90 degrees, and no line is drawn freehand.
Wave 1 draws only straight runs and right-angle turns.

**The Planned Track Rule.** A version-1 score, a value never measured and a feature that does not run
yet are drawn dashed or hollow and named in words. None of them ever renders as a solid mark or a zero.
Neutral planned marks dash in the `edge` role; a line's own planned track dashes in its `line-*` role.

## Components

### Buttons
- **Shape:** gently squared (6px), 36px tall.
- **Primary:** the Scarlet Plate, `on-plate` label-type capitals, 16px side padding. A plate that
  navigates carries a trailing arrow icon. One per screen.
- **Hover / Focus:** hover deepens to Scarlet Deep over 150ms on the exponential ease-out; focus draws a
  2px outline at 2px offset in the `focus` role.
- **Disabled:** `seam` fill with `dim` lettering and a not-allowed cursor (The Palette Disabled Rule). A
  form plate arrives enabled and validates on submit rather than arriving disabled.
- **Secondary:** transparent with a 1px `edge` border, 15px side padding and a `text` label; hover fills
  with the raised region. Disabled, it becomes the same flat `seam` tile with `dim` lettering.
- **Transfer:** the stage-move control. A secondary button naming the destination station ("Transfer to
  Engaged"), one per transition the backend allows. Dragging is never the only way.

### Chips
- **Source bullets:** 18px roundels with a 1px `text` border holding one condensed letter: L (City
  licence), G (Google Places), O (Overture), always in that order, with the source's name for screen
  readers and on hover. They follow the licence name in a record's header, every fact in Evidence and
  Sources, and the measured digital-deficit term. Wave 1's ranked rows carry none.
- **Line bullets:** a 4px by 12px rounded bar in the line's `line-*` role plus the station name in its
  `ink-*` role, condensed label capitals.
- **Interchange mark:** the 14px ring in the `text` role plus "NOF corridor" in `ink-grant`.
- **Planned mark:** a 24px dash (2px, 6/4) plus words in `dim`, such as "v1 · preliminary" or "not
  measured". The dash is `edge` unless it stands for a line's own planned track, when it takes that
  line's role.
- **Service plate:** an amber plate with enamel text for run budgets and service notices, 4px corner.

### Cards / Containers
- **No cards.** Regions are separated by seams and space. A record's regions (Route, Score, Evidence,
  Sources, Planned) are headed sections on the ground; fact lists are rows divided by seams. Nothing
  nests inside another container.

### Inputs / Fields
- **Style:** raised fill, 1px `edge` border, 6px corner, 36px tall, 12px side padding, body type. The
  label above is condensed label capitals in `dim`.
- **Focus:** the border becomes `text` and the focus ring appears at 2px offset.
- **Error:** an invalid field's border takes the `error` role and a message in `error` beneath it names
  the fix. A form that validates turns off the browser's own validation bubbles and marks the field
  inline, the same way a server rejection is marked.
- **Select:** drawn as the other inputs, with the browser's arrow removed and a 16px chevron icon in the
  `text` role at the right.

### Navigation
- **The line rail:** destinations are stations on one 2px `edge` line, each with its tick, a 16px icon
  and a condensed label in `dim`. The current station wears the 14px `text` ring and its label turns
  `text`; others keep 10px `dim` ticks. Hover brings the label to `text`; there is no background fill.
  A destination not built yet (Map) is drawn as planned track: a dashed hollow tick, never a link, with
  "planned, not built yet" for screen readers.
- **Theme toggle:** a radio group in a 1px `edge` frame; the chosen option inverts (`text` fill, `ground`
  lettering) on a 4px corner. Arrow keys move between options.

### Strip Map (signature)
A lead's route, drawn vertically under the record's "Route" head, stations top to bottom at 12px
intervals with condensed label names.
- **Interchange:** for a corridor business, the 14px `text` ring sits on the line's axis one step above
  the first station, grant first. The grant line leaves it at a right angle as a short 4px dashed stub,
  planned track because grant work does not run yet, with "NOF corridor" and "Grant line: not started ·
  <corridor>" beside it.
- **Unstarted lead:** the whole outreach route (Scored to Won) is planned track: one dashed 6/4
  `line-outreach` stroke through every station, hollow `line-outreach` ticks, names in `dim`, and
  nothing traced. The grant stub is `line-grant` with its label in `ink-grant`. Beneath the route, a
  planned mark in the outreach tone reads "Not on the outreach line yet", and Start outreach is the
  record's plate.
- **On the outreach line:** the track travelled from Scored to the current station is solid
  `line-outreach`; the track and stations ahead are dashed `line-outreach` planned track with hollow
  `line-outreach` ticks. Passed stations are solid 10px `text` discs. The current station is the 14px
  ring stroked in `line-outreach`, its name in `text` followed by "· current". An `edge` stroke joins the
  interchange to the first station. Transfer controls follow the line.
- **Branch stations:** Voicemail branches off Contacted, so the line is travelled to Contacted and the
  current station sits alone in an "Off the main line" list beneath. Lost, disqualified and nurture can
  follow from several stations and the record does not store which, so the main line shows nothing
  travelled and the current station sits in the same "Off the main line" list.
- **Dim rule:** while a lead rides the outreach line, the grant stub and its label take the `dim` role,
  statically, so the traced route leads.
- **Trace:** on opening a record whose lead is on the outreach line, the travelled track draws from
  origin to the current station in 220ms on an exponential ease-out; under reduced motion it simply
  appears. Planned track never traces, because nothing has travelled on it.

### Route Row (signature)
Each ranked lead is a station on a 2px `edge` route line threading the list. In order: the rank in
tabular `dim`; the station tick (10px `text` disc); the label grid, business name in `text` then
"Niche · zip · Account n-s" in condensed label capitals in `dim`, the account never breaking inside
itself; then the cluster: the interchange mark for a corridor business, the outreach line bullet when
the lead has a stage, and the composite in tabular data type with a "v1 · preliminary" planned mark for
a version-1 score, or a suspended tick and "not measured" when the composite is unmeasured, never a
number. Hover and the selected row fill with the raised region.

The licence account is always called "Account", never "Licence": the licence number is a different
identifier and appears only in Sources.

With a record open beside it, the row is compact: three columns, the cluster moved under the label grid
and wrapping, and the name wrapping rather than truncating so the selected lead stays readable. Every
non-selected row's tick takes the `dim` role while its text stays at full contrast for triage.

### Score Segments (signature)
The composite drawn as one 4px line in three segments sized by weight (40 digital deficit, 35 viability,
25 competitive pressure) with 4px gaps. A measured term is solid `text`; a missing term is dashed `edge`
and named "not measured", never zero. Only the deficit has evidence behind it in version 1, so only it
carries source bullets. The terms are listed as rows under the line (label "Digital deficit · 40%" and
value in tabular data type); only between 900px and 1199px, where the record has the full working width,
does each term sit in a column under its own segment. Above the segments, the composite line reads the
value with "v1 · preliminary" once, or a suspended tick with the reason in words when there is none.

## Do's and Don'ts

### Do:
- **Do** draw every pipeline as a line and every stage as a station, with transfers as explicit
  controls.
- **Do** mark unmeasured, preliminary and not-running things as planned or suspended track, in words.
- **Do** put source bullets on every fact in a lead's record, in L, G, O order.
- **Do** keep one scarlet plate per screen, and use the line inks only for their own line.
- **Do** pair every size role with its family, capitals and tabular figures explicitly.
- **Do** check every new pairing at 4.5:1 for text and 3:1 for lines and control edges, on both grounds.
- **Do** theme the browser's own surfaces: selection (inverted `text` on `ground`), caret, focus ring,
  scrollbars, underline offset (3px), color scheme and native select arrows.
- **Do** call the licence account "Account" wherever it is printed.

### Don't:
- **Don't** build the generic SaaS admin template: stat tiles over pastel kanban columns, or big-number
  KPI cards with small labels.
- **Don't** show confidence the data has not earned: no solid mark, zero or default score where a
  measurement is missing or preliminary.
- **Don't** reproduce any transit agency's own marks, line names or brand colors; the grammar is
  borrowed, the identity is LeadForge's.
- **Don't** add glow, gradient text, glass, or nested cards.
- **Don't** put an eyebrow or kicker above a heading.
- **Don't** make dragging the only way to move a card between stations.
- **Don't** use Unicode glyphs or emoji as icons; icons are one drawn set in one stroke weight.
- **Don't** fade a disabled control with opacity; draw it from the palette's roles.
- **Don't** render synthetic businesses or placeholder data where real records belong; an empty state
  teaches instead.

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
  sm: "4px"
  md: "6px"
  lg: "10px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.scarlet}"
    textColor: "{colors.plate-text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.scarlet-deep}"
    textColor: "{colors.plate-text}"
  button-secondary:
    textColor: "{colors.porcelain}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "9px 15px"
    height: "36px"
  input-field:
    backgroundColor: "{colors.enamel-raised}"
    textColor: "{colors.porcelain}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "36px"
  nav-item:
    textColor: "{colors.porcelain-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  nav-item-active:
    backgroundColor: "{colors.enamel-raised}"
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
    rounded: "{rounded.sm}"
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
disciplined lines that bend only at 45 and 90 degrees, porcelain station ticks, one ink per meaning, and
labels set at a fixed size so the network reads the same everywhere. It is borrowed grammar, not
borrowed identity: the marks, names and colors are LeadForge's own.

The diagram's honesty is the point. A transit map distinguishes service that runs from service that is
planned or suspended, and LeadForge uses exactly that vocabulary for evidence: a version-1 score, a
feature that does not run yet and a value nobody measured are drawn as planned or suspended track,
dashed or hollow and named in words, never as a solid mark or a zero. Every fact carries lettered source
bullets the way a station lists the lines that serve it. Density is welcome; this is an operator's tool,
and the ranking is a long table read at a desk.

Two grounds carry one world. Midnight enamel is the native ground; porcelain tile is the daylight ground
for long desk sessions. The line inks are shared and tuned per ground so every pairing holds WCAG 2.2 AA.
Confirmed rejections: the generic SaaS admin template (stat tiles over pastel kanban columns), and
confidence the data has not earned (bold numbers and clean charts that hide what is unmeasured).

**Key Characteristics:**
- Pipelines are lines, stages are stations, grant-first is an interchange.
- Planned and suspended marks stand for anything preliminary, unmeasured or not running.
- One ink per meaning; one scarlet action plate per screen.
- Lettered source bullets (L, G, O) on every fact.
- Condensed station labels over tabular data, one type family throughout.
- Flat enamel: depth from tone and seams, never from decoration.

## Colors

A restrained system on two grounds: neutrals in enamel and porcelain, three line inks that each own one
meaning, and a single scarlet reserved for action.

### Primary
- **Scarlet Plate** (`scarlet`): the filled primary action, at most one per screen, always with
  `plate-text` white lettering. Hover and pressed deepen to **Scarlet Deep** (`scarlet-deep`), which also
  sets error text on the porcelain ground. On enamel, error text uses **Scarlet Light** (`scarlet-light`).
  Scarlet means "act" or "attention"; it is never a line.

### Secondary
- **Cobalt Line** (`cobalt-line-dark` on enamel, `cobalt-line-light` on porcelain): the outreach pipeline.
  Its stations, route segments and line bullet. Text that names the outreach line uses the ink variants
  (`cobalt-ink-dark`, `cobalt-ink-light`).

### Tertiary
- **Grant Green** (`green-line-dark`, `green-line-light`; text `green-ink-dark`, `green-ink-light`): the
  NOF grant pipeline and the interchange where a corridor business meets it.
- **Service Amber** (`amber` on enamel; `amber-line-light` and `amber-ink-light` on porcelain): discovery
  runs, the Places-call budget and service notices. As a filled plate it always carries
  `midnight-enamel` text, on either ground.

### Neutral
| Role | Enamel ground | Porcelain ground |
|---|---|---|
| Ground | **Midnight Enamel** `midnight-enamel` | **Porcelain Tile** `porcelain-ground` |
| Raised region (rail, panels, inputs) | **Raised Enamel** `enamel-raised` | **Glazed White** `porcelain-raised` |
| Seam (decorative divider) | **Enamel Seam** `enamel-rule` | **Grout Line** `porcelain-rule` |
| Control edge (inputs, secondary buttons) | **Enamel Edge** `enamel-edge` | **Tile Edge** `porcelain-edge` |
| Text | **Porcelain** `porcelain` | **Midnight Enamel** `midnight-enamel` |
| Secondary text | **Dim Porcelain** `porcelain-dim` | **Faded Enamel** `ink-dim` |
| Focus ring | `porcelain` | `midnight-enamel` |

Every text pairing above measures at least 4.5:1, and every line ink and control edge at least 3:1, on
both the ground and the raised region of its theme. Seams sit near 1.3-1.6:1 on purpose: they separate
regions and never identify a control.

### Named Rules
**The Line Owns Its Ink Rule.** Cobalt is outreach, green is grant, amber is discovery. A line ink never
decorates, never marks a generic state, and never appears on a surface that is not about its line.

**The One Plate Rule.** A screen has at most one scarlet filled action. Everything else is a secondary
button, a link, or a transfer control.

**The Never Color Alone Rule.** Every state a color marks is also marked by shape, pattern or words: line
bullets carry letters, planned track is dashed, suspended stations are hollow.

## Typography

**Display Font:** Fira Sans Condensed (with Fira Sans, system-ui)
**Body Font:** Fira Sans (with system-ui)

**Character:** One humanist superfamily in two widths. The condensed cut is the signage voice: station
names, section heads, buttons and column labels, set at fixed sizes the way a diagram fixes its labels.
The regular width carries reading text and every number, always with tabular figures so columns align.

### Hierarchy
- **Display** (600, 2rem, 1.1): the screen title only, one per route. Never a hero headline.
- **Headline** (600, 1.5rem, 1.2): a lead record's business name.
- **Title** (600, 1.125rem, 1.3, +0.02em): region heads such as "Evidence" and "Route", in capitals.
- **Body** (400, 0.9375rem, 1.5): notes, explanations, empty-state teaching copy, at most 70ch.
- **Data** (500, 0.9375rem, 1.4, tabular figures): scores, counts, call budgets, distances, dates.
- **Label** (500, 0.8125rem, +0.06em, capitals): station names, column headers, buttons, bullets.

### Named Rules
**The Fixed Label Rule.** Station and column labels keep one size everywhere; hierarchy comes from the
line and its position, never from enlarging a label.

**The Tabular Rule.** Every number that can sit in a column sets in tabular figures, on screen and in
tables alike.

## Layout

A left line rail and a working field. The rail (240px) lists destinations as stations on a vertical line,
the current one marked with the interchange ring. Between 900px and 1199px the rail condenses to a 64px
icon column with visible labels on focus; below 900px it becomes a top bar with a menu control. Nothing
shrinks the network into an unreadable miniature: a narrow screen shows one line at a time and keeps its
transfer context.

The core loop is master-detail. At 1200px and wider, the ranked list holds five of twelve columns and the
lead record seven; below 1200px the record replaces the list and a back control returns to the same row.
Tables run full width with no max width; prose holds at 70ch.

Spacing runs on a 4px base (`xs` 4 to `3xl` 48). Groups are tight (`sm`, `md`), regions are separated by
`2xl`, and a heading always has more space above it (`xl`) than below (`md`). Density is the default:
route rows are 52px.

## Elevation & Depth

Flat enamel. Depth comes from tone (the raised region against the ground) and from seams, never from
stacked shadows. The only shadow belongs to overlays that genuinely float, such as menus and popovers,
and it carries a real offset and blur (full value in the sidecar). Nothing glows.

### Named Rules
**The Flat Enamel Rule.** Surfaces rest flat. A shadow appears only on something that floats above the
page, and a region is never a card inside a card.

## Shapes

Lines bend only at 45 and 90 degrees. Pipeline lines are 4px strokes with round joins; the route line
that threads a table is 2px. Station ticks are 10px porcelain discs ringed in the ground color; the
interchange is a 14px hollow porcelain ring with a 3px stroke. Planned track is dashed 6/4; a suspended
station is a hollow tick with the line broken on either side of it.

Corners are modest and consistent: 10px for regions, 6px for controls, 4px for plates, and full rounds
for bullets and ticks. Borders are 1px.

### Named Rules
**The 45/90 Rule.** No drawn line bends at any other angle, and no line is drawn freehand.

**The Planned Track Rule.** A version-1 score, a value never measured and a feature that does not run
yet are drawn dashed or hollow and named in words. None of them ever renders as a solid mark or a zero.

## Components

### Buttons
- **Shape:** gently squared (6px).
- **Primary:** the Scarlet Plate, white label-type capitals, 10px by 16px, 36px tall, with a trailing
  arrow icon when it navigates. One per screen.
- **Hover / Focus:** hover deepens to Scarlet Deep over 150ms; focus draws a 2px focus-ring outline at
  2px offset in the theme's focus color.
- **Secondary:** transparent with a 1px control edge and text-color label; hover fills with the raised
  region.
- **Transfer:** the stage-move control. A secondary button naming the destination station ("Transfer to
  Engaged"), listing only the transitions the backend allows. Dragging a card is an optional shortcut,
  never the only way.

### Chips
- **Source bullets:** 18px porcelain-outlined roundels holding one letter: L (City licence), G (Google
  Places), O (Overture). They sit after every fact the source supplied, in that order.
- **Line bullets:** a short 4px bar in the line's ink plus the line name, marking which pipeline a lead
  rides.
- **Service plate:** an amber plate with enamel text for run budgets and service notices.

### Cards / Containers
- **No cards.** Regions are separated by seams and space. A region may sit on the raised tone with a
  10px corner, but nothing nests inside another container.

### Inputs / Fields
- **Style:** raised-region fill, 1px control edge, 6px corner, 36px tall.
- **Focus:** the edge becomes the text color and the focus ring appears at 2px offset.
- **Error:** the edge and message take the theme's error text color, and the message names the fix.

### Navigation
- **The line rail:** destinations are stations on one vertical line. The current station wears the
  interchange ring and full text color; others use secondary text and plain ticks. Hover brings the
  label to full text color. Destinations not built yet are drawn as planned track.

### Strip Map (signature)
The lead's own route across both lines: its current station ringed, past stations solid, stations ahead
dimmed, and the interchange drawn where a corridor business meets the grant line, grant first. Selecting
a lead traces its route: the line draws from origin to the current station in about 220ms with an
exponential ease-out while other lines dim, and under reduced motion it simply appears.

### Route Row (signature)
Each ranked lead is a station on a 2px vertical route line: rank, the label grid (name, then niche, zip
and licence account in that order everywhere), the composite in tabular data type, source bullets, and
line bullets. An unmeasured composite shows a suspended tick and the words "not measured", never a
number.

### Score Segments (signature)
The composite drawn as one line in three segments sized by their weighted contribution (40% deficit, 35%
viability, 25% pressure), each labeled with its value and sources. A missing term is a planned segment,
dashed and named; a version-1 score carries a dashed "v1, preliminary" tag.

## Do's and Don'ts

### Do:
- **Do** draw every pipeline as a line and every stage as a station, with transfers as explicit
  controls.
- **Do** mark unmeasured, preliminary and not-running things as planned or suspended track, in words.
- **Do** put source bullets on every fact, in L, G, O order.
- **Do** keep one scarlet plate per screen, and use the line inks only for their own line.
- **Do** set every number in tabular figures and every station label at its fixed size.
- **Do** check every new pairing at 4.5:1 for text and 3:1 for lines and control edges, on both grounds.
- **Do** theme the browser's own surfaces: selection, caret, focus ring, scrollbars and underline offset.

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
- **Don't** render synthetic businesses or placeholder data where real records belong; an empty state
  teaches instead.

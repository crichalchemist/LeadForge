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

<!-- impeccable:design-map -->
Name: LeadForge
Colors: primary: scarlet #D71A2A; secondary: cobalt-line-dark #3D74FF; tertiary: green-line-dark #22B14C; neutral: midnight-enamel #0B1230; primary: scarlet-deep #B8141F (+21 more in the sidecar)
Fonts: Fira Sans Condensed (display, headline, title, label); Fira Sans (body, data)
Spacing: xs 4px, sm 8px, md 12px, lg 16px, xl 24px, 2xl 32px, 3xl 40px
Radius: plate 4px, control 6px, region 10px, full 9999px
North Star: "The Loop Diagram"
Rules:
- The Line Owns Its Ink Rule. Cobalt is outreach, green is grant, amber is discovery.
- The One Plate Rule. A screen has at most one scarlet filled action.
- The Never Color Alone Rule. Every state a color marks is also marked by shape, pattern or words: line
- The Palette Disabled Rule. A disabled plate or secondary control is drawn from the palette's roles,
- The Size Carries No Voice Rule. A size role sets size, line height, weight and tracking only.
- The Fixed Label Rule. Station and column labels keep one size everywhere; hierarchy comes from the
- The Tabular Rule. Every number that can sit in a column sets in tabular figures, on screen and in
- The Flat Enamel Rule. Surfaces rest flat.
- The 45/90 Rule. No drawn line bends at any angle but 45 or 90 degrees, and no line is drawn freehand.
- The Planned Track Rule. A version-1 score, a value never measured and a feature that does not run
Don't:
- Don't build the generic SaaS admin template: stat tiles over pastel kanban columns, or big-number
- Don't show confidence the data has not earned: no solid mark, zero or default score where a
- Don't reproduce any transit agency's own marks, line names or brand colors; the grammar is
- Don't add glow, gradient text, glass, or nested cards.
- Don't put an eyebrow or kicker above a heading.
- Don't make dragging the only way to move a card between stations.
- Don't use Unicode glyphs or emoji as icons; icons are one drawn set in one stroke weight.
- Don't fade a disabled control with opacity; draw it from the palette's roles.
- Don't render synthetic businesses or placeholder data where real records belong; an empty state
Do:
- Do draw every pipeline as a line and every stage as a station, with transfers as explicit
- Do mark unmeasured, preliminary and not-running things as planned or suspended track, in words.
- (+6 more)
Full: .impeccable/design-full.md (read a section when you need its detail)

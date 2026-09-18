# Contract: Design Tokens

**Feature**: 003-web-console | **Source**: `German_World_Club_Digital_Plattform.docx`

The token set is the contract between the design document and every surface. A colour that is not
here does not ship (SC-005).

Declared once in `client/src/styles/theme.css` as Tailwind 4 `@theme` custom properties. There is
no JS config; Tailwind 4 reads CSS.

## Colour

Values are as sampled from the twelve mockup pages (research R1). The `-fg` variants come from the
document's own run properties, where a colour had to carry text.

```css
@theme {
  /* Brand */
  --color-navy:        #0A2457;  /* primary: CTA, KPI numerals, headers, active nav */
  --color-navy-2:      #1E4C7C;  /* secondary blue: chart fills, muted brand */
  --color-accent:      #D49626;  /* gold — accent ONLY (see rule below) */
  --color-accent-fg:   #9A6106;  /* gold as text; see note below */

  /* Chrome and ground */
  --color-ink:         #171B20;  /* portal sidebar, dark hero panels */
  --color-ink-2:       #303841;  /* muted text on dark chrome */
  --color-ground:      #F7F8FA;  /* page background, KPI tiles */
  --color-surface:     #FFFFFF;  /* cards, sheets */

  /* Text */
  --color-text:        #171B20;
  --color-text-muted:  #626A73;

  /* Lines */
  --color-hairline:    #D9DEE4;
  --color-hairline-2:  #E6E9ED;

  /* Status tints — background only, paired with a darker -fg for the label */
  --color-tint-gold:    #FFF7E4;
  --color-tint-info:    #EAF2FC;
  --color-tint-success: #EAF7EF;
}
```

### The gold rule

The design document states it directly: *"GWC-Logo unverändert, Gold nur als gezielter Marken- und
Aktionsakzent."* Gold is 1.0% of mockup pixels against navy's 3.2%.

**Enforced structurally, not by review**: there is no gold surface token and no gold body-text
token. Gold is reachable only as `--color-accent` (the 4px active-nav rule, the accent hairline
under the page header, a secondary CTA) and `--color-accent-fg` (a label on `--color-tint-gold`).

A build check fails on:

- any hex literal in `client/src/**` that is not in this file;
- any Tailwind arbitrary colour value (`bg-[#...]`, `text-[#...]`);
- `--color-accent` used as a `background-color` on any element larger than a defined accent
  component.

### Contrast (FR-011, SC-006)

Two backgrounds, not a theme system (research R8):

| Foreground | On `#FFFFFF` | On `#F7F8FA` | On `#171B20` |
|---|---|---|---|
| `--color-text` `#171B20` | 16.8:1 ✓ | 16.0:1 ✓ | — |
| `--color-text-muted` `#626A73` | 5.4:1 ✓ | 5.2:1 ✓ | — |
| `--color-navy` `#0A2457` | 14.4:1 ✓ | 13.7:1 ✓ | — |
| `--color-accent-fg` `#9A6106` | 5.14:1 ✓ | 4.84:1 ✓ | — |
| `--color-accent` `#D49626` | 2.4:1 ✗ **text-forbidden** | 2.3:1 ✗ | 7.0:1 ✓ |
| `#FFFFFF` | — | — | 16.8:1 ✓ |

`--color-accent` is usable as text only on `--color-ink`. Everywhere else gold text is
`--color-accent-fg`. The check above is what stops that being forgotten.

## Type

The family is unresolved (research R2) and sits behind one token, so the answer costs one line:

```css
@theme {
  --font-sans: "GWC Sans", ui-sans-serif, system-ui, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
}
```

Scale as measured from the mockups:

| Step | Size / weight | Use |
|---|---|---|
| `page-title` | 26px / 700, tight tracking | "Admin Panel — Governance, Freigaben & Trust Operations" |
| `page-sub` | 13px / 400, muted | the line under a page title |
| `kpi` | 28px / 700, navy | the four-tile KPI row |
| `card-title` | 17px / 600 | "Mitgliederprüfung", "Audit Trail" |
| `body` | 13px / 400 | card copy, table cells |
| `label` | 11px / 600, uppercase, +0.06em | "WAS DIESE SEITE BEDEUTET", KPI captions |
| `nav` | 13px / 400 (600 when active) | sidebar items |

## Spacing, radius, elevation

4px base. Cards use 20–24px padding, a 12px gutter between KPI tiles, an 8px radius and a 1px
`--color-hairline` border with no shadow — the mockups have no drop shadows anywhere. Flat surfaces
separated by hairlines is the *"hohe Kontraste, funktionale Hierarchie"* the document asks for, and
shadows would work against it.

## Components fixed by the mockups

- **Sidebar**: `--color-ink`, full height, 13px items, the active item on `--color-navy` with a 4px
  `--color-accent` left rule.
- **Page header**: title, subtitle, a page number chip in `--color-navy`, and a 3px
  `--color-accent` rule beneath the whole header.
- **KPI tile**: `--color-ground` fill, hairline border, navy numeral over an 11px muted caption.
- **Card**: `--color-surface`, hairline border, 8px radius, a `card-title` and then content.
- **Status pill**: tint background with a matching darker label — success `#EAF7EF`, pending
  `#FFF7E4`, attention a red tint, informational `#EAF2FC`. Never colour alone: each pill carries
  its word (*freigegeben*, *in Prüfung*, *Rückfrage*), which is also what keeps it legible to
  anyone who cannot distinguish the tints.
- **Callout**: tinted background with a 4px left rule — gold for a product rule, `--color-ground`
  with a navy rule for a neutral note, `--color-ink` for an emphatic one.
- **Primary button**: `--color-navy` fill, white label. **Accent button**: `--color-accent` fill,
  `--color-ink` label. **Secondary**: white fill, hairline border, ink label.
- **Table**: `--color-ground` header row, 11px uppercase headers, hairline row rules, no zebra.

## Logo

Used unmodified (FR-010), from `word/media/image1.png` in the source document. It is a raster at
844×578 with a gradient gold mark on black. It must be extracted, added to the client's assets and
served as a derivative with explicit dimensions (FR-013, Principle VI) — never as the original.

**Open**: a vector original would serve better at sidebar and header sizes. Not in the repository.

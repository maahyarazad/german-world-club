# Contract: Component & Module APIs

**Feature**: `001-coming-soon-revamp`

The UI contract for this feature. Every component is presentational and reads from [`siteConfig`](./site-config.md); none fetches, persists, or transmits anything (FR-016).

---

## `lib/countdown.js`

```js
export function getTimeRemaining(launchDate, now = Date.now()): TimeRemaining
```

**Pure.** No timers, no React, no module state — same inputs always give the same output.

| Param | Type | Notes |
|---|---|---|
| `launchDate` | `string \| Date \| number` | ISO 8601 string with offset, `Date`, or epoch ms |
| `now` | `number` | Epoch ms. Injectable so tests need no fake clock. |

Returns `TimeRemaining` — `{ days, hours, minutes, seconds, hasLaunched, total }` (see [data-model.md](../data-model.md)).

| # | Guarantee |
|---|---|
| L1 | No returned numeric field is ever negative. |
| L2 | `now >= launchDate` ⇒ all units `0`, `total` `0`, `hasLaunched` `true`. |
| L3 | Unparseable `launchDate` ⇒ `hasLaunched: true` with zeroed units. **Never `NaN`.** |
| L4 | `hours` ≤ 23, `minutes` ≤ 59, `seconds` ≤ 59; `days` unbounded. |
| L5 | All units are integers. |

---

## `hooks/useCountdown.js`

```js
export function useCountdown(launchDate): TimeRemaining
```

Binds the pure function to a 1-second interval.

| # | Guarantee |
|---|---|
| H1 | Returns a correct value on first render — no flash of zeros before the first tick. |
| H2 | Recomputes from `Date.now()` each tick; never decrements a held counter (drift-safe). |
| H3 | Clears its interval on unmount. |
| H4 | Clears its interval as soon as `hasLaunched` becomes `true`. |
| H5 | Changing `launchDate` restarts the interval against the new value. |

---

## Components

All components accept no children unless stated. Props are read-only.

### `<BrandMark size? className? />`

Inline SVG monogram. `role="img"` with an accessible name of `siteConfig.brandName`. Uses `currentColor` so it inherits section colour. Placeholder identity — see plan open item 2.

### `<Hero />` — US1

Renders `brandName`, `tagline`, and `status`. Contains **the page's only `<h1>`**. Full-viewport CSS gradient background — no raster image, so LCP is a text node (research R9). All three elements fit the first viewport at every width ≥ 320 px (FR-001).

### `<Offering />` — US1

Maps `siteConfig.offerings` to a responsive grid: 1 column on mobile, 2–3 on wider viewports. `<h2>` section heading, `<h3>` per item — heading levels never skip.

### `<Countdown />` — US2

Consumes `useCountdown(siteConfig.launchDate)`.

| # | Guarantee |
|---|---|
| N1 | `hasLaunched === false` ⇒ renders days / hours / minutes / seconds with unit labels. |
| N2 | `hasLaunched === true` ⇒ renders the launch message, **no digits** (FR-005). |
| N3 | Per-second digits are `aria-hidden="true"`; a visually-hidden summary carries the accessible value and updates only at **day** granularity — per-second `aria-live` would flood the accessibility tree. |
| N4 | Digit transitions sit inside `@media (prefers-reduced-motion: no-preference)`. The numbers themselves always update — they are information, not decoration (FR-013). |
| N5 | Digits use tabular numerals so the layout does not jitter as values change. |

### `<About />` — US1

Renders `siteConfig.about` paragraphs and `parentOrg`. Constrained to a comfortable measure (~65ch) so it does not stretch at 2560 px.

### `<Contact />` — US3

| # | Guarantee |
|---|---|
| T1 | Renders a `mailto:` link to `contactEmail` unconditionally (FR-009). |
| T2 | Renders the social block **only when `socials.length > 0`**. Empty ⇒ no block, no placeholder, no dead links (FR-010). |
| T3 | Every social link carries `target="_blank"` and `rel="noopener noreferrer"`. |
| T4 | Each link's accessible name is its `label`; the icon is `aria-hidden`. |
| T5 | An `id` with no matching sprite symbol renders the text label alone, never a broken `<use>`. |

### `<VisuallyHidden as? children />`

Screen-reader-only text. Clipped, not `display:none` — must stay in the accessibility tree. Becomes visible on focus when it wraps a focusable element.

---

## Cross-cutting UI guarantees

| # | Guarantee | Requirement |
|---|---|---|
| X1 | No horizontal overflow at any width from 320 px to 2560 px. | FR-008, SC-002 |
| X2 | Every interactive element is keyboard reachable with a visible focus indicator; `:focus-visible` is never suppressed without a replacement. | FR-011, SC-008 |
| X3 | All text meets WCAG 2.1 AA against its **rendered** background, including over gradients. | FR-012, SC-005 |
| X4 | Readable colour never depends on an image loading — gradients and solid colours sit beneath all text. | Spec edge case |
| X5 | Exactly one `h1`; heading levels never skip. | SC-005 |
| X6 | Landmarks present: one `<main>`, one `<footer>`; each section has an accessible name. | SC-005 |
| X7 | No component issues a network request. | FR-016 |

## Document contract — `index.html`

| # | Guarantee | Requirement |
|---|---|---|
| D1 | `<html lang="en">`. | SC-005 |
| D2 | Descriptive `<title>` — the brand, not the bare domain. | FR-014 |
| D3 | `<meta name="description">` sourced from `siteConfig.description`. | FR-014 |
| D4 | Open Graph (`og:title`, `og:description`, `og:image`, `og:url`) and `twitter:card`. | FR-014 |
| D5 | `<meta name="theme-color">` set to the brand maroon. | FR-015 |
| D6 | `<meta name="viewport" content="width=device-width, initial-scale=1">` — **absent from the current file** and required for FR-008. | FR-008 |

> D6 is easy to miss: the existing `index.html` has no viewport meta at all, which alone would break responsive rendering on mobile regardless of CSS.

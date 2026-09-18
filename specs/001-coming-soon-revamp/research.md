# Phase 0 Research: Experts Circle Coming-Soon Experience

**Feature**: `001-coming-soon-revamp` | **Date**: 2026-09-11

All `NEEDS CLARIFICATION` items from the Technical Context are resolved below.

---

## R1. Audit of the existing client

**Finding**: The current page is a 1:1 React port of `sample-html.html`, a legacy XHTML placeholder. `src/App.jsx` renders three empty `div`s (`.upper`, `.middle`, `.lower`) whose only content is a fixed-height background image, plus one `h1`. `src/index.css` sets `overflow: hidden` on `body`.

Concrete defects that block every success criterion:

| Defect | Evidence | Consequence |
|---|---|---|
| Non-responsive raster bands | `bg/upper.jpg`, `middle.jpg`, `lower.jpg` are **1200×270 / 1200×260** JPEGs with the word "WELCOME" **baked into the pixels** | Cannot reflow; text inside the image cannot scale, translate, or be read by assistive tech. Fails FR-008, SC-002. |
| Scrolling disabled | `body { overflow: hidden }` | Any content beyond one viewport is unreachable. Fails FR-007. |
| Fixed pixel heights | `height: 270px` on each band, `padding-top: 130px` on `h1` | Layout breaks at any viewport that is not ~1200 px wide. |
| Content is the bare domain | `<h1>expertscircle.german-emirates-club.com</h1>` | Communicates nothing. Fails FR-002, FR-003. |
| No document metadata | `index.html` has `<title>` only — no description, no Open Graph | Fails FR-014, SC-003 (SEO). |
| Template cruft ships as brand | `hero.png` is the Vite cube logo, `favicon.svg` is the Vite purple mark (`#863bff`), `icons.svg` is a dev sprite (bluesky/discord/github/x/documentation) | Off-brand. Fails FR-001, FR-015. |

**Decision**: Retire all four `bg/*.jpg` band images, `hero.png`, `react.svg`, and `vite.svg`. Rebuild the visual identity from CSS gradients, real DOM text, and inline SVG.

**Rationale**: The raster bands are the single root cause of the non-responsiveness. Replacing text-in-image with real text simultaneously fixes responsiveness, accessibility, SEO, and payload — one change clears four requirements.

**Alternatives considered**: *Re-cut the bands as responsive `srcset` sets* — rejected: still ships text as pixels, still unreadable to assistive tech and search engines, and costs far more bytes than a CSS gradient. *Keep the bands as decorative backgrounds behind new text* — rejected: their baked-in "WELCOME" lettering would collide with real headings.

---

## R2. Real-world coming-soon page conventions

**Finding**: Surveying current pre-launch page collections, the recurring high-performing structure is consistent:

1. **Branded hero above the fold** — logo/wordmark, one-line value proposition, explicit pre-launch status.
2. **A concrete launch signal** — a countdown to a real date, which outperforms a vague "coming soon".
3. **A short "what's coming" block** — three to four scannable value points rather than a paragraph.
4. **Credibility/context** — who is behind it.
5. **A single quiet conversion route** — contact and social, kept subordinate to the message.
6. **Minimalist execution** — full-bleed background, bold type, generous whitespace, one accent colour, fast first paint.

**Decision**: Adopt this five-section structure: `Hero → Offering → Countdown → About → Contact/Footer`. Skip the email-capture CTA that most examples include, per the requester's explicit decision to collect no visitor data (FR-016).

**Rationale**: It is the pattern the requester asked to follow, it maps cleanly onto the three prioritised user stories, and each section is independently implementable.

**Alternatives considered**: *Single-screen hero only* — rejected by the requester in favour of multi-section. *Multi-route site with react-router* — rejected by the requester; also unjustified for a site with no content yet.

**Sources**: [SeedProd](https://www.seedprod.com/coming-soon-pages-wordpress/), [WPForms](https://wpforms.com/coming-soon-page/), [Popupsmart](https://popupsmart.com/blog/coming-soon-landing-page-examples), [BdThemes](https://bdthemes.com/best-coming-soon-landing-pages-examples/)

---

## R3. Styling approach — Tailwind CSS v4

**Decision**: Tailwind CSS **v4.3.3** via the first-party `@tailwindcss/vite` plugin.

```
npm install tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3
```

- Register `tailwindcss()` in `vite.config.js` `plugins`.
- Replace the contents of `src/index.css` with `@import "tailwindcss";` followed by an `@theme` block.
- **No `tailwind.config.js`** and **no PostCSS config** — v4 is CSS-first with automatic content detection.

**Rationale**: Chosen by the requester. The v4 Vite plugin is the officially recommended integration, needs no PostCSS pipeline, and its `@theme` directive lets the brand palette live as design tokens that are simultaneously CSS custom properties and Tailwind utilities — which is exactly what FR-015 needs.

**Compatibility check**: Tailwind v4.3.3 + Vite 8.3 + React 19.2 on Node 22.23 — the `@tailwindcss/vite` plugin targets Vite 5+, so this combination is supported. Node 22 satisfies v4's Node 20+ floor.

**Alternatives considered**: *Plain CSS with custom properties* — zero new dependencies, but hand-rolling responsive/state variants is slower. *CSS Modules* — good encapsulation, no new deps, but no utility layer. Both viable; the requester selected Tailwind.

---

## R4. Brand palette and contrast

**Finding**: The legacy stylesheet encodes the authoritative brand identity: `#750A04` (body background, deep maroon), `#AE2835` (heading, accent red). The band JPEGs carry a brighter crimson sampled at `#CC0033`.

**Decision**: Define this token set in the `@theme` block. Every pairing below was computed against the WCAG 2.1 relative-luminance formula:

| Token | Value | Role | On maroon | On cream |
|---|---|---|---|---|
| `--color-brand-maroon` | `#750A04` | Primary surface | — | 11.66:1 AAA |
| `--color-brand-red` | `#AE2835` | Accent, headings | — | 6.32:1 AA |
| `--color-brand-crimson` | `#CC0033` | Gradient stop, hover | — | 5.81:1 AA (vs white) |
| `--color-brand-gold` | `#C9A227` | Countdown emphasis | 4.82:1 AA | — |
| `--color-brand-cream` | `#FFF8F0` | Body text on dark | 11.07:1 AAA | — |
| `--color-brand-blush` | `#F5D0D0` | Muted text on dark | 8.22:1 AAA | — |
| `--color-brand-ink` | `#1A0B0A` | Body text on light | — | 18.19:1 AAA |

**Every pairing passes WCAG 2.1 AA for normal text**, satisfying FR-012 and SC-005.

**Rationale**: Carrying the existing maroon/red forward preserves brand continuity (FR-015) while the computed ratios remove contrast from the list of things that could fail the accessibility gate. Gold is the one addition — it supplies the countdown emphasis the maroon/red pair cannot provide without muddying, and it clears AA on maroon at 4.82:1.

**Guard**: `--color-brand-gold` at 4.82:1 has little headroom. It is restricted to countdown digits and small accents, never body copy, and must not be placed on crimson.

---

## R5. Countdown implementation

**Decision**:
- A pure, dependency-free function `getTimeRemaining(launchDate, now)` returning `{ days, hours, minutes, seconds, hasLaunched }`, kept in `src/lib/countdown.js` so it is unit-testable without rendering.
- A `useCountdown(launchDate)` hook wrapping it in `useEffect` + `setInterval(…, 1000)`, clearing the interval on unmount **and** as soon as `hasLaunched` turns true.
- Compute from `Date.now()` on every tick rather than decrementing a counter, so background-tab throttling and clock drift cannot desynchronise the display.
- When `hasLaunched` is true, render the launch message instead of digits (FR-005).

**Accessibility**: The countdown container is `aria-live="off"` with `aria-hidden="true"` on the per-second digits, accompanied by a visually-hidden text summary that is updated only when the **day** value changes. This satisfies the screen-reader acceptance scenario — per-second `aria-live` updates would flood the accessibility tree.

**Reduced motion**: Digit flip/fade transitions are wrapped in `@media (prefers-reduced-motion: no-preference)`; the numbers themselves always update (they are information, not decoration).

**Rationale**: Splitting pure math from the React binding makes the P2 story testable with fake timers and no DOM. Recomputing from wall-clock time is the standard fix for the classic drift bug.

**Alternatives considered**: *A date library (date-fns, Luxon)* — rejected: the arithmetic is four modulo operations, and a dependency works against the 150 KB budget (SC-007). *`requestAnimationFrame`* — rejected: 60 updates/second for a display that changes once per second.

---

## R6. Configuration surface

**Decision**: A single module `src/config/site.js` exporting a frozen object — launch date/time, brand name, tagline, contact email, and the social channel array. The launch date is an **ISO 8601 string with an explicit UTC offset** (e.g. `2026-12-01T09:00:00+04:00`, Gulf Standard Time), optionally overridden by `VITE_LAUNCH_DATE`.

**Rationale**: Satisfies FR-006 (one place, no markup edits). An explicit offset is required — a bare `2026-12-01` is parsed as UTC while `2026-12-01T09:00:00` is parsed as local time, so an offset-less value would show different countdowns in Dubai and Berlin.

**Unresolved-by-design**: The **actual** launch date, contact address, and social URLs belong to the club. The config ships documented placeholders and an empty `socials: []`. Per FR-010 the contact/social section **renders nothing for an empty array** rather than emitting dead links. These are content values, not engineering unknowns — they do not block implementation.

---

## R7. Brand assets

**Finding**: No genuine brand asset exists in the repo — `hero.png`, `favicon.svg`, and `icons.svg` are all Vite/React starter files.

**Decision**:
- Build the wordmark as **inline SVG** in `src/components/BrandMark.jsx` — a typographic "EC" monogram in a circle using the brand tokens, with `role="img"` and an accessible name.
- Replace `public/favicon.svg` with a brand-coloured mark derived from the same geometry.
- Replace `public/icons.svg` with a sprite containing only channels the club actually uses (LinkedIn, Instagram, X); referenced via `<use>`.
- Delete `src/assets/hero.png`, `react.svg`, `vite.svg`, and the four `bg/*.jpg` files.

**Rationale**: Inline SVG scales perfectly, inherits `currentColor`, costs no extra request, and needs no binary asset the repo does not have. Shipping the Vite cube as the club's identity would be worse than shipping no mark at all.

**Flagged for the club**: The monogram is a stand-in. If the German Emirates Club has an official Experts Circle logo, it should replace `BrandMark.jsx` before public launch. This is noted in the plan's open items.

---

## R8. Testing strategy

**Decision**: **Vitest 4** + **@testing-library/react 17** + **jsdom**, added as devDependencies with a `test` script.

| Layer | Target | Approach |
|---|---|---|
| Unit | `getTimeRemaining` | Pure assertions: future date, exact boundary, past date, sub-minute remainder, leap-day span |
| Unit | `useCountdown` | `vi.useFakeTimers()` + `vi.setSystemTime()`; assert tick, assert interval cleared after launch |
| Component | Each section | Renders heading, renders config content, omits social block when `socials` is empty |
| Accessibility | Full page | `vitest-axe` assertion of zero WCAG 2.1 AA violations |
| Manual | Production build | Lighthouse ≥95 on all four categories; responsive sweep at 320/768/1280/2560 px |

**Rationale**: Vitest reuses the existing Vite config and transform pipeline, so it needs no separate build setup. Fake timers make the per-second countdown deterministic. `vitest-axe` turns SC-005 into an automated gate rather than a manual checklist.

**Alternatives considered**: *No test suite* — rejected: the countdown has real edge cases (the past-date branch is explicitly in the spec) and SC-005/SC-006 are otherwise unverifiable. *Playwright E2E* — deferred: the value here is layout regression, which Lighthouse and a manual sweep cover at this scale; adding a browser runner is disproportionate for one static page.

---

## R9. Performance and SEO

**Decision**:
- Static `<meta>` tags written directly into `index.html` — description, `og:*`, `twitter:card`, `theme-color`, canonical. No runtime head management library.
- Self-host the display typeface as `woff2` with `font-display: swap` and `<link rel="preload">`, or fall back to a system font stack if no licensed face is available.
- No images in the critical path — the hero is CSS gradient plus inline SVG, so LCP is a text node.
- Verify the gzipped bundle against the 150 KB budget (SC-007) after the production build.

**Rationale**: For a single static page, a head-management library is pure overhead; hand-written tags are crawlable without JavaScript execution, which matters given the JS-disabled edge case. Making LCP a text node rather than an image is what makes the sub-2 s target comfortable (SC-004).

**Expected budget**: React 19 + ReactDOM ≈ 45 KB gzipped, Tailwind's generated CSS for a single page ≈ 5–10 KB gzipped, application code < 10 KB. Total well under 150 KB.

---

## R10. Resolved unknowns summary

| # | Unknown | Resolution |
|---|---|---|
| 1 | Styling approach | Tailwind v4.3.3 via `@tailwindcss/vite`, CSS-first `@theme` (R3) |
| 2 | Email capture | Out of scope — no visitor data collected (requester decision, FR-016) |
| 3 | Page structure | Single-page, five sections (R2) |
| 4 | Brand palette | Maroon/red carried forward + gold accent, all AA-verified (R4) |
| 5 | Countdown mechanics | Pure function + hook, wall-clock recompute, AA-safe live region (R5) |
| 6 | Launch date config | `src/config/site.js`, ISO 8601 with explicit offset (R6) |
| 7 | Brand assets | Inline SVG monogram; delete template cruft (R7) |
| 8 | Testing | Vitest + RTL + vitest-axe; Lighthouse manual (R8) |
| 9 | Legacy band images | Retired entirely, replaced by CSS gradients + real text (R1) |
| 10 | SEO/meta | Static tags in `index.html` (R9) |

**No `NEEDS CLARIFICATION` items remain.** The three content values deferred to the club (launch date, contact address, social URLs) ship as documented placeholders and do not block implementation.

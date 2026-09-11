# Implementation Plan: Experts Circle Coming-Soon Experience

**Branch**: `001-coming-soon-revamp` | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-coming-soon-revamp/spec.md`

## Summary

Replace the legacy three-band placeholder at `expertscircle.german-emirates-club.com` with a responsive, accessible, single-page coming-soon experience built on the structure proven by real-world pre-launch pages: `Hero → Offering → Countdown → About → Contact`.

The technical core is subtractive. The page cannot be made responsive while its content is baked into fixed-width raster images, so the four `bg/*.jpg` bands (1200 px JPEGs with "WELCOME" rendered into the pixels), the `overflow: hidden` body rule, and the fixed pixel heights are removed outright. In their place: real DOM text, CSS gradients, and inline SVG, styled with Tailwind CSS v4 whose `@theme` block carries the club's existing maroon/red palette as design tokens. A dependency-free countdown — a pure function plus a hook — supplies the launch signal. No backend, no routing, no visitor data.

## Technical Context

**Language/Version**: JavaScript (ES2022+), JSX, React 19.2

**Primary Dependencies**: React 19.2 · React DOM 19.2 · Vite 8.3 · Tailwind CSS 4.3.3 · `@tailwindcss/vite` 4.3.3 *(added)*

**Storage**: N/A — no persistence of any kind; the page collects no visitor data (FR-016)

**Testing**: Vitest 4 + @testing-library/react 17 + jsdom + `vitest-axe` *(added)*; Lighthouse run manually against the production build

**Target Platform**: Modern evergreen browsers (Chrome/Edge/Firefox/Safari, last 2 versions) on mobile, tablet, and desktop; statically hosted build output

**Project Type**: Single-page static web client (frontend only — no backend exists or is introduced)

**Performance Goals**: Lighthouse ≥ 95 across Performance / Accessibility / Best Practices / SEO · LCP < 2.0 s on simulated 4G · bundle < 150 KB gzipped

**Constraints**: WCAG 2.1 AA · no horizontal overflow from 320 px to 2560 px · honours `prefers-reduced-motion` · zero network requests to third parties · brand palette must remain the club's existing maroon/red

**Scale/Scope**: One route, five sections, ~8 components, ~2 hooks/lib modules. Low traffic pre-launch; scale is not a design driver.

**Runtime**: Node 22.23 · npm 10.9 *(verified in this environment)*

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Constitution status**: `.specify/memory/constitution.md` is the **unmodified Speck-it template** — every principle is an unfilled `[PRINCIPLE_N_NAME]` / `[PRINCIPLE_N_DESCRIPTION]` placeholder, and no version or ratification date is set.

**Consequence**: There are no ratified principles to check this design against. The gate therefore **passes vacuously** — not because the design was verified compliant, but because no project-specific constraints exist to verify it against.

**Initial check (pre-Phase 0)**: PASS (vacuous)

**Post-design re-check (post-Phase 1)**: PASS (vacuous) — no new violations possible; the design introduces no cross-cutting concern that a typical constitution would govern (no new services, no data persistence, no external integrations, no auth surface).

**Self-imposed gates applied in the constitution's absence** — the design is held to these instead:

| Gate | Standard | Status |
|---|---|---|
| Simplicity | No dependency added unless it removes more complexity than it adds | PASS — 2 runtime deps (Tailwind + its Vite plugin, requester-selected); countdown is dependency-free |
| Accessibility | WCAG 2.1 AA, automated-verified | PASS by design — palette contrast computed and confirmed in research R4 |
| No dead weight | Template cruft must not ship as product | PASS — Vite starter assets explicitly deleted (research R7) |
| Testability | Non-trivial logic must be unit-testable without rendering | PASS — countdown math isolated as a pure function |
| Scope discipline | No backend, no routing, no data collection | PASS — explicitly excluded per requester decisions |

> **Recommendation**: Run `/speckit-constitution` to ratify real principles. Until then this gate provides no actual protection, and that fact should not be mistaken for approval.

## Project Structure

### Documentation (this feature)

```text
specs/001-coming-soon-revamp/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── site-config.md       # Shape of the configuration module
│   └── component-api.md     # Props contract for each component
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
index.html                      # MODIFIED — title, meta description, Open Graph, theme-color, lang
vite.config.js                  # MODIFIED — register tailwindcss() plugin
package.json                    # MODIFIED — tailwind + test deps, "test" script
eslint.config.js                # MODIFIED — add vitest globals for test files

src/
├── main.jsx                    # UNCHANGED — entry point already correct
├── index.css                   # REWRITTEN — @import "tailwindcss" + @theme brand tokens
├── App.jsx                     # REWRITTEN — composes the five sections
├── App.css                     # DELETED — superseded by Tailwind utilities
├── config/
│   └── site.js                 # NEW — launch date, brand strings, contact, socials
├── lib/
│   └── countdown.js            # NEW — pure getTimeRemaining(launchDate, now)
├── hooks/
│   └── useCountdown.js         # NEW — interval binding around countdown.js
├── components/
│   ├── BrandMark.jsx           # NEW — inline SVG monogram
│   ├── Hero.jsx                # NEW — brand, tagline, pre-launch status  (US1)
│   ├── Offering.jsx            # NEW — what the Experts Circle offers     (US1)
│   ├── Countdown.jsx           # NEW — live countdown / launch message    (US2)
│   ├── About.jsx               # NEW — context on the club                (US1)
│   ├── Contact.jsx             # NEW — email + social channels            (US3)
│   └── VisuallyHidden.jsx      # NEW — screen-reader-only text helper
└── assets/
    ├── bg/                     # DELETED — non-responsive raster bands
    ├── hero.png                # DELETED — Vite template cruft
    ├── react.svg               # DELETED — Vite template cruft
    └── vite.svg                # DELETED — Vite template cruft

public/
├── favicon.svg                 # REPLACED — brand mark, not the Vite logo
├── icons.svg                   # REPLACED — club social channels only
└── og-image.png                # NEW — social preview card (1200×630)

tests/
├── lib/countdown.test.js       # Pure math, incl. past-date and boundary cases
├── hooks/useCountdown.test.js  # Fake timers; tick + cleanup after launch
├── components/*.test.jsx       # Per-section render assertions
└── a11y/page.test.jsx          # vitest-axe, zero AA violations

sample-html.html                # UNTOUCHED — legacy reference only, not deployed
```

**Structure Decision**: Single-project frontend layout, rooted at `src/`. The existing flat structure is extended with four conventional folders — `config/`, `lib/`, `hooks/`, `components/` — which is the minimum organisation needed to keep the countdown logic unit-testable in isolation from React (research R5, R8). No `backend/` or `frontend/` split is introduced: the repo contains only a client, the package is already named `client`, and the requester scoped this work to updating that client. A `tests/` tree is added at root, mirroring `src/`.

## Implementation Phases

Sequenced so each user story is independently demonstrable, per the spec's priority ordering.

**Phase A — Foundation** *(blocks everything)*
Install Tailwind v4 + `@tailwindcss/vite`; register the plugin in `vite.config.js`; rewrite `src/index.css` as `@import "tailwindcss"` plus the `@theme` token block from research R4; delete `App.css` and the template assets; add the Vitest/RTL/jsdom/vitest-axe devDependencies and the `test` script; extend `eslint.config.js` with test globals. Verify `npm run dev` and `npm test` both start clean.

**Phase B — User Story 1 (P1): visitor understands what is coming**
Create `src/config/site.js`. Build `BrandMark`, `Hero`, `Offering`, `About`, and `VisuallyHidden`. Rewrite `App.jsx` to compose them. Update `index.html` metadata. **Demonstrable outcome**: a responsive, on-brand page that states who the club is, what is coming, and that it has not launched — the MVP, shippable without Phases C or D.

**Phase C — User Story 2 (P2): visitor sees the launch timing**
Build `lib/countdown.js`, `hooks/useCountdown.js`, and `Countdown.jsx` with the past-date branch and the day-granularity live region. Wire into `App.jsx`. Cover with unit tests using fake timers.

**Phase D — User Story 3 (P3): visitor can make contact and follow**
Build `Contact.jsx` with the `mailto:` route and the social list, omitting the block entirely when `socials` is empty. Replace `public/icons.svg` with club channels. Verify keyboard reachability and focus indicators.

**Phase E — Verification**
Run the responsive sweep (320 / 768 / 1280 / 2560 px), the `vitest-axe` gate, Lighthouse on the production build, and the gzipped bundle-size check against all eight success criteria.

## Risks & Open Items

| # | Item | Impact | Handling |
|---|---|---|---|
| 1 | **Launch date, contact address, and social URLs are unknown** — they are the club's to supply | Page ships with placeholder content | `site.js` carries documented placeholders; `socials: []` renders no block (FR-010). Must be filled before public launch. **Owner: the club.** |
| 2 | **No official Experts Circle logo exists in the repo** | The inline SVG monogram is a stand-in, not the real identity | Flagged in research R7. `BrandMark.jsx` is isolated so swapping in a real logo touches one file. **Owner: the club.** |
| 3 | **Body copy is placeholder** | Value proposition and About text are drafted, not approved | Spec assumption; all copy lives in `site.js` for review without touching markup. |
| 4 | **Constitution is an empty template** | Constitution Check provides no real protection | Recommend `/speckit-constitution` before this becomes a pattern across features. |
| 5 | **JS-disabled visitors see an empty page** | Inherent to a client-rendered SPA | Accepted; mitigated by static `<meta>` tags so links and search results stay informative (FR-014). Pre-rendering was judged disproportionate for one page. |
| 6 | **Gold accent has only 4.82:1 contrast** | Little headroom above the 4.5:1 AA floor | Restricted to countdown digits and small accents; never body copy, never on crimson (research R4). |
| 7 | **Deleting `bg/*.jpg` is irreversible in a non-git repo** | This project has **no git repository initialised** — deletions are unrecoverable | Recommend `git init` and an initial commit before Phase A. `sample-html.html` independently preserves the original design with the images base64-embedded. |

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified.

**No violations to justify.** The Constitution Check passes vacuously (the constitution is an unfilled template), and the design introduces no complexity requiring defence: two runtime dependencies, both requester-selected; no new services, data stores, or integrations; and the net change to the source tree is a reduction in shipped assets.

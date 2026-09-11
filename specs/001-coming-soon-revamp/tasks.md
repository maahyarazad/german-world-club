---

description: "Task list for Experts Circle Coming-Soon Experience"
---

# Tasks: Experts Circle Coming-Soon Experience

**Input**: Design documents from `/specs/001-coming-soon-revamp/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks ARE included. The plan's Technical Context specifies Vitest + @testing-library/react + `vitest-axe`, research R8 defines the strategy, and SC-005 / SC-006 are otherwise unverifiable.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and shipped independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every task

## Path Conventions

Single-project frontend layout rooted at `src/`, with `tests/` at repository root — per plan.md **Structure Decision**. No backend exists or is introduced.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Toolchain and safety net before any source changes

- [X] T001 Initialise version control at repository root: run `git init`, confirm `.gitignore` covers `node_modules` and `dist`, then `git add -A && git commit -m "baseline: legacy placeholder page"` — **this repo is not currently under version control and Phase 2 deletes image assets permanently**
- [X] T002 Install styling dependencies: `npm install tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3`
- [X] T003 Install test dependencies: `npm install -D vitest@^4 @testing-library/react@^17 @testing-library/jest-dom jsdom vitest-axe`
- [X] T004 Register the Tailwind plugin in `vite.config.js`: import `tailwindcss from '@tailwindcss/vite'` and add `tailwindcss()` to the `plugins` array alongside the existing `react()` — do NOT create `tailwind.config.js` or a PostCSS config (Tailwind v4 is CSS-first, per research R3)
- [X] T005 Add the Vitest `test` block to `vite.config.js`: `environment: 'jsdom'`, `globals: true`, `setupFiles: './tests/setup.js'`, `css: true`
- [X] T006 [P] Create `tests/setup.js` importing `@testing-library/jest-dom/vitest` and registering `vitest-axe/extend-expect`
- [X] T007 [P] Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts to `package.json`
- [X] T008 [P] Extend `eslint.config.js` with a second config block for `tests/**/*.{js,jsx}` that adds `globals.vitest` to `languageOptions.globals`
- [X] T009 Verify the toolchain: `npm run dev` starts clean, `npm test` runs with zero tests found (not an error), `npm run lint` passes

**Checkpoint**: Tailwind compiles, Vitest runs, baseline committed

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Design tokens, configuration, shared primitives, and removal of the legacy layout that blocks responsiveness

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T010 [P] Rewrite `src/index.css`: replace the entire file with `@import "tailwindcss";` followed by an `@theme` block defining the brand tokens from research R4 — `--color-brand-maroon: #750A04`, `--color-brand-red: #AE2835`, `--color-brand-crimson: #CC0033`, `--color-brand-gold: #C9A227`, `--color-brand-cream: #FFF8F0`, `--color-brand-blush: #F5D0D0`, `--color-brand-ink: #1A0B0A`. **Delete the `body { overflow: hidden }` rule and the `body-bg.jpg` background** — that rule is what makes the page unscrollable
- [X] T011 [P] Create `src/config/site.js` per [contracts/site-config.md](./contracts/site-config.md): export a frozen `siteConfig` with `brandName`, `parentOrg`, `tagline`, `status`, `launchDate` (ISO 8601 **with explicit `+04:00` offset**), `description`, `offerings` (3–4 items with unique `id`), `about` (1–3 paragraphs), `contactEmail`, and `socials: []`. Support `VITE_LAUNCH_DATE` override with a fallback that never yields an unparseable date (guarantee C3). Mark every club-owned value with a `// PLACEHOLDER — club to supply` comment; invent no real email or URL (guarantee C6)
- [X] T012 [P] Create `tests/config/site.test.js` asserting contract guarantees C1–C6: object is frozen, `new Date(launchDate)` is valid, `Array.isArray(socials)`, `offerings` ids unique, no field contains an invented address
- [X] T013 [P] Create `src/components/VisuallyHidden.jsx`: renders screen-reader-only text using clip-based hiding (never `display:none`, which removes it from the accessibility tree); accepts an `as` prop and `children`
- [X] T014 [P] Create `src/components/BrandMark.jsx`: inline SVG "EC" monogram using `currentColor` and the brand tokens, `role="img"` with an accessible name of `siteConfig.brandName`, accepting `size` and `className` props. **This is a documented placeholder** — the repo contains no official logo (research R7, plan open item 2)
- [X] T015 Rewrite `src/App.jsx` as a layout shell: remove the `import './App.css'` line and the three legacy `div.upper/.middle/.lower` bands, render a single `<main>` landmark plus a `<footer>` landmark with section placeholders in the order hero → offering → countdown → about → contact
- [X] T016 Delete legacy files after T015 removes their last reference: `src/App.css`, `src/assets/bg/` (all four JPEGs), `src/assets/hero.png`, `src/assets/react.svg`, `src/assets/vite.svg`. Leave `sample-html.html` untouched — it is the preserved reference copy
- [X] T017 [P] Update `index.html` per contract D1–D6: keep `lang="en"`, **add the missing `<meta name="viewport" content="width=device-width, initial-scale=1">`** (the current file has none, which alone breaks mobile rendering), replace the bare-domain `<title>` with a brand title, and add `<meta name="description">`, Open Graph tags (`og:title`, `og:description`, `og:image`, `og:url`), `twitter:card`, and `<meta name="theme-color" content="#750A04">`
- [X] T018 [P] Replace `public/favicon.svg` with a brand-coloured mark derived from the `BrandMark` geometry — the current file is the Vite starter logo in `#863bff`
- [X] T019 Verify the foundation: `npm run dev` renders an empty but scrollable page with no console errors, no broken asset imports, and no Vite template imagery anywhere

**Checkpoint**: Design tokens live, config readable, legacy layout gone — user stories can now begin in parallel

---

## Phase 3: User Story 1 - Visitor understands what is coming (Priority: P1) 🎯 MVP

**Goal**: A visitor learns who the club is, what the Experts Circle offers, and that it has not launched — all without scrolling for the core message.

**Independent Test**: Load the page on desktop with no prior brand knowledge; confirm organisation name, value proposition, and pre-launch status are legible in the first viewport, and that scrolling reveals the offering and about content.

### Tests for User Story 1

- [ ] T020 [P] [US1] Create `tests/components/Hero.test.jsx`: asserts `brandName`, `tagline`, and `status` render, and that the hero contains the page's only `<h1>`
- [ ] T021 [P] [US1] Create `tests/components/Offering.test.jsx`: asserts every `siteConfig.offerings` item renders its title and body, uses `<h2>` for the section and `<h3>` per item, and keys off `id` rather than array index
- [ ] T022 [P] [US1] Create `tests/components/About.test.jsx`: asserts each `about` paragraph and `parentOrg` render under an `<h2>`

### Implementation for User Story 1

- [ ] T023 [P] [US1] Create `src/components/Hero.jsx` per contract `<Hero />`: full-viewport CSS **gradient** background (no raster image — LCP must be a text node), `<BrandMark>`, the page's only `<h1>` with `brandName`, the `tagline`, and an explicit pre-launch `status`. Must fit the first viewport at every width ≥ 320 px
- [ ] T024 [P] [US1] Create `src/components/Offering.jsx` per contract `<Offering />`: maps `siteConfig.offerings` to a responsive grid — 1 column on mobile, 2–3 columns on wider viewports
- [ ] T025 [P] [US1] Create `src/components/About.jsx` per contract `<About />`: renders `about` paragraphs and `parentOrg`, constrained to ~65ch so the text does not stretch at 2560 px
- [ ] T026 [US1] Wire `Hero`, `Offering`, and `About` into the `<main>` shell in `src/App.jsx` (depends on T023, T024, T025)
- [ ] T027 [US1] Verify responsive behaviour at 320 / 375 / 768 / 1024 / 1280 / 1920 / 2560 px per quickstart V2: no horizontal scrollbar, no clipped or overlapping text, grid reflows. Confirm `document.documentElement.scrollWidth <= document.documentElement.clientWidth` at every width

**Checkpoint**: User Story 1 is fully functional and shippable on its own — this is the MVP

---

## Phase 4: User Story 2 - Visitor sees the launch timing (Priority: P2)

**Goal**: A live countdown gives the visitor a concrete launch expectation and a reason to return.

**Independent Test**: Load the page with a future launch date and confirm the countdown decrements in real time; set a past date and confirm it degrades to a launch message rather than negative values.

### Tests for User Story 2

- [ ] T028 [P] [US2] Create `tests/lib/countdown.test.js` covering contract guarantees L1–L5: future date returns correct units, exact boundary (`now === launchDate`) returns `hasLaunched: true`, past date returns all zeros with no negative field, sub-minute remainder, leap-day span, and **unparseable input returns `hasLaunched: true` with zeroed units rather than `NaN`**
- [ ] T029 [P] [US2] Create `tests/hooks/useCountdown.test.js` using `vi.useFakeTimers()` and `vi.setSystemTime()`, covering H1–H5: correct value on first render with no flash of zeros, value advances on tick, interval cleared on unmount, interval cleared once `hasLaunched` turns true, and interval restarts when `launchDate` changes
- [ ] T030 [P] [US2] Create `tests/components/Countdown.test.jsx` covering N1–N3: digits render while counting, launch message replaces digits when `hasLaunched`, per-second digits carry `aria-hidden="true"`, and the visually-hidden summary updates only at day granularity

### Implementation for User Story 2

- [ ] T031 [P] [US2] Create `src/lib/countdown.js` exporting the pure `getTimeRemaining(launchDate, now = Date.now())` returning `{ days, hours, minutes, seconds, hasLaunched, total }`. No timers, no React, no module state. Clamp all fields at 0 — never return a negative value (L1, L2, L3)
- [ ] T032 [US2] Create `src/hooks/useCountdown.js` exporting `useCountdown(launchDate)` (depends on T031): computes the initial value synchronously so there is no flash of zeros, ticks on a 1000 ms interval, **recomputes from `Date.now()` every tick rather than decrementing a held counter** so background-tab throttling cannot desynchronise it, and clears the interval both on unmount and when `hasLaunched` becomes true
- [ ] T033 [US2] Create `src/components/Countdown.jsx` (depends on T032) per contract N1–N5: renders days/hours/minutes/seconds with unit labels while counting and the launch message once launched; per-second digits are `aria-hidden` with a `VisuallyHidden` summary updating at day granularity; digits use tabular numerals so the layout does not jitter
- [ ] T034 [US2] Wire `Countdown` into `src/App.jsx` between the offering and about sections (depends on T033)
- [ ] T035 [US2] Add digit transition styling to `src/components/Countdown.jsx` (or a `@utility` block in `src/index.css` if the variant needs custom CSS), wrapped in `@media (prefers-reduced-motion: no-preference)` — the numbers themselves must always update, since they are information rather than decoration (FR-013, N4)

**Checkpoint**: User Stories 1 and 2 both work independently

---

## Phase 5: User Story 3 - Visitor can make contact and follow the brand (Priority: P3)

**Goal**: Interested visitors get a working email route and links to the club's real channels.

**Independent Test**: Load the page and follow each contact and social affordance; confirm each resolves correctly and that an empty `socials` array renders no social block at all.

### Tests for User Story 3

- [ ] T036 [P] [US3] Create `tests/components/Contact.test.jsx` covering T1–T5: `mailto:` link renders unconditionally, **the social block is entirely absent when `socials` is `[]`** (no empty container, no placeholder), populated channels render with `target="_blank"` and `rel="noopener noreferrer"`, each link's accessible name is its `label` with the icon `aria-hidden`, and an unknown icon `id` falls back to the text label rather than a broken `<use>`

### Implementation for User Story 3

- [ ] T037 [P] [US3] Replace `public/icons.svg` with a sprite containing only channels the club actually operates (LinkedIn / Instagram / X), each as `<symbol id="{id}-icon">` matching `socials[].id`. **Remove the Vite starter symbols** — bluesky, discord, github, and documentation are dev-template cruft, not club channels
- [ ] T038 [US3] Create `src/components/Contact.jsx` per contract T1–T5: renders the `mailto:` route from `siteConfig.contactEmail` unconditionally, and renders the social list **only when `socials.length > 0`**, referencing sprite symbols via `<use>` (depends on T037)
- [ ] T039 [US3] Wire `Contact` into the `<footer>` landmark in `src/App.jsx` (depends on T038)
- [ ] T040 [US3] Verify keyboard access per quickstart V6: tab from the top of the page, confirm every interactive element is reachable in visual order with a **visible** focus indicator and no focus trap

**Checkpoint**: All three user stories are independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verification against the eight success criteria and removal of remaining starter residue

- [ ] T041 [P] Create `tests/a11y/page.test.jsx` rendering the full `<App />` and asserting **zero** `vitest-axe` violations at WCAG 2.1 AA (SC-005)
- [ ] T042 [P] Add heading-hierarchy and landmark assertions to `tests/a11y/page.test.jsx` per X5/X6: exactly one `<h1>`, no skipped heading levels, one `<main>`, one `<footer>`, each section accessibly named
- [ ] T043 [P] Create `public/og-image.png` (1200×630) using the brand palette, and confirm the `og:image` URL in `index.html` resolves in the production build
- [ ] T044 Run the full responsive sweep from quickstart V2 across 320–2560 px and fix any horizontal overflow (SC-002)
- [ ] T045 Verify reduced-motion behaviour per quickstart V7: enable the OS setting, reload, confirm transitions are suppressed while the countdown numbers still update
- [ ] T046 Verify the past-date and unparseable-date paths per quickstart V4 by running with `VITE_LAUNCH_DATE=2020-01-01T00:00:00+04:00` and `VITE_LAUNCH_DATE=not-a-date` — neither may render negative numbers, `NaN`, or `Invalid Date` (SC-006)
- [ ] T047 Run Lighthouse on `npm run build && npm run preview` in an incognito window, mobile preset; confirm ≥ 95 on Performance, Accessibility, Best Practices, and SEO, and LCP < 2.0 s (SC-003, SC-004)
- [ ] T048 Verify the bundle budget: build, then gzip each file in `dist/assets` and confirm the combined total is under 150 KB (SC-007)
- [ ] T049 [P] Update `README.md`: replace the stock Vite/React template text with the project's purpose, the `site.js` configuration surface, the `VITE_LAUNCH_DATE` override, and the test/build commands
- [ ] T050 Run `npm run lint` and `npm test`; resolve any failures
- [ ] T051 Walk the full quickstart.md acceptance checklist (V1–V10) and confirm all eight success criteria pass
- [ ] T052 Hand the club the open-items list from plan.md: real launch date, contact address, social URLs, approved body copy, and an official logo to replace the `BrandMark` placeholder

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. T001 must come first; it is the only safety net before T016 deletes assets permanently
- **Foundational (Phase 2)**: Depends on Setup — **blocks all user stories**
- **User Stories (Phase 3–5)**: All depend on Foundational completion; then independent of one another
- **Polish (Phase 6)**: Depends on all desired user stories

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2. No dependency on other stories. **Shippable alone as the MVP**
- **US2 (P2)**: Starts after Phase 2. Independent of US1 — its only touchpoint is one wiring line in `App.jsx` (T034)
- **US3 (P3)**: Starts after Phase 2. Independent of US1 and US2 — its only touchpoint is one wiring line in `App.jsx` (T039)

> The three `App.jsx` wiring tasks (T026, T034, T039) all touch the same file and are therefore **not** parallel with each other. Sequence them, or have one developer own `App.jsx`.

### Within Each User Story

- Tests before implementation
- Pure logic → hooks → components → wiring
- `countdown.js` (T031) → `useCountdown.js` (T032) → `Countdown.jsx` (T033) is a strict chain
- Story complete before moving to the next priority

### Parallel Opportunities

- **Phase 1**: T006, T007, T008 in parallel after T003
- **Phase 2**: T010, T011, T012, T013, T014 in parallel; T017, T018 in parallel; T015 → T016 sequential
- **Phase 3**: all three tests (T020–T022) in parallel; all three components (T023–T025) in parallel
- **Phase 4**: all three tests (T028–T030) in parallel; T031 alone, then the chain
- **Phase 5**: T036 and T037 in parallel
- **Phase 6**: T041, T042, T043, T049 in parallel
- **Across stories**: once Phase 2 closes, US1, US2, and US3 can run on three developers simultaneously

---

## Parallel Example: User Story 1

```bash
# Launch all three tests for User Story 1 together:
Task: "Create tests/components/Hero.test.jsx"
Task: "Create tests/components/Offering.test.jsx"
Task: "Create tests/components/About.test.jsx"

# Then launch all three components together:
Task: "Create src/components/Hero.jsx"
Task: "Create src/components/Offering.jsx"
Task: "Create src/components/About.jsx"

# Then wire them in sequentially (single file):
Task: "Wire Hero, Offering, About into src/App.jsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup — **T001 first; the deletions in T016 are otherwise unrecoverable**
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: run quickstart V1 and V2
5. Deploy — a responsive, on-brand, informative page already beats the current placeholder by a wide margin

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add US1 → validate V1, V2 → **deploy (MVP)**
3. Add US2 → validate V3, V4 → deploy
4. Add US3 → validate V5, V6 → deploy
5. Phase 6 → validate V7–V10 → final deploy

Each story adds value without breaking the previous ones.

### Parallel Team Strategy

1. Team completes Phase 1 + Phase 2 together
2. Then: Developer A → US1, Developer B → US2, Developer C → US3
3. One developer owns `src/App.jsx` to serialise the three wiring tasks

---

## Notes

- `[P]` = different files, no dependencies on incomplete tasks
- `[Story]` label maps each task to a user story for traceability
- **T001 is not optional** — this repo has no git history, and T016 permanently deletes five image assets
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
- Content values (launch date, contact address, social URLs, body copy) and the official logo are the club's to supply; T052 hands off that list

---

description: "Task list for 004-language-switch"
---

# Tasks: Language Switch (Deutsch / English)

**Input**: Design documents from `/specs/004-language-switch/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Included. SC-001 through SC-010 are each stated as an automated check, and the
constitution's Development Workflow section makes "every principle is verifiable" a gate. Per the
repository's convention, each gate names its counter-assertion — a suite that only exercised the
German path would pass against an application with no English in it at all, which is precisely the
failure this feature must not ship.

**Organization**: By user story. **There is no meaningful foundational phase here** — US1 (the
landing pair) is static HTML with no JavaScript and shares no runtime code with US2 (the console).
Phase 2 holds only the locale vocabulary both refer to. The two stories are genuinely parallel, and
saying so is more useful than inventing a blocking phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 landing pair · US2 console switch · US3 reachability
- Exact file paths are given in every task

## Path Conventions

Existing workspaces: `server/`, `client/`, `packages/contracts/`. No new workspace, no new
dependency.

---

## Phase 1: Setup

**Purpose**: The tooling that keeps the two catalogues honest, built before there is a second
catalogue to check.

- [X] T001 Create `client/scripts/check-i18n.mjs`: a recursive key-set comparison over every catalogue in `client/src/i18n/`, reporting the symmetric difference in **both** directions and failing on a type mismatch at the same path (a string in one, an object in the other)
- [X] T002 Wire `check-i18n.mjs` as `test:i18n` in `client/package.json`
- [X] T003 [P] Create `client/tests/i18n-parity.test.js` asserting the checker passes on the tree — counter-assertions: a fixture catalogue missing a key fails it, an *extra* key fails it, and a string-vs-object mismatch fails it (SC-002)
- [X] T004 [P] Add `LOCALES`, `DEFAULT_LOCALE` and the BCP 47 map (`de` → `de-DE`, `en` → `en-GB`) to `client/src/i18n/locales.js`, with a comment recording that `en-GB` was chosen over `en-US` for its closeness to German conventions (research R5)

---

## Phase 2: Shared Locale Vocabulary

**Purpose**: The two values both surfaces agree on. Small by design.

**⚠️ Not a blocking phase.** US1 is static HTML and cannot import any of this — it carries the
literal values inline, exactly as it already carries the palette inline. This phase exists so the
console and the seeded metadata rows agree with what the landing pages hard-code, and T007 is what
proves they do.

- [X] T005 Add the two landing-page rows to `server/src/scripts/seed-dev.js` per `data-model.md` §1: `{record_type: 'page', slug: 'home', language: 'de'}` and `{slug: 'en', language: 'en'}`, sharing one `translation_group_id`, both `indexable` and `published`
- [X] T006 Replace the stale copy in `LANDING_RECORD` in `server/src/public/routes.js` with the current landing-page title and description — it still describes "deutschsprachiger Expatriates in den Vereinigten Arabischen Emiraten" from before feature 003 rebuilt the page (research R8)
- [X] T007 [P] Extend `client/scripts/check-tokens.mjs` to assert `client/en.html` mirrors `theme.css` exactly as `index.html` does, so the English page cannot drift from the palette either

---

## Phase 3: User Story 1 - The English landing page (Priority: P1) 🎯 MVP

**Goal**: An English-speaking visitor reads the public page in English, and search engines are told
the two pages are translations rather than duplicates.

**Independent Test**: Fetch `/` and `/en` with JavaScript disabled; confirm both carry their full
content, each names the other as an alternate, and the switch works in both directions.

**Independent of US2** — no console work, no catalogue, no JavaScript.

### Tests for User Story 1

- [X] T008 [P] [US1] Create `client/tests/landing-en.test.js` mirroring `landing.test.js` for `client/en.html`: zero script tags, no external stylesheet, real content in the raw file, `lang="en"`, `og:locale` `en_GB`, the console route present, and **no account-creation affordance** (003 FR-002 applies to both pages)
- [X] T009 [P] [US1] Create `client/tests/landing-pair.test.js` asserting the two pages are structurally the same translation: identical section ids, identical heading counts, the same set of `/konsole` links, neither with a script tag, and each linking to the other — with the counter-assertion that their *text* differs, so the test cannot pass against a duplicated file
- [X] T010 [P] [US1] Extend `server/tests/seo/hreflang.test.js` to the landing pair: `/` names `en` at `/en`, `/en` names `de` at `/`, the sets are reciprocal, and `x-default` resolves to `/`
- [X] T011 [P] [US1] Create `server/tests/seo/landing-canonical.test.js`: each page's canonical is **itself**; counter-assertion — a canonical pointing at the other page fails, because canonicalising a translation onto its original delists it entirely (FR-011)
- [X] T012 [P] [US1] Extend `server/tests/seo/sitemap.test.js` to require both `/` and `/en`; note in the test that `/` was **absent before this feature**, so this closes a pre-existing gap rather than guarding an existing guarantee
- [X] T013 [P] [US1] Create `server/tests/seo/landing-language-by-url.test.js`: `/en` answers `lang="en"` and `/` answers `lang="de"` **regardless of `Accept-Language`** — two URLs that can serve the same body compete as duplicates (FR-013)

### Implementation for User Story 1

- [X] T014 [US1] Create `client/en.html` as a faithful English translation of `client/index.html`: same structure, same section ids, inline styles, **no script tag**, `<html lang="en">`, its own canonical at `/en`, `og:locale` `en_GB`
- [X] T015 [US1] Keep the five membership tiers in `client/en.html` at the same amounts — the design document fixes them and they are **not re-denominated** — and leave `Ask GWC`, `Club Merchant`, `Corporate Club Partner` and the tier names untranslated per `contracts/message-catalogue.md`
- [X] T016 [P] [US1] Add the language control to the masthead of `client/index.html`: `Deutsch · English`, the current one carrying `aria-current="true"`, the other an `<a href="/en">`, no flag icons
- [X] T017 [P] [US1] Add the mirrored control to `client/en.html`, linking back to `/`
- [X] T018 [US1] Add `en` as a third Rollup input in `client/vite.config.js`, alongside `index` and `konsole`
- [X] T019 [US1] Add a `GET /en` route in `server/src/public/routes.js` beside the existing `/`, reading `client/dist/en.html` at boot through the same `loadLandingShell` path, declaring the same public posture and cache headers
- [X] T020 [US1] In `server/src/public/routes.js`, point both landing routes' `buildPageMeta` calls at the seeded metadata rows so alternates are **derived** from `translation_group_id` rather than written per page — a one-directional declaration must be inexpressible, not merely discouraged
- [X] T021 [US1] Declare `/en` in `server/src/seo/surfaces.js` as public and indexed, so the crawl-posture table stays the single source it claims to be
- [X] T022 [P] [US1] Add `/en` to the dev-server console fallback exclusions in `client/dev-server.js` so Vite serves `en.html` there, and extend `client/tests/dev-server.test.js` to follow the landing page's language link

**Checkpoint**: `/en` exists, both pages render without JavaScript, and the pair is correctly declared to crawlers. Shippable on its own.

---

## Phase 4: User Story 2 - The console switches language (Priority: P1)

**Goal**: A staff member switches the console to English; every screen follows, and the choice
survives a reload.

**Independent Test**: Switch, reload, navigate, sign out and in again — the interface stays in the
chosen language throughout.

**Independent of US1** — no public pages, no SEO.

### Tests for User Story 2

- [X] T023 [P] [US2] Create `client/tests/i18n.test.js` for `resolveLocale()`: a stored choice wins over the browser; `navigator.language` is honoured on a first visit and matched on its primary subtag (`en-US` → `en`); an unoffered browser language falls back to German; a stored value no longer offered falls back to German
- [X] T024 [P] [US2] Add to `client/tests/i18n.test.js` the storage-failure case: `localStorage` throwing on read and on write leaves the console rendering and usable for the session (FR-021)
- [X] T025 [P] [US2] Create `client/tests/console/language-switch.test.jsx`: switching re-renders every visible string **without a page reload**, preserves unsaved form input, and updates `document.documentElement.lang`
- [X] T026 [P] [US2] Extend `client/tests/refusals.test.jsx` to assert a problem renders in both locales from the same `type` — the counter-assertion that the server needed no change (FR-019)
- [X] T027 [P] [US2] Create `client/tests/format.test.js`: `01.10.2026` / `1.240,50 €` in German against `01/10/2026` / `€1,240.50` in English, and that the collator sorts "Ärztin" beside "Arzt" in German — translating labels while leaving German number formatting is the half-done version of this feature (FR-006)
- [X] T028 [P] [US2] Create `client/tests/no-hardcoded-strings.test.js` scanning `client/src/{console,auth,components}` for a direct catalogue import and for non-trivial German or English string literals in JSX; counter-assertion — a planted literal is caught (SC-003)

### Implementation for User Story 2

- [X] T029 [US2] Create `client/src/i18n/en.js` with a key set identical to `de.js`, translating all 163 strings and leaving the product nouns, tier names and amounts as they are per `contracts/message-catalogue.md`
- [X] T030 [US2] Create `client/src/i18n/index.js` with `resolveLocale()`, a `LocaleProvider` and a `useTranslations()` hook that returns the catalogue **object** — not a lookup function, so a missing key is `undefined` at the call site rather than an echoed key string
- [X] T031 [US2] Wrap every storage read and write in `client/src/i18n/index.js` in `try`/`catch`: private browsing and blocked site data both throw, and a language preference is a convenience rather than state anything depends on
- [X] T032 [US2] Rewrite `client/src/lib/format.js` to take the active locale instead of `const LOCALE = 'de-DE'`, caching `Intl` formatters per locale because constructing them is the expensive part
- [X] T033 [US2] Restructure `client/src/lib/problems.js` so its copy is per-locale while the keying stays on problem `type`, leaving the existing `describeProblem`/`isRetryable`/`invalidatesCapabilities` signatures intact
- [X] T034 [P] [US2] Create `client/src/components/ui/LanguageSwitch.jsx`: two options naming their own language, `aria-pressed` on the active one, keyboard-operable with a visible focus ring, and the gold accent never carrying the meaning alone
- [X] T035 [US2] Mount `LocaleProvider` above the router in `client/src/konsole.jsx` and keep `document.documentElement.lang` in step with the active locale (FR-020)
- [X] T036 [US2] Add `LanguageSwitch` to the header in `client/src/console/ConsoleShell.jsx`, beside sign-out
- [X] T037 [US2] Add `LanguageSwitch` to `client/src/auth/AuthCard.jsx` so it is reachable before sign-in, on both the sign-in and password-reset screens (FR-015)
- [X] T038 [P] [US2] Replace every `import { t } from '../i18n/de.js'` with `useTranslations()` across `client/src/console/`, `client/src/auth/` and `client/src/components/ui/`
- [X] T039 [US2] Update `client/tests/helpers/console.jsx` to render inside `LocaleProvider` with a settable locale, so existing suites keep working and new ones can assert either language

**Checkpoint**: US1 and US2 both work, independently.

---

## Phase 5: User Story 3 - Reachable by everyone (Priority: P2)

**Goal**: The control is operable by keyboard and screen reader on both surfaces, and states the
current language rather than only showing it.

**Independent Test**: Reach and operate the control by keyboard alone on both surfaces; confirm the
current language is announced.

**⚠️ Depends on US1 and US2** — there must be a control on each surface before its reachability can
be asserted. Stated rather than hidden.

- [X] T040 [P] [US3] Extend `client/tests/a11y/console-components.test.jsx` to run `axe-core` over `LanguageSwitch` in both states, and over the console shell in **both** languages — a suite that only checked German would pass against a console with no English
- [X] T041 [P] [US3] Extend `client/tests/landing.test.js` and `client/tests/landing-en.test.js` with `axe-core` runs and assertions that the control is a real link with `aria-current` on the active option
- [X] T042 [P] [US3] Add to `client/tests/console/language-switch.test.jsx` the keyboard path: the control is tab-reachable and operable by Enter and Space
- [X] T043 [US3] Assert in `client/tests/landing-pair.test.js` that each option names its language in that language ("Deutsch", "English") and that neither page uses a flag character or image for it — a flag names a country, not a language
- [X] T044 [P] [US3] Cover the control at 320px on both surfaces in `client/tests/responsive.test.jsx`, so it introduces no horizontal scroll (003 SC-011). **Create the file if 003's T128 has not landed yet** — it is still open there, so do not assume it exists

**Checkpoint**: All three stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T045 Create `server/tests/ops/no-server-localisation.test.js` proving no response body varies with `Accept-Language` — sign-in refusals, a capability snapshot and a problem body are byte-identical with and without the header (SC-010, FR-022). This is the check that keeps the feature from quietly growing into the API
- [X] T046 [P] Extend `server/src/scripts/verify-seo.js` to crawl both landing pages and assert reciprocal alternates, per-page canonicals and sitemap presence
- [X] T047 [P] Update `client/tests/no-registration.test.jsx` to scan `client/en.html` too — the English landing page is as likely a place for a sign-up affordance to appear as the German one
- [X] T048 [P] Update `CLAUDE.md` with the two-locale catalogue rule, the key-parity gate and the reason the landing pages switch by URL rather than by toggle
- [X] T049 Run every scenario in `specs/004-language-switch/quickstart.md` end to end and record the outcome — **done**: both pages render with zero script tags and correct `lang`; the switch links both ways; hreflang is reciprocal with `x-default` on `/`; each page is canonical for itself; both appear in the sitemap (`/` for the first time); `Accept-Language` changes nothing on either page; the sign-in refusal is byte-identical in both languages; and the Vite dev server serves all three documents. Not verified in a browser — the Chrome extension has been disconnected for six sessions.
- [ ] T050 Resolve the open questions in `plan.md`: who supplies the English landing copy, whether the English page links to `about-us`/`imprint`/`privacy` instead of their German twins, and confirming `en-GB` over `en-US`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Phase 2 (Shared vocabulary)**: Depends on Phase 1 for T007 only. **Does not block US1 or US2** — see the phase note
- **US1 (Phase 3)**: Depends on T005 (the metadata rows) for its hreflang and sitemap tasks. Otherwise independent
- **US2 (Phase 4)**: Depends on Phase 1 (the parity gate) and T004 (the locale constants). Independent of US1
- **US3 (Phase 5)**: Depends on **both** US1 and US2 — a control must exist on each surface before its reachability can be asserted
- **Polish (Phase 6)**: Depends on the stories it extends

### User Story Dependencies

- **US1 (P1)**: After T005. No dependency on US2.
- **US2 (P1)**: After Phase 1. No dependency on US1.
- **US3 (P2)**: After US1 and US2.

### Within Each User Story

- Tests are written first and must fail before the implementation that satisfies them
- Catalogue before the components that read it; the route before the page it serves
- `en.html` before the control that links to it, so the link is never dead in an intermediate commit

### Parallel Opportunities

- T003, T004 in Phase 1
- T008–T013 in US1 — all six test files
- T016, T017, T022 in US1 — three independent files
- T023–T028 in US2 — all six test files
- T034, T038 in US2
- T040, T041, T042, T044 in US3
- T046, T047, T048 in Polish
- **With capacity**: US1 and US2 run concurrently by different people from the start

---

## Parallel Example: User Story 1

```bash
# All six test files first — they must fail before T014-T022:
Task: "client/tests/landing-en.test.js"
Task: "client/tests/landing-pair.test.js"
Task: "server/tests/seo/hreflang.test.js (extend)"
Task: "server/tests/seo/landing-canonical.test.js"
Task: "server/tests/seo/sitemap.test.js (extend)"
Task: "server/tests/seo/landing-language-by-url.test.js"

# Then the two controls, which are separate documents:
Task: "language control in client/index.html"
Task: "language control in client/en.html"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup
2. T005 from Phase 2 — the metadata rows US1 needs
3. Phase 3: US1
4. **STOP and VALIDATE**: quickstart Scenarios 1 and 2, including the `Accept-Language` check
5. Deploy — an English landing page correctly declared to crawlers is a real deliverable, and it
   also closes the pre-existing gap where `/` was missing from the sitemap

### Incremental Delivery

1. Setup + T005 → tooling and rows ready
2. + US1 → **MVP**: the public page in English, correctly declared
3. + US2 → the console in English
4. + US3 → the control reachable by everyone
5. + Polish → the server-unchanged check and the crawl verification

### Parallel Team Strategy

1. Everyone: Phase 1
2. Then split — Dev A: US1 (static HTML, server route, SEO). Dev B: US2 (catalogue, provider,
   components). The two touch no common file except `vite.config.js`
3. Once both land: US3 and Polish together

---

## Notes

- `[P]` means a different file with no dependency on an incomplete task
- Every task names an exact path
- **Every gate carries its counter-assertion.** The specific risk in this feature is a suite that
  exercises only German and therefore passes against an application with no English in it
- The single most consequential error available here is canonicalising `/en` onto `/`, which
  delists the English page entirely — T011 exists for that one line
- Commit after each task or logical group; stop at any checkpoint to validate a story independently

# Implementation Plan: Language Switch (Deutsch / English)

**Branch**: `004-language-switch` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-language-switch/spec.md`

## Summary

Offer the web application in English as well as German, chosen by the visitor. Two surfaces, two
mechanisms, because they have opposite constraints:

- **The public landing page** gets an English twin at `/en`, and the "switch" is a link between
  them. It cannot be a toggle: the page has no JavaScript at all, because the constitution requires
  public pages to render without it. This also matches what the platform already does — institutional
  pages have been one-URL-per-language since feature 002 (`about`/`about-us`, `impressum`/`imprint`).
- **The console** gets an in-place switch that re-renders without a reload and remembers the choice
  in the browser. It is gated and never indexed, so it is free to be JavaScript-dependent.

The feature is smaller than it looks, because the platform was built bilingual below the interface:
`language` and `translation_group_id` are already columns, hreflang reciprocity is already
generated and tested, `x-default` already points at German, and the console already translates
server refusals by problem `type` rather than by reading `detail`. What is missing is the interface
strings and the control.

Feature 003's R10 chose "German only, no i18n framework" — this reverses the first half and keeps
the second. That decision also required strings to stay out of components, which is precisely what
makes this affordable now.

**Out of scope by decision**: anything the server emits. Problem `detail`, transactional email, OTP
SMS and push campaign copy are unchanged, and no response body changes — SC-010 checks that,
because "localise the API too" is the obvious next step and is not this feature.

**Out of scope**: a per-account preference. The choice is per-browser. `resolveLocale()` is the one
function a stored preference would later attach to.

## Technical Context

**Language/Version**: Node 22, ES modules. React 19.2 in the console. The landing pages are static
HTML with inline CSS and no JavaScript.

**Primary Dependencies**: No new ones. `Intl` is the whole formatting story, and research R3 argues
against an i18n library for 163 strings in two languages.

**Storage**: `localStorage` for the browser's choice. Two `seo_metadata` rows for the landing pair —
**no schema change**; that table already carries `language` and `translation_group_id`.

**Testing**: Vitest across workspaces, plus a new catalogue key-parity check wired as
`test:i18n`. The server's existing hreflang, sitemap and crawl-posture suites cover the pair.

**Target Platform**: Evergreen browsers, 320px and up. Crawlers that execute no JavaScript, which
is the binding constraint on the landing pages.

**Project Type**: Web application — existing `server/`, `client/`, `packages/contracts/`.

**Performance Goals**: The English landing page carries the same budget as the German one: no
bundle, inline styles, content in the first response. The console gains one catalogue object; the
`Intl` formatters are cached per locale because constructing them is the expensive part.

**Constraints**: Public pages render with no JavaScript. German remains the default and the
`x-default` target (§10.7). Both catalogues must have identical key sets or the build fails.

**Scale/Scope**: Two locales. ~163 interface strings. Two static pages. One new Vite entry, one new
server route, two seeded rows, no migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Initial check — before Phase 0

| Principle | Assessment |
|---|---|
| **I. One Rule Set, Three Clients** | **Pass, and reinforced.** Translation is presentation, not a business rule. The console already translates refusals by problem `type`; English is a second copy table against the same keys. Nothing moves a rule into a client. |
| **II. Declare Every Posture** | **At risk, mildly.** One new public route (`/en`) must declare its posture like any other, and the console's never-indexed posture must hold in both languages. The startup gate already refuses an undeclared route. |
| **III. Published State Must Match Real State** | **At risk, and this is the main one.** Two URLs serving one page is exactly where canonical and hreflang go wrong: canonicalise `/en` onto `/` and the English page is delisted; make hreflang one-directional and both pages are suppressed as duplicates. Also: `/` is not in the sitemap today. |
| **IV. Integrity Lives In The Database** | **Not engaged.** No new invariant, no concurrency, no counter. The only persisted rows are two metadata records. |
| **V. Failure Is Explicit And Bounded** | **Not engaged.** No new outbound call, no new budget. |
| **VI. The Server Shapes What Leaves It** | **Pass by exclusion.** No server response changes. The risk is scope creep into localising `detail`, which SC-010 exists to catch. |

**Outcome**: PASS. Two principles carry identified risk, both concentrated in the landing pair and
both addressed in Phase 1. No entry in Complexity Tracking.

### Re-check — after Phase 1 design

| Principle | How the design satisfies it | Verified by |
|---|---|---|
| **I** | Catalogues hold presentation strings only. Refusals translate on `type`, the existing mechanism (research R6). No rule is expressed twice, and no server response changes. | SC-010 |
| **II** | `/en` is a sibling of the existing `/` route and declares the same public posture; the startup gate refuses it otherwise. The console is unchanged in posture and stays never-indexed in both languages (FR-024). | existing gate, SC-009 |
| **III** | Each page canonical for itself, never onto the other. Alternates are **derived** from a shared `translation_group_id` rather than written per page, so a one-directional declaration is inexpressible. `x-default` follows from `language`. The URL decides the language; no route reads `Accept-Language`. Both pages get metadata rows, which also puts `/` in the sitemap for the first time. | SC-001, SC-004, SC-009 |
| **IV** | Nothing to enforce. Two rows in an existing table, no schema change. | — |
| **V** | Unchanged. | — |
| **VI** | No response body changes; `detail` stays English and the console translates it. The landing pages remain script-free, so nothing new is rendered to an unauthenticated requester. | SC-001, SC-010 |

**Outcome**: PASS. Every risk from the initial check has a named structural mechanism — derived
alternates, per-page canonicals, URL-decides-language — and at least one automated check.
Complexity Tracking remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/004-language-switch/
├── plan.md              # This file
├── spec.md              # 24 FRs, 10 success criteria, 3 user stories
├── research.md          # Phase 0 — 10 decisions, 3 open questions
├── data-model.md        # Phase 1 — 2 seeded rows, catalogue and browser state
├── quickstart.md        # Phase 1 — 8 runnable scenarios
├── contracts/
│   ├── message-catalogue.md   # Catalogue shape, key parity, locale resolution
│   └── landing-pages.md       # The pair, canonicals, hreflang, the control
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source code (repository root)

```text
client/
├── index.html                    # + language control in the masthead
├── en.html                       # NEW — the English twin, script-free
├── vite.config.js                # + `en` entry; + /en in the dev-server fallback
├── dev-server.js                 # + /en so `npm run dev` serves it
├── src/
│   ├── i18n/
│   │   ├── de.js                 # unchanged in shape
│   │   ├── en.js                 # NEW — identical key set
│   │   └── index.js              # NEW — resolveLocale, provider, useTranslations
│   ├── lib/
│   │   ├── format.js             # locale-parameterised; stops hard-coding de-DE
│   │   └── problems.js           # keyed by type per locale
│   ├── components/ui/
│   │   └── LanguageSwitch.jsx    # NEW — console control, aria-pressed
│   ├── console/ConsoleShell.jsx  # + the control in the header
│   └── konsole.jsx               # + the i18n provider above the router
└── scripts/
    └── check-i18n.mjs            # NEW — key parity, both directions

client/tests/
├── i18n.test.js                  # NEW — parity, resolution, storage failure
├── landing.test.js               # extended to cover both pages as a pair
├── landing-en.test.js            # NEW — the English page's own assertions
└── a11y/                         # extended: both languages

server/
├── src/public/routes.js          # + the /en route beside /
├── src/scripts/seed-dev.js       # + the two landing metadata rows
└── tests/seo/
    ├── hreflang.test.js          # extended to the landing pair
    └── sitemap.test.js           # + both landing pages
```

**Structure Decision**: No new workspace and no new dependency. The English landing page is a
third Vite entry alongside `index.html` and `konsole.html` — the same pattern feature 003
established when it split the console from the public page, and for the same reason: two documents
with different languages, different indexing postures and different JavaScript requirements cannot
be one document that branches at runtime.

## Delivery order

Three slices. The first is independently shippable and carries the SEO risk; the second is what the
request is most likely about.

| # | Slice | Delivers | Blocked on |
|---|---|---|---|
| 1 | **The landing pair** | `/en`, the masthead control, reciprocal hreflang, per-page canonicals, both pages in the sitemap, the metadata rows | — |
| 2 | **The console catalogue** | `en.js`, the parity gate, `resolveLocale`, locale-driven formatting, the header control | — |
| 3 | **Coverage** | Accessibility in both languages, the no-hard-coded-strings scan, the server-unchanged check | 1, 2 |

Slices 1 and 2 are independent and can run in parallel. Slice 1 alone gives English-speaking
visitors a readable public page; slice 2 alone gives staff a usable console.

## Risks

| Risk | Consequence | Mitigation |
|---|---|---|
| `/en` canonicalised onto `/` | The English page is delisted entirely — the worst outcome available here | Per-page canonical asserted; `contracts/landing-pages.md` names it as the easiest error |
| hreflang written per page instead of derived | One-directional declaration; both pages suppressed as duplicates | Derived from `translation_group_id`; the existing reciprocity test covers the pair |
| A key added to one catalogue only | A blank space or a raw key on the one screen that uses it, invisible until someone switches | Build-time parity check, failing in **both** directions |
| Labels translated, numbers not | `€1.240,50` in an English interface — the half-done version of this feature | `format.js` is locale-parameterised; FR-006 and Scenario 4 check it |
| Scope creep into localising the API | A second translation mechanism, on a header the server does not otherwise read | SC-010 asserts no response body changed |
| The two landing pages drift apart | They stop being translations of each other | A structural test: same section ids, same heading count, same `/konsole` links, no script tags |
| A test only exercises German | Passes against a console with no English at all | Every gate in the quickstart is paired |

## Open questions

Carried from research, none blocking Phase 2:

1. **Who writes the English landing copy** — translated here, or supplied by the club. A faithful
   translation is the starting point and is one file to replace.
2. **Which institutional links the English page uses** — `about-us`/`imprint`/`privacy` in place of
   their German twins. Both sets already exist; it is a link-target choice.
3. **`en-GB` or `en-US`** — `en-GB` assumed, closer to German conventions and to the European
   audience the design document describes.

Two things worth flagging that this feature touches but does not own:

- **`/` is absent from the sitemap today** (research R8). Adding the metadata rows fixes the German
  page as a side effect of adding the English one.
- **`LANDING_RECORD` in `server/src/public/routes.js` holds stale copy** from before the landing
  page was rebuilt in feature 003 — reachable only when no client build exists. The new metadata
  row is the natural home for the current text.

## Complexity Tracking

No Constitution violations. Table intentionally empty.

---
description: "Tasks for 032: the City field in onboarding's Country and City step overflows its card on desktop"
---

# Tasks: Onboarding "Where will you be settling?" — the City input leaves the card on desktop

**Input**: the owner's report ("at *Where will you be settling?* in the second phase of onboarding, COUNTRY AND CITY, the City input text field is out of the centre area in the web application on the desktop view"), plus a read of the code. No spec/plan exists; the diagnosis below is the spec.
**Branch**: `032-city-field-layout`, from `main`.
**Tests**: jsdom has no layout engine, so a test can only assert the classes that produce the layout; the real check is a browser at desktop and phone widths (T005). Server tests are not involved; no database is needed.

## Diagnosis (read from the code; not yet seen in a browser)

- The step is `Place` in `client/src/onboarding/profiling/steps.tsx` (~l.320), which renders `CityField` (~l.230–280) inside `Frame` → `AuthCard` (`client/src/auth/AuthCard.tsx`). The card is `w-full max-w-sm` (384 px) with `p-6`, so the content area is **336 px** wide at every desktop width: the page is centred, the card is a narrow column.
- `CityField` puts a country `<select>` and the city `<input>` in one row: `<div className="flex gap-2">` with the select carrying only `inputClass` (no width, no `min-w-0`) and the input `flex-1 ${inputClass}`. A flex item's default `min-width` is `auto`, so:
  - the `<select>` sizes itself to its **longest option** (a country name such as "Saint Helena, Ascension and Tristan da Cunha" or "Bosnia and Herzegovina"), which on desktop browsers is far wider than half of 336 px;
  - the `<input>` has an intrinsic width of about 20 characters and also refuses to shrink below it.
  The row therefore becomes wider than the card and the city input is pushed out past the card's right edge — outside the centred area. On a phone the page's own horizontal scroll or narrower fonts can hide it, which is why it shows on desktop.
- The enclosing element is a `<fieldset>`, and a fieldset has `min-inline-size: min-content` by default (a long-standing browser quirk), so it does not shrink to the card either; the overflow propagates instead of being clipped.
- The mobile-number row, `client/src/components/ui/MobileField.tsx`, has the same two controls and **already does it right** (`w-[46%]` on the select, `min-w-0 flex-1` on the input). `CityField` is the one that was missed.

## Decisions to confirm before T002

1. **Layout**: keep the country select and the city input **side by side**, as in the mobile field (select 46 %, input the rest), with the select's long option text truncated by the browser. The alternative is to stack them (select above input, each full width): more robust for very long country names and for the German UI's longer labels, at the cost of a taller form. Recommended: side by side, matching `MobileField`, because the card is 336 px and the mobile field proves it fits.
2. **Scope**: fix `CityField` (which is used by *Where will you be settling?* and by the *Country and city* step with the secondary cities), and audit the other select-plus-input rows listed in T004 for the same defect.

## Format: `[ID] [P?] [Story]` Description

- US1: the City field stays inside the card on desktop and on a phone (P1)

---

## Phase 1: Setup

- [X] T001 `git switch main && git pull && git switch -c 032-city-field-layout`. Confirm `.specify/feature.json` points at `specs/032-city-field-layout`. Start the web client against a **local** API (never the URL in `server/.env`, which is the production database): `npm run -w client dev`, sign up or use a seeded applicant, and get to *Where will you be settling?* so the defect can be seen before and after. If a browser tool is available, take a screenshot at 1280 px width and at 375 px and save them next to this file as `before-desktop.png` and `before-phone.png`.

## Phase 2: User Story 1 — the City field stays in the card (P1) 🎯 MVP

**Goal**: in *Where will you be settling?* and in the *Country and city* step (primary and secondary cities), the country select and the city input fit inside the 336 px content area at any viewport width, with no horizontal overflow and no control leaving the card.
**Independent test**: at 1280 px and at 375 px, pick the country with the longest name ("Saint Helena, Ascension and Tristan da Cunha") and look: both controls are inside the card and the card has no horizontal scrollbar.

- [X] T002 [US1] Fix `CityField` in `client/src/onboarding/profiling/steps.tsx` (~l.230–280): (a) the `<fieldset>` gets `min-w-0` (so it can shrink to the card instead of to its content); (b) the row stays `flex gap-2` but the `<select>` gets `w-[46%] min-w-0 shrink-0` appended to `inputClass`, exactly as in `client/src/components/ui/MobileField.tsx` (the select already truncates a long option inside its box); (c) the `<input>` becomes `min-w-0 flex-1 ${inputClass}`. Add a short comment on the row saying why `min-w-0` is there ("a flex item will not shrink below its content: a native select sizes to its longest option and an input to about 20 characters, which pushed the city field out of the 336 px card on desktop"). Do not change `inputClass` itself (other fields use it).
- [X] T003 [P] [US1] Add a regression test `client/tests/onboarding/city-field-layout.test.tsx` (see `client/tests/onboarding/profiling.test.tsx` for how the profiling step is rendered and which requests are mocked): render the settling step, find the country select and the city input, and assert the classes that prevent the overflow — the select has `w-[46%]` and `min-w-0`, the input has `min-w-0` and `flex-1`, and the enclosing `fieldset` has `min-w-0` (a comment states jsdom cannot measure layout, so these classes are the contract and the browser check in T005 is the proof). Counter-assertion: the mobile-number field's select and input carry the same classes, so the two rows cannot drift apart again. Run `npm run -w client test -- tests/onboarding`.
- [X] T004 [P] [US1] Audit the other rows that put a `<select>` next to an `<input>` for the same defect: `client/src/onboarding/Register.tsx` (country of residence step), `client/src/member/Marketplace.tsx`, `client/src/console/admin/{Push,Referrals,Roles}.tsx`. For each, open it at 1280 px and 375 px (or read its classes): a select with no `w-*`/`min-w-0` beside a `flex-1` input is the same bug. Fix any that overflow with the same classes, and list what was checked and what was changed under "Findings" below. Do not restyle rows that already fit.
- [ ] T005 [US1] Verify in a browser at **1280 px, 768 px and 375 px** with the English and the German interface (German labels are longer): *Where will you be settling?* and *Country and city* with a secondary city added; choose "Saint Helena, Ascension and Tristan da Cunha" in the select and type a long city. Check that the page has no horizontal scrollbar, that both controls sit inside the card's border, and that the Continue button is still centred under them. Save `after-desktop.png` and `after-phone.png` next to this file and record the result under "Findings". If a browser tool is not available, say so under "Findings" and leave T005 unchecked for the owner.
- [X] T006 [US1] Run `npm run -w client test`, `npx tsc --noEmit` in `client/`, `npm run -w client test:i18n` and `client/tests/tokens.test.ts` (no new colours). Do not commit unless asked.

## Findings (fill in during T001, T004, T005)

- Before: …
- Other rows checked / changed: …
- After: …

---

## Dependencies & Execution Order

T001 → T002. T003 and T004 are independent of each other ([P]) once T002 exists. T005 after T002 and T004. T006 last.

## Parallel examples

- After T002: T003 (test) and T004 (audit of other rows) together.

## Implementation strategy

**MVP = T001–T002 + T005**: the three-class fix in `CityField` plus a look at it in a browser. T003 keeps the fix from regressing, T004 stops the same mistake in the other rows, and T006 is the usual gate. If the side-by-side layout is too tight for the German labels at 375 px, stack the two controls below the `sm` breakpoint (`flex-col sm:flex-row`, select `sm:w-[46%]`) rather than shrinking the font.

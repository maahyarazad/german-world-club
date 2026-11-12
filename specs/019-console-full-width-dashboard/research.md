# Research: Full-width dashboard layout for the web console

## R1. One layout primitive, not twelve hand-tuned pages

**Decision**: add `client/src/components/ui/DashboardPage.tsx` with three exports:
- **`DashboardPage`**: the page wrapper. `w-full` with a vertical gap, and no `max-w` or
  `mx-auto`. It optionally takes an `aside` (a side panel) and lays out:
  - below `lg`: one column, with the aside rendered **before** the main content, exactly where it
    sits today (for example the profile header above the tabs);
  - at `lg` and up: `grid-cols-[minmax(0,1fr)_20rem]`, or `2xl:…_24rem`, with the aside in the
    second column and `lg:sticky lg:top-6 lg:self-start`.
- **`CardGrid`**: a list container. One column below `lg`, then
  `lg:grid-cols-[repeat(auto-fill,minmax(22rem,1fr))]`, so the column count grows with the width
  and no card is narrower than 22 rem.
- **`ReadableText`**: `max-w-[75ch]` for running text (FR-007).

**Rationale**: FR-003/FR-004 apply to about ten pages. A primitive makes "no narrow centred
column" a property of one component that a static test can enforce, and keeps the mobile layout
(FR-002) identical, because every desktop rule sits behind `lg:`. CLAUDE.md favours shared UI
in `components/ui`. `KpiRow` and `Card` already live there.

**Alternatives considered**: *editing each page's classes in place*: twelve slightly different
grids, the drift `ConsoleShell` was created to avoid.

## R2. The aside's place in the DOM follows today's reading order

**Decision**: the aside is placed in the DOM where its content sits today: before the main
content on profile pages. The visual move to the right column at `lg` uses grid placement
(`lg:col-start-2 lg:row-start-1`), not DOM reordering.

**Rationale**: FR-008 requires the reading order for keyboard and screen-reader users to stay as
it is. CSS grid placement changes only where things appear on screen.

## R3. Feed rows become cards only from `lg` up

**Decision**: `PostCard`'s `<article>` keeps `border-b … py-4` below `lg`, and at `lg` adds
`lg:rounded-card lg:border lg:border-hairline lg:bg-surface lg:p-4` and removes the bottom-only
border. Activity `<li>` and `AuthorList` rows get the same treatment. Post bodies are wrapped in
`ReadableText`.

**Rationale**: a divider-separated timeline reads well in one column but turns into a broken
mesh of lines in a grid. Cards are what a dashboard grid holds. The mobile look is unchanged
(FR-002, SC-005).

## R4. The frame: drop the 1600 px cap, keep the 16 px gutter

**Decision**: remove `mx-auto max-w-[1600px]` from `ConsoleShell`'s outer flex container.
`<main>` keeps `px-4 sm:px-6` and adds `xl:px-8`.

**Rationale**: FR-001 / SC-001. The gutter is the existing responsive rule and must stay
(`tests/responsive.test.tsx` and SC-004).

## R5. KPI row: auto-fill instead of a fixed four

**Decision**: `KpiRow` becomes `grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]`.

**Rationale**: FR-009. Below `lg` it's unchanged.

## R6. What stays narrow, deliberately

`AuthCard` (sign-in, password reset, registration, onboarding), `EmptyState`, `Drawer`, and the
threads `Modal` / `Composer` keep their widths (FR-011). A narrow form before someone is signed
in, or a one-sentence empty message, isn't a page layout. `EmptyState`'s `max-w-2xl` stays and
is allowlisted in the static test.

## R7. Enforcement: a static test, like the i18n guards

**Decision**: `client/tests/no-narrow-pages.test.ts` scans `client/src/**/*.tsx` and fails on:
- any `max-w-[...]` or `max-w-*` combined with `mx-auto` on a page wrapper, except in `AuthCard`,
  `EmptyState`, `Drawer`, `Modal` and `onboarding/*`;
- any `max-w-[1600px]`.

**Rationale**: jsdom has no layout engine (`tests/responsive.test.tsx` says so), so measured
widths can't be asserted. As in that file, the test asserts the *rules* that produce the layout.
A static guard is the project's pattern for "nobody may reintroduce X" (`no-hardcoded-strings`).
Measured widths (SC-001 to SC-004) are checked in a browser via the quickstart.

## R8. Feature 018's pages

`client/src/member/Referrals.tsx` (`mx-auto max-w-3xl`) and
`client/src/console/admin/Referrals.tsx` (`mx-auto max-w-5xl`) exist only on
`018-referral-xp`. Whichever branch merges second wraps them in `DashboardPage`. The static
test (R7) fails until it does, which is the reminder.

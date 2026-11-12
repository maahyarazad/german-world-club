---

description: "Task list for feature 019: Full-width dashboard layout for the web console"
---

# Tasks: Full-width dashboard layout for the web console

**Input**: Design documents from `specs/019-console-full-width-dashboard/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R8), contracts/ui-contract.md, quickstart.md

**Tests**: Included. The constitution requires an automated check for every rule, and plan.md
names them. jsdom has no layout engine, so the tests assert classes, DOM order and the absence
of width caps. Each has a counter-assertion. Measured widths are checked by hand in a browser
(T024).

**Organization**: grouped by user story (spec.md), so each can be built and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US3 from spec.md

## House rules every task inherits

- Every desktop rule goes behind Tailwind's `lg:` (1024 px) or a wider prefix. **Nothing below
  `lg` changes** (FR-002). If a class you add has no `lg:`/`xl:`/`2xl:` prefix, it must
  reproduce exactly what was there before.
- No inline `style=` (the CSP is nonce-only for styles), and no fixed pixel widths. Use `rem`,
  `ch` or `fr` in arbitrary values.
- The DOM order of content must not change (FR-008). Move things visually with grid placement
  only.
- No new interface strings. If one is unavoidable, it goes in both `client/src/i18n/de.ts` and
  `en.ts`.
- Comments explain *why*: why a page has a side panel, and why a surface stays narrow.

---

## Phase 1: Setup

**Purpose**: the shared layout primitive every page uses (research R1–R3)

- [ ] T001 Create `client/src/components/ui/DashboardPage.tsx` with three named exports and a
  default export of `DashboardPage`:
  - `DashboardPage({ aside?, children, className? })`:
    - Without `aside`: `<div className="flex w-full flex-col gap-6">`.
    - With `aside`: `<div className="flex w-full flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start 2xl:grid-cols-[minmax(0,1fr)_24rem]">`.
      Render the aside **first** in the DOM, wrapped in
      `<aside className="lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">`, and the main content
      after it in `<div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">`.
      Comment that DOM order is kept for keyboard and screen readers (FR-008) and only grid
      placement moves the aside.
    - Never `mx-auto` or `max-w-*`.
  - `CardGrid({ as = 'div', children, className? })`: renders `as` (`'div' | 'ul'`) with
    `flex flex-col lg:grid lg:grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] lg:gap-4`. The
    comment says columns grow with the width and no card is narrower than 22 rem (FR-004).
  - `ReadableText({ children, className? })`: `<div className="max-w-[75ch]">` (FR-007).
- [ ] T002 [P] Create `client/tests/components/dashboard-page.test.tsx`:
  - with an `aside`, the aside element precedes the main content in `container.innerHTML` order,
    and carries `lg:col-start-2`;
  - no rendered element has a class matching `/\bmax-w-/` or `/\bmx-auto\b/`;
  - `CardGrid` renders a `ul` when `as="ul"` and carries `lg:grid`;
  - `ReadableText` carries `max-w-[75ch]`.

  Counter-assertion: without an `aside`, no `aside` element is rendered.

---

## Phase 2: Foundational

**Purpose**: the guard that keeps narrow columns from coming back (research R7). It is written
now, and it is **expected to fail** until US1 and US2 are done. That failure is the to-do list.

- [ ] T003 Create `client/tests/no-narrow-pages.test.ts`. It reads every `*.tsx` under
  `client/src/` (via `node:fs` `readdirSync` recursion, as `tests/no-hardcoded-strings.test.ts`
  does) and asserts:
  1. no file contains `max-w-[1600px]`;
  2. no `className` string contains both `mx-auto` and a `max-w-` token, **except** in
     `src/auth/AuthCard.tsx`, `src/console/EmptyState.tsx`, `src/components/ui/Drawer.tsx`,
     `src/member/threads/Modal.tsx` and anything under `src/onboarding/`. Put the allowlist in a
     constant whose comment cites research R6: these are forms before sign-in and one-sentence
     messages, not page layouts.

  The failure message lists each offending `file:line`. Counter-assertion: the scan finds at
  least 50 `.tsx` files, so it isn't passing over an empty list.

**Checkpoint**: T002 passes. T003 fails, listing `ConsoleShell.tsx` and the ten member page
wrappers.

---

## Phase 3: User Story 1 — The console uses the whole screen (Priority: P1) 🎯 MVP

**Goal**: the frame (sidebar, top bar, page area) fills the window at every desktop width.

**Independent Test**: at 2560 px, any console page has no side bands. At 375 px, it's identical
to `main`.

- [ ] T004 [US1] In `client/src/console/ConsoleShell.tsx`, change the outer container
  `mx-auto flex max-w-[1600px] flex-col lg:flex-row` to `flex flex-col lg:flex-row`, and the
  `<main>` padding `px-4 py-6 sm:px-6` to `px-4 py-6 sm:px-6 xl:px-8`. Update the component's
  doc comment: the frame is full width on purpose (spec 019 FR-001), and a cap is what made the
  console look like a landing page on wide screens.
- [ ] T005 [P] [US1] In `client/tests/responsive.test.tsx`, add a test that renders
  `ConsoleShell` (with `MemoryRouter` and `LocaleProvider`, as the existing tests in that file
  do) and asserts that no element carries a `max-w-` class, and that `<main>` still carries
  `px-4` (the 16 px gutter). Counter-assertion: `<main>` exists.

**Checkpoint**: T003's failure list no longer includes `ConsoleShell.tsx`.

---

## Phase 4: User Story 2 — Member pages read as a dashboard on desktop (Priority: P1)

**Goal**: every member page that was a narrow centred column fills the width, with cards in
grids, profile headers in a sticky side panel, and forms in columns. See
`contracts/ui-contract.md` for each page.

**Independent Test**: at 1440 px, Threads shows posts in ≥ 2 columns, and My profile shows the
header beside the posts. At 375 px, both look as they do on `main`. T003 passes.

### Shared pieces

- [ ] T006 [US2] In `client/src/member/threads/PostCard.tsx`, change the `<article>` class
  `flex gap-3 border-b border-hairline px-1 py-4` to
  `flex gap-3 border-b border-hairline px-1 py-4 lg:rounded-card lg:border lg:bg-surface lg:p-4`,
  and wrap the `<PostBody … />` element in `<ReadableText>` from `../../components/ui/DashboardPage`.
  Comment: a divider row reads as a timeline in one column, and a card is what a grid holds
  (research R3).
- [ ] T007 [US2] In `client/src/member/threads/PostList.tsx`, wrap the `entries.map(...)` output
  in `<CardGrid>`. Leave the failure callout, the empty message, Load more and the `Composer`
  outside the grid, in their current order.
- [ ] T008 [P] [US2] In `client/src/member/threads/PostView.tsx`, find the exported `AuthorList`.
  Change its `<ul>` to `<CardGrid as="ul">`. Give each `<li>` (currently
  `flex items-center gap-3 border-b border-hairline py-3`) the extra classes
  `lg:rounded-card lg:border lg:bg-surface lg:px-4`.

### Pages

- [ ] T009 [US2] `client/src/member/threads/Feed.tsx`: replace the wrapper
  `<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">` with `<DashboardPage>`. The
  children stay the same and in the same order.
- [ ] T010 [P] [US2] `client/src/member/threads/Activity.tsx`: replace the
  `mx-auto … max-w-2xl` wrapper with `<DashboardPage>`. Change the list `<ul>` to
  `<CardGrid as="ul">`, and give each `<li>` (currently `border-b border-hairline`) the extra
  classes `lg:rounded-card lg:border lg:bg-surface lg:p-4`.
- [ ] T011 [US2] `client/src/member/threads/PostView.tsx`: replace the three
  `mx-auto flex w-full max-w-2xl flex-col` wrappers (lines ~48, ~76, ~120: the post view, quotes
  and likes) with `<DashboardPage>`. Keep the root post outside any `CardGrid`, so it spans the
  full width. Replies and quotes come through `PostList` (T007) or `AuthorList` (T008) and get
  the grid from there. Depends on T008.
- [ ] T012 [P] [US2] `client/src/member/profile/MyProfile.tsx`: replace the wrapper with
  `<DashboardPage aside={<ProfileHeader … />}>` and render `<ProfileTabs …/>` as its children.
  Move the existing `ProfileHeader` element, with its `actions` prop, into `aside` unchanged.
  Comment: the profile card stays in view while the posts scroll (FR-005).
- [ ] T013 [P] [US2] `client/src/member/profile/MemberProfile.tsx`:
  - In `MemberProfile`, use `<DashboardPage aside={<ProfileHeader profile={profile} actions={actions} />}>`
    with the blocked `Callout`, or `ProfileTabs`, as children.
  - In `FollowList`, replace `<div className="mx-auto w-full max-w-2xl">` with
    `<DashboardPage>`. The `AuthorList` already gets the grid from T008.
- [ ] T014 [P] [US2] `client/src/member/profile/OrganisationView.tsx`: replace the
  `mx-auto flex w-full max-w-2xl flex-col gap-3` wrapper with `<DashboardPage aside={…}>`, where
  the aside is the organisation's header block (name, logo, city: whatever the file renders
  first today), and the remaining details are children. If the file renders a single block with
  no natural split, use `<DashboardPage>` with no aside and wrap long text in `ReadableText`.
- [ ] T015 [P] [US2] `client/src/member/profile/EditProfile.tsx`: replace the wrapper with
  `<DashboardPage>`. Wrap the form's field list in `<div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-x-6">`.
  Give the fields that hold long free text, and the links row (the existing
  `grid-cols-[2fr_1fr_auto]` block), `lg:col-span-2`. The submit row stays last and spans both
  columns. Comment: a single input stretched across a 2560 px screen is harder to fill in than
  two columns (FR-006).
- [ ] T016 [P] [US2] `client/src/member/profile/Privacy.tsx`: replace
  `mx-auto flex w-full max-w-2xl flex-col gap-8` with `<DashboardPage>`, and put the two
  `AuthorList`s in `<div className="flex flex-col gap-8 lg:grid lg:grid-cols-2 lg:gap-6">`. The
  blocked list comes first, as today.

### Tests

- [ ] T017 [P] [US2] Create `client/tests/member/dashboard-layout.test.tsx`. Using
  `renderConsole` and `mockCapabilityFetch(memberSnapshot(), { extraRoutes })` from
  `tests/helpers/console`:
  - `/konsole/mitglied/threads` with a stubbed `/threads/feed?scope=all` of two posts renders the
    posts inside an element carrying `lg:grid`, and each `<article>` carries `lg:rounded-card`;
  - `/konsole/mitglied/profil` with a stubbed `/profile/me` renders an `<aside>` that contains
    the profile header and precedes the tabs in DOM order.

  Counter-assertion: neither page renders an element with `max-w-2xl`.
- [ ] T018 [US2] Run `npx vitest run tests/no-narrow-pages.test.ts` in `client/`. It must now
  pass. If it doesn't, the listed `file:line`s are wrappers this phase missed. Fix them in this
  phase.

**Checkpoint**: US1 + US2 are the MVP. Every member page uses the width, and mobile is
unchanged.

---

## Phase 5: User Story 3 — Lists and summaries scale with the screen (Priority: P2)

**Goal**: Marketplace listings and KPI tiles add columns as the window widens.

**Independent Test**: at 1920 px, Marketplace shows ≥ 3 listing cards per row, and the admin
dashboard's KPI tiles share one row.

- [ ] T019 [P] [US3] `client/src/member/Marketplace.tsx`: at the listings list
  (`<ul className="flex flex-col gap-3">` around `listings.map`, ~line 536), replace it with
  `<CardGrid as="ul" className="gap-3">`. If the listing `<li>` / card is not already bordered
  and rounded, add `lg:rounded-card lg:border lg:bg-surface`. Don't touch the compose
  `Drawer`, the filters or the header.
- [ ] T020 [P] [US3] `client/src/components/ui/KpiTile.tsx`: change `KpiRow`'s
  `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4` to
  `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]`,
  with a comment citing FR-009.
- [ ] T021 [P] [US3] Extend `client/tests/member/marketplace.test.tsx`: with one stubbed listing,
  the listing's `<li>` has a parent carrying `lg:grid`. Counter-assertion: the existing "no
  compose control without marketplace_post" test is unchanged and still passes. Add a case to
  `client/tests/components/dashboard-page.test.tsx` that `KpiRow` carries
  `lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]` and still `grid-cols-1`.

**Checkpoint**: all three stories are done.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T022 Run the full client gate: `npm run -w client test`, `npm run -w client test:i18n` and
  `npx tsc --noEmit -p client`. Fix anything red. Specifically re-check
  `tests/member/marketplace-compose.test.tsx` (the drawer must be unaffected) and
  `tests/responsive.test.tsx`.
- [ ] T023 [P] Add a short paragraph to `CLAUDE.md` under the web-client notes: console pages
  use `components/ui/DashboardPage` (an aside, `CardGrid`, `ReadableText`). A page must not be a
  `mx-auto max-w-*` column (`tests/no-narrow-pages.test.ts`). Desktop rules sit behind `lg:`, and
  below it the layout is the mobile one.
- [ ] T024 Walk `specs/019-console-full-width-dashboard/quickstart.md` in a browser at 320, 768,
  1024, 1440, 1920 and 2560 px, as a member and as staff. Record the outcome of each row in that
  file.
- [ ] T025 **When `018-referral-xp` and this branch meet** (whichever merges second): wrap
  `client/src/member/Referrals.tsx` (`mx-auto … max-w-3xl`) and
  `client/src/console/admin/Referrals.tsx` (`mx-auto … max-w-5xl`) in `<DashboardPage>`. Put
  Refer & earn's `ReferralList` and `XpHistory` side by side with
  `<div className="flex flex-col gap-6 lg:grid lg:grid-cols-2">`. `tests/no-narrow-pages.test.ts`
  fails on the merge until this is done (research R8).

---

## Dependencies & Execution Order

- **Setup (T001–T002)**: no dependencies. T002 needs T001.
- **Foundational (T003)**: no code dependency. It is expected to fail until T018.
- **US1 (T004–T005)**: depends on nothing but Setup. It can be done first and shipped alone.
- **US2 (T006–T018)**:
  - depends on T001;
  - T007 depends on T006, T011 on T008, and T009 on T007;
  - T012–T016 are independent of each other;
  - T018 depends on T004 and every US2 page task.
- **US3 (T019–T021)**: depends on T001 only. It can run alongside US2.
- **Polish**: T022 after all stories. T025 only when the 018 branch is merged.

### Parallel opportunities

- After T001: T002, T003, T004, T019 and T020 can all start.
- In US2, after T006–T008: T010, T012, T013, T014, T015 and T016 are separate files (T011 waits
  for T008).
- T005, T017 and T021 are separate test files.

## Parallel Example: User Story 2

```bash
# after T006–T008 (shared post/author styling):
T010 Activity.tsx   T012 MyProfile.tsx   T013 MemberProfile.tsx
T014 OrganisationView.tsx   T015 EditProfile.tsx   T016 Privacy.tsx
# then T011 PostView.tsx, T009 Feed.tsx, T017 test, T018 guard
```

## Implementation Strategy

### MVP first

1. Phase 1 (`DashboardPage`), then US1 (frame). That's already visible on wide screens.
2. US2 (member pages). With it, T003 goes green and the "landing page" look is gone.
3. Stop and check at 375 px and 1440 px (quickstart rows 1 and 3).

### Then

- US3 for Marketplace and KPI tiles.
- Polish, including the browser walkthrough. T025 waits for 018.

### Notes

- If a multi-column timeline turns out to read badly, revert only T007's `CardGrid`. Nothing
  else depends on it.
- Commit after each task or logical group.

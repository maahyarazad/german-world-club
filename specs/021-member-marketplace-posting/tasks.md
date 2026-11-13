---
description: "Tasks for feature 021: every member can post on the Marketplace, except job offers"
---

# Tasks: Every member can post on the Marketplace, except job offers

**Input**: Design documents from `specs/021-member-marketplace-posting/`
**Prerequisites**: plan.md, spec.md, research.md (R1–R7), data-model.md,
contracts/http-and-ui.md, quickstart.md

**Branch**: `021-member-marketplace-posting`. All work is committed here, never on `main`.

**Tests**: included. CLAUDE.md requires tests that assert behaviour, with a counter-assertion
wherever a test could pass against a server that did nothing. Server SQL suites run against
`gwc_test` only, never `german-world-club`, because they truncate tables.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 (anyone can post), US2 (no job offers), US3 (legacy job offers wind down),
  US4 (business description), US5 (web dialogs centered and animated)

---

## Phase 1: Setup

**Purpose**: confirm the starting point.

- [X] T001 Confirm `git branch --show-current` is `021-member-marketplace-posting` and that
  `server/migrations/` ends at `041_message_mail.sql`, so the next is `042`. Run
  `npm run -w server migrate` against `gwc_test`
  (`DATABASE_URL=postgres://postgres:postgres@localhost:5432/gwc_test`). Record the baseline:
  the server marketplace and authz suites, and the client marketplace tests.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the shared definitions every story reads. Nothing in US1–US3 starts before this.

- [X] T002 In `packages/contracts/src/marketplace.ts`:
  - add `modes: readonly MarketplaceMode[]` to `CategoryDef`;
  - set it in `DEFS`: vehicle, property and general `['offer', 'request']`, job `['request']`.
    Add a comment on `job` saying why: members don't offer jobs (feature 021, the business
    description's Marketplace section), and existing job offers wind down;
  - export `modesFor(category)` next to `requiredFieldsFor`.
- [X] T003 [P] In `packages/contracts/src/errors.ts`, add
  `MARKETPLACE_MODE_NOT_ALLOWED: { type: \`${BASE}/marketplace/mode-not-allowed\`, title: 'Mode not allowed for this category', status: 422 }`
  next to `QUOTA_EXCEEDED`, with a comment on why it's 422 and not 400 or 403 (research R6).
- [X] T004 [P] In `packages/contracts/src/permissions.ts`, remove `'marketplace_post'` from
  `MEMBER_PERMISSIONS` (leave `thread_moderate`) and add a comment that posting needs no member
  flag since 021. Run `npx tsc --noEmit -p packages/contracts`, then for client and app, and fix
  every type error the removal names.
- [X] T005 Extend `server/tests/marketplace/definitions.test.ts`:
  - every category's `modes` is non-empty, has no duplicates, and is a subset of
    `MARKETPLACE_MODES`;
  - `modesFor('job')` is `['request']`;
  - counter-assertion: at least one category allows `offer`.

**Checkpoint**: contracts compile, and `definitions.test.ts` passes.

---

## Phase 3: User Story 1 - A member posts without being granted anything (Priority: P1) 🎯 MVP

**Goal**: every onboarded, active member can post after accepting the terms (FR-001–FR-003,
FR-010).

**Independent test**: a member whose `permissions` is `{}` creates a general listing (201) and
attaches media. A merchant, a partner and staff are still refused.

### Tests for User Story 1

- [X] T006 [P] [US1] In `server/tests/marketplace/posting.test.ts`:
  - turn the permission-pair tests into "a member with **no** permissions can post" (201);
  - keep "terms not accepted" refused as today;
  - add a member with `permissions: { marketplace_post: false }` who can also post.
  - Keep a counter-assertion that an applicant still in profiling is refused (403
    `profiling-incomplete`).
- [X] T007 [P] [US1] In `server/tests/marketplace/audience.test.ts`:
  - the posting route's posture is `audience: 'member'` and `requires` is **undefined**;
  - the "member holding marketplace_post CAN create" case becomes "a member with no flags CAN
    create";
  - merchant, partner and staff refusals are unchanged. Update the header comment.
- [X] T008 [US1] In `server/tests/authz/matrix.test.ts`:
  - drop `requires: 'marketplace_post'` from the three marketplace rows (create listing, attach
    media, detach media);
  - replace the two flag sweeps ("refuses a member the routes gated on a per-member flag",
    "admits a member who HOLDS the flag") with:
    - (a) a pin: `ROUTE_CLASSES.filter(r => r.audience === 'member' && r.requires)` is empty,
      with a comment that adding a flag-gated member route must update this test on purpose;
    - (b) a member with `permissions: {}` is not 403 on those three rows. This is the
      counter-assertion to (a).
  - Remove `flaggedMember` if nothing else uses it.
- [X] T009 [P] [US1] Update `server/tests/marketplace/helpers.ts`,
  `server/tests/marketplace/quota.test.ts`, `parity.test.ts` and
  `no-server-localisation.test.ts`. Stop creating members with `marketplace_post`, and remove
  any `canPost: false` path that expected a 403. Assertions must keep their meaning.
- [X] T010 [P] [US1] In `client/tests/member/marketplace.test.tsx`:
  - "has NO compose control without marketplace_post" becomes "HAS New listing for a member with
    no permissions";
  - keep a counter-assertion that a non-member snapshot (e.g. a merchant) gets no compose
    control, or none at all if the page refuses it;
  - update the header comment.
  - In `client/tests/member/marketplace-compose.test.tsx`, `poster()` drops `marketplace_post`.

### Implementation for User Story 1

- [X] T011 [US1] In `server/src/modules/marketplace/routes.ts`, remove
  `requires: 'marketplace_post'` from `POST /marketplace/listings`,
  `POST /marketplace/listings/:id/media` and `DELETE /marketplace/listings/:id/media/:assetId`.
  Rewrite the header comment: posting is open to every member since 021, and the `requires`
  mechanism stays in `10-auth` for future flags. Update the comments at the media block and the
  "no requires on these four" note.
- [X] T012 [US1] In `server/src/modules/marketplace/application/create.ts`, update the header
  comment: there is no permission flag, terms and quota are the checks, and the rest is
  unchanged.
- [X] T013 [US1] Create `server/migrations/042_member_marketplace_posting.sql`, part 1:
  - a header comment (feature 021, research R2);
  - `UPDATE members SET permissions = permissions - 'marketplace_post' WHERE permissions ? 'marketplace_post'`,
    with a comment: a retirement of a concept, so no audit row; members are updated, never
    deleted.
  - Part 2 (the trigger) is T020.
- [X] T014 [P] [US1] In `server/src/seed/members.ts`, stop setting `marketplace_post`. In
  `server/src/seed/marketplace.ts`:
  - pick owners from active demo members with `member_profiling.completed_at IS NOT NULL`
    instead of the flag (both queries around lines 138–160), and update the doc comment;
  - keep the history rule.
- [X] T015 [P] [US1] In `client/src/member/Marketplace.tsx`:
  - `canPost` becomes `snapshot?.kind === 'member'`, with the `permissions` read removed;
  - update the header comment at line ~26 (no longer "absent without marketplace_post").
- [X] T016 [P] [US1] In `expo-client/german-world-club/src/app/(member)/marketplace/index.tsx`,
  `setCanPost(me.kind === 'member')`, with the comment updated. In `src/api/endpoints.ts`
  (~line 188) and `src/app/(member)/marketplace/new.tsx` (~line 31), update the comments that
  mention `marketplace_post`.

**Checkpoint**: T006–T010 pass. A flagless member posts on the web and in the app.

---

## Phase 4: User Story 2 - Job offers are not available to members (Priority: P1)

**Goal**: no job offer can be created or produced by an edit, through any face or directly
(FR-004–FR-007, FR-009, FR-012).

**Independent test**: `POST` with job and offer gets 422 `marketplace/mode-not-allowed`, and the
row count is unchanged. A job request gets 201. Editing a general offer into job gets 422, and
the listing is unchanged. The compose form shows only Request for Job.

### Tests for User Story 2

- [X] T017 [P] [US2] Create `server/tests/marketplace/job-offer.test.ts` (against `gwc_test`)
  covering the application refusals:
  - create job and offer → 422, `type` ends `/marketplace/mode-not-allowed`, no
    `marketplace_listings` row, and the live-listing counter unchanged (no quota reserved);
  - counter-assertion: the same member's job request → 201;
  - `PATCH` a general **offer** with `category: 'job'` (plus valid job details) → 422, and the
    row still has `category = 'general'` and its general detail row;
  - counter-assertion: `PATCH` a general **request** to `category: 'job'` → 200.
- [X] T018 [P] [US2] In the same file, a `describe('database trigger')` block covering the
  trigger, with direct SQL through `app.pg`:
  - `INSERT` of a job offer → rejected with constraint `marketplace_no_new_job_offer`;
  - `UPDATE` of a job request to `mode = 'offer'` → rejected;
  - a legacy **draft** job offer `UPDATE … SET state = 'active'` → rejected.
  - Build legacy rows inside one transaction with `SET LOCAL session_replication_role = replica`
    (test database only, comment why: it's how pre-migration rows exist).
  - Counter-assertion: a job request insert succeeds.
- [X] T019 [P] [US2] In `client/tests/member/marketplace-compose.test.tsx`:
  - the categories mock gains `modes`;
  - choosing Job leaves only the Request option, and the `jobOfferNote` text is shown;
  - with Offer selected, switching to Job sets the mode to Request, and the submitted body has
    `mode: 'request'`;
  - a 422 `mode-not-allowed` response shows the note, and `console.error` is called;
  - counter-assertion: General shows both modes and no note.

### Implementation for User Story 2

- [X] T020 [US2] Add part 2 to `server/migrations/042_member_marketplace_posting.sql`:
  - function `marketplace_listings_no_new_job_offer()` and its trigger, `BEFORE INSERT OR UPDATE
    OF category, mode, state ON marketplace_listings FOR EACH ROW`;
  - it raises `check_violation` with `CONSTRAINT = 'marketplace_no_new_job_offer'` under the
    three conditions in data-model.md;
  - wrap `DROP TRIGGER IF EXISTS` in `SET LOCAL client_min_messages = warning` (as
    040_referrals.sql does);
  - a comment explaining why this isn't a CHECK constraint (research R4).
  - Run `npm run -w server migrate` against `gwc_test` twice; the second run must be a no-op.
- [X] T021 [US2] Add `ListingModeNotAllowedError` in
  `server/src/modules/marketplace/application/create.ts` (next to `TermsNotAcceptedError`), with
  the English message "Members cannot offer a job; post a job request instead." for job, or a
  generic one for other categories. Throw it in `createListing` when
  `!modesFor(category).includes(mode)`, **before** the quota `reserve`.
- [X] T022 [US2] In `server/src/modules/marketplace/application/manage.ts` `editListing`, when
  `categoryChanged` and `!modesFor(category).includes(row.mode)`, throw
  `ListingModeNotAllowedError` before any write.
- [X] T023 [US2] In `server/src/modules/marketplace/controller.ts`:
  - map `ListingModeNotAllowedError` to
    `reply.code(422).send({ ...PROBLEMS.MARKETPLACE_MODE_NOT_ALLOWED, detail, instance })` in
    `create` and in `edit`;
  - also map a pg error with `code === '23514' && constraint === 'marketplace_no_new_job_offer'`
    to the same problem, as a backstop;
  - check the route response schemas allow a 422, the same way the quota refusal does.
- [X] T024 [P] [US2] In `client/src/member/Marketplace.tsx` `ComposeListing`:
  - render mode options from `activeDef?.modes ?? MARKETPLACE_MODES`;
  - when the category changes and `mode` isn't allowed, `setMode(modes[0])`;
  - when `modes.length === 1`, show `t.memberMarketplace.jobOfferNote` under the control;
  - on a 422 `MARKETPLACE_MODE_NOT_ALLOWED`, log
    `console.error('ComposeListing.submit', problem)` and show the same note.
  - Browse filters are unchanged.
- [X] T025 [P] [US2] In `client/src/i18n/de.ts` and `en.ts`, add `memberMarketplace.jobOfferNote`:
  - de: „Hier kannst du Arbeit suchen. Stellenangebote sind für Mitglieder nicht möglich.“
  - en: "You can look for work here. Job offers aren't available to members."
  - Run `npm run -w client test:i18n`.
- [X] T026 [P] [US2] In `expo-client/german-world-club/src/app/(member)/marketplace/new.tsx`:
  - mode chips from `activeDef?.modes`;
  - `chooseCategory` switches the mode to the first allowed one;
  - show the note when there's only one;
  - handle a 422 `MARKETPLACE_MODE_NOT_ALLOWED` by logging (CLAUDE.md) and showing the note.
  - Add `marketplace.jobOfferNote` to `src/i18n/de.ts` and `en.ts` (the same text as T025).

**Checkpoint**: T017–T019 pass. No face can produce a job offer.

---

## Phase 5: User Story 3 - Existing job offers wind down (Priority: P2)

**Goal**: legacy job offers stay visible and manageable until they end, and are never deleted
(FR-008, SC-003).

**Independent test**: for a legacy active job offer:
- the owner edits its title and job details (200);
- it's marked filled (200), or withdrawn;
- the expiry job expires it;
- moderation hides and restores it;
- it stays in browse while active.

### Tests for User Story 3

- [X] T027 [US3] In `server/tests/marketplace/job-offer.test.ts`, `describe('legacy job offers')`,
  with legacy rows built as in T018:
  - the owner's `PATCH` of title and details → 200, and it's still a job offer;
  - the owner marks it `filled` → 200;
  - another legacy one is `withdrawn` → 200;
  - one with a past `expires_at` is expired by `runJob('marketplace-expiry')`;
  - staff hide, then restore one → both succeed;
  - an active legacy job offer appears in `GET /marketplace/listings?category=job&mode=offer`.
  - Counter-assertion: the count of job offers before and after the migration's `UPDATE` part is
    equal (nothing deleted).

### Implementation for User Story 3

- [X] T028 [US3] If T027 fails anywhere, fix the trigger condition in
  `server/migrations/042_member_marketplace_posting.sql` or the application check (T022 must
  only fire on a category change). Don't loosen T018 to get there.

**Checkpoint**: T017, T018 and T027 all pass together.

---

## Phase 6: User Story 4 - The business description states the rule (Priority: P2)

**Goal**: FR-011.

- [X] T029 [US4] Verify that `german-world-club-business-description.md` (gitignored and
  local, already updated during `/speckit-specify`) has the "## Marketplace" section with rules
  1–7, and that the Core Server Functions row says "Members post (no job offers)". Make it match
  the final behaviour: the error wording, and that drafts can't be published. It isn't
  committed. Note that in the completion report.

---

## Phase 7: User Story 5 - Web dialogs centered and animated (Priority: P3, web only)

**Goal**: FR-013–FR-015. Every dialog built on `client/src/member/threads/Modal.tsx` opens
centered and animates in and out. The Drawer (New listing) and the app are untouched (research
R8).

**Independent test**: on the web, open Send request on a listing at desktop and at 375 px. It's
centered and fades and scales in and out. Escape and Cancel close it. With reduced motion there's
no animation. A reopened dialog is empty.

### Tests for User Story 5

- [X] T030 [P] [US5] Create `client/tests/components/modal.test.tsx`, in the style of
  `drawer.test.tsx` (jsdom has no `showModal`, so `open` is the attribute the fallback sets):
  - **centering**: the dialog's `className` contains `m-auto` and a bounded max height. A
    comment says why: Tailwind v4 preflight zeroes the browser's `margin: auto`, and jsdom can't
    check layout;
  - **animation**: it contains `starting:open:` and `transition-discrete` classes and
    `motion-reduce:transition-none`;
  - **exit**: after `open` becomes false, the dialog is still in the document, without `open`,
    until a `transitionend` fires on it (or 250 ms pass with fake timers). Then it's gone;
  - **reset**: reopening shows a fresh child, with typed text gone;
  - **Escape**: a `cancel` event calls `onClose` with the default prevented;
  - counter-assertion: a `transitionend` bubbling from a **child** doesn't unmount the dialog
    early.

### Implementation for User Story 5

- [X] T031 [US5] Rework `client/src/member/threads/Modal.tsx` (research R8). Keep the props (`title`, `open`, `onClose`, `children`) and both exports
  unchanged.
  - **State**: `mounted`. It's true when `open` becomes true. When `open` becomes false, call
    `dialog.close()` (or remove the attribute in jsdom) and keep it mounted until
    `onTransitionEnd` with `e.target === e.currentTarget`, or a 250 ms fallback timeout, whichever
    comes first. Clear the timer on unmount and on reopen.
  - **Classes**, added to the existing ones:
    - centering: `m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto`;
    - animation: `opacity-0 scale-95 open:opacity-100 open:scale-100 starting:open:opacity-0 starting:open:scale-95 transition-[opacity,scale,overlay,display] transition-discrete duration-200 ease-out motion-reduce:transition-none`;
    - backdrop: `backdrop:opacity-0 open:backdrop:opacity-100 starting:open:backdrop:opacity-0 backdrop:transition-[opacity,overlay,display] backdrop:transition-discrete backdrop:duration-200`.
  - **No inline `style`**: the CSP allows styles by nonce only. Update the doc comment with why
    `m-auto` is needed and why it unmounts after the exit, not on close.
- [X] T032 [US5] Check that the variants exist in the built CSS: run `npm run -w client build`
  and grep the output CSS for `@starting-style`, plus the `scale` and `opacity` utilities used. If
  `open:backdrop:` or `starting:open:backdrop:` don't compile in Tailwind 4.3, fall back to an
  equivalent arbitrary variant (`[&[open]::backdrop]:opacity-100`) and record it in the
  component comment.
- [X] T033 [P] [US5] Run every consumer's tests unchanged:
  - `client/tests/member/listing-request.test.tsx`
  - the Threads composer and post-card tests
  - the handle dialog test
  - the member and admin Referrals tests
  - `drawer.test.tsx`

  Fix only what the deferred unmount breaks. A test that expected the content gone
  synchronously after Cancel may need `await waitFor(...)`, with a comment.
- [ ] T034 [US5] Check by hand in the browser (`npm run -w client dev`), web only:
  - Send request (Marketplace), the Threads compose dialog, the handle dialog, and Refer & earn,
    at 1440 px and 375 px: centered, animated in and out;
  - a long dialog scrolls inside the window;
  - Escape works;
  - macOS "Reduce motion" turns the animation off;
  - "New listing" still slides from the right.

  Record the result in `specs/021-member-marketplace-posting/quickstart.md`.

**Checkpoint**: T030 and T033 pass, and T034 is recorded.

---

## Phase 8: Polish & cross-cutting

- [X] T035 Update `CLAUDE.md`'s marketplace paragraph:
  - replace "`marketplace_post` gates *creating* a listing…" with: posting is open to every
    member (feature 021), and members can't offer jobs;
  - the allowed modes per category are in `CATEGORY_DEFS`;
  - the trigger `marketplace_no_new_job_offer` refuses only the *creation* of a job offer, which
    is why it isn't a CHECK.
  - Keep "ownership refusals are 404".
- [X] T036 [P] Search for any remaining reference:
  `grep -rn "marketplace_post" server/src client/src expo-client/german-world-club/src packages/contracts/src server/tests client/tests`.
  Only comments that state the history (feature 021 retired it) may remain.
- [X] T037 Run the gates:
  - `DATABASE_URL=…/gwc_test npm run -w server test` (compare with the T001 baseline; the 7
    known failures on main are the `seed:demo` gate and resilience budgets);
  - `npm run -w client test` and `npm run -w client test:i18n`;
  - `npx tsc --noEmit -p packages/contracts`, `-p client`, `-p expo-client/german-world-club`;
  - `npm run -w expo-client/german-world-club lint` (only problems that already exist).
- [X] T038 Run `npm run -w server seed:demo` against the **dev** database only if the user
  agrees, since it's additive. Otherwise check the seed with the seed test suite on `gwc_test`.
  It creates no job offers and owners have no `marketplace_post`.
- [ ] T039 Walk through `specs/021-member-marketplace-posting/quickstart.md` steps 1–9 by hand
  (web, the app on a device, a merchant login). Record the result in quickstart.md.

---

## Dependencies & execution order

- **Setup (T001)** → **Foundational (T002–T005)** → user stories.
- **US1 (T006–T016)** depends on T004 (permission constant). It is the MVP.
- **US2 (T017–T026)** depends on T002/T003. It can run alongside US1, but T020 appends to the
  migration file T013 creates, so T013 comes first.
- **US3 (T027–T028)** depends on US2's trigger (T020) and the edit check (T022).
- **US4 (T029)** is independent.
- **Polish (T035–T039)** comes after all stories.

Within a story, tests come first and must fail before implementation (except pure renames).

## Parallel examples

```text
Foundational: T003 ∥ T004 (after T002)
US1 tests:    T006 ∥ T007 ∥ T009 ∥ T010   (T008 alone: shared matrix file)
US1 impl:     T014 ∥ T015 ∥ T016          (T011 → T012 → T013 server-side, in order)
US2 tests:    T017/T018 (one file, sequential) ∥ T019
US2 impl:     T024 ∥ T025 ∥ T026          (T020 → T021 → T022 → T023 server-side)
US5:          T030 ∥ (any US1–US4 task); then T031 → T032 → T033 → T034
```

## Implementation strategy

1. **MVP = US1**: posting opens to every member. Shippable alone, but job offers would then be
   open to everyone, so **don't release US1 without US2**. Both are P1.
2. **US2**: the rule, at three layers (contract definition, application check, trigger).
3. **US3**: proves the wind-down. Mostly tests, because the trigger's design is what delivers it.
4. **US5**: web dialog polish, independent and shippable on its own.
5. **US4 and Polish**: docs, gates, the walkthrough.

Commit per phase on `021-member-marketplace-posting`. Don't push or open a PR unless asked.

---

description: "Task list for bringing the outcome of a save into view"
---

# Tasks: Bring the outcome of a save into view

**Input**: Design documents from `/specs/041-scroll-to-form-message/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [contracts/ui-contract.md](./contracts/ui-contract.md), [quickstart.md](./quickstart.md)

**Tests**: Included. The spec asks for an automated check that fails the build (FR-010, SC-005), and the repository's rule is that a test carries a counter-assertion wherever it would otherwise pass against code that did nothing. Write each story's tests first and watch them fail.

**Organization**: Foundation first (the hook, the two message components, the test helper), then one phase per user story, then the cross-cutting scan, docs and the full gate.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 member pages, US2 merchant and admin pages, US3 refusals in the same slot
- All paths are from the repository root. This feature touches `client/` only: no server, `packages/contracts`, or `expo-client` change, no new string, no new dependency.

---

## Phase 1: Setup

**Purpose**: Know the starting point, and have the one test helper every later test uses.

- [X] T001 On branch `041-scroll-to-form-message`, before any change, run `npm run -w client test`, `npx tsc --noEmit -p client` and `npm run -w client lint`, and note any failure that already exists (so it is never mistaken for this feature's, and is left alone).
  - *Result (2026-11-27)*: `tsc` clean. Lint: 58 errors and 1 warning already (`set-state-in-effect`, `only-export-components`, `no-unused-vars`, among them 6 in `member/Marketplace.tsx` and 2 in `console/admin/Push.tsx`); saved in the scratchpad to compare per file at T026. Tests: **flaky when the whole suite runs in parallel** (3 and then 6 failures on two consecutive runs, mostly 5 s timeouts and "unable to find" under load: `admin-referrals`, `merchant-offers-admin`, `server-faults`, `web-onboarding`, `edit-profile-upload`); all 50 tests in those five files pass when run on their own. So a red full run is judged per file, not by the count.
- [X] T002 [P] Create `client/tests/helpers/scroll-spy.ts` exporting `installScrollSpy()`. jsdom has no `Element.prototype.scrollIntoView`, so it defines one as a `vi.fn()` on the prototype and returns `{ spy, revealed(), options(), restore() }`: `revealed()` is the list of elements the spy was called on, in order (from `spy.mock.contexts`), `options()` the first argument of each call, and `restore()` deletes the property again. Tests call it in `beforeEach` and `restore()` in `afterEach`. Update the "Test helper" section of `specs/041-scroll-to-form-message/contracts/ui-contract.md` to this signature.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: The hook and the two components it reaches. No page changes until these exist.

- [X] T003 Create `client/src/lib/useReveal.ts` as specified in `contracts/ui-contract.md`: `useReveal<T extends HTMLElement = HTMLElement>(outcome: unknown): RefObject<T | null>`. It makes a `useRef<T>(null)`; a `useEffect` keyed on `[outcome]` does nothing when `outcome` is falsy, otherwise schedules `requestAnimationFrame` and, in the frame, calls `ref.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior })`; the cleanup cancels the frame. `behavior` is `'smooth'` unless `typeof window.matchMedia !== 'function'` or `matchMedia('(prefers-reduced-motion: reduce)').matches`, in which case `'auto'`, read inside the frame. Comment the *why* beside each oddity: `nearest` (does nothing when fully in view), keyed on the value and not on mount (a second identical save), one frame later (the Drawer's focus return scrolls too), the optional call (jsdom has none, as `Drawer` does for `showModal`). It must not move focus, read the outcome's text, or touch the network.
- [X] T004 [P] In `client/src/components/ui/Field.tsx`, give `FormMessage` an optional `ref?: Ref<HTMLDivElement>` prop (add it to `FormMessageProps`, `import type { Ref }` from `react`), put it on the root `div`, and add `scroll-my-6` to that div's class list. Nothing else changes: same markup, `role="alert"`, tones and props. Mention in the doc comment that the class only sets the gap `scrollIntoView` leaves (research R6).
- [X] T005 [P] In `client/src/components/ui/Callout.tsx`, give `Callout` the same optional `ref?: Ref<HTMLDivElement>` (in `CalloutProps`), on its root `div`, and add `scroll-my-6` to its class list. Nothing else changes.
- [X] T006 Create `client/tests/lib/use-reveal.test.tsx` (uses T002, T003, T004): a small test component that holds a `message` state, renders `<FormMessage ref={ref}>` when it is set, and has a button that sets it. Assert, using `installScrollSpy` and `waitFor` for the animation frame: it reveals the message element with `{ block: 'nearest', inline: 'nearest', behavior: 'smooth' }` (stub `window.matchMedia` to `{ matches: false }` for this one); `behavior` is `'auto'` when `matchMedia` reports reduced motion, and `'auto'` when `matchMedia` is absent (jsdom's default); a **new object with the same text** reveals again (two calls); no `scrollIntoView` on the prototype is not an error. Counter-assertions: nothing is revealed on first render with no message, when the message goes back to `null`, on a re-render with the same value, or when the component unmounts before the frame runs.

**Checkpoint**: the hook works on its own and every existing test still passes (`npm run -w client test`).

---

## Phase 3: User Story 1 - A member saves and sees that it worked (Priority: P1) 🎯 MVP

**Goal**: Edit profile and Marketplace bring their success message into view.

**Independent Test**: Quickstart rows 1 and 2, and `tests/member/outcome-reveal.test.tsx`.

- [X] T007 [US1] Write `client/tests/member/outcome-reveal.test.tsx` first, modelled on `client/tests/member/edit-profile-upload.test.tsx` (`renderConsole`, `mockCapabilityFetch`, `memberSnapshot`, JSON route mocks) and on `client/tests/member/marketplace-listing-management.test.tsx` for the drawer flow. Cases: **(a)** Edit profile: a successful save (the bio Save, or the avatar remove, whichever control the page has) reveals the `FormMessage` containing `t.memberProfile.saved`, and it is the only element revealed. **(b)** Marketplace: editing a listing from My listings and saving in the drawer reveals the `Callout` containing `t.memberMarketplace.saved` **as the last element revealed after the drawer has closed**; publishing a new listing reveals the one containing `t.memberMarketplace.posted`. Counter-assertions for each: nothing is revealed on load; nothing is revealed while the save request is held open (use a held response as in `tests/loading-states.test.tsx`); a save the server refuses, which the page does not show, reveals nothing. Run it and confirm it **fails** (the pages have no hook yet).
- [X] T008 [P] [US1] In `client/src/member/profile/EditProfile.tsx`: `const messageRef = useReveal<HTMLDivElement>(message)`, declared with the other hooks **above** the `if (!profile) return <PageLoader />` early return, and `ref={messageRef}` on `<FormMessage tone={message.tone}>`. Import from `../../lib/useReveal`. Nothing else changes (the handle change stays silent: spec Assumptions).
- [X] T009 [P] [US1] In `client/src/member/Marketplace.tsx`: `const outcomeRef = useReveal<HTMLDivElement>(posted || saved)` with the other hooks in `MemberMarketplace`, and `ref={outcomeRef}` on **both** the `posted` and `saved` `Callout`s (only one renders at a time, because both are reset when the drawer opens). Nothing else changes.
- [X] T010 [US1] Run `npm run -w client test -- tests/member`: T007 now passes and every other member suite is unchanged. Then do quickstart rows 1 and 2 by hand if the dev stack is up.

**Checkpoint**: US1 is shippable alone (Foundation plus two pages).

---

## Phase 4: User Story 2 - A merchant or a staff member saves and sees that it worked (Priority: P1)

**Goal**: Organisation profile, Store, Offer editor, Offer categories and Push do the same.

**Independent Test**: Quickstart rows 3 to 7, and the two test files below.

- [X] T011 [P] [US2] Write `client/tests/organisation/outcome-reveal.test.tsx` first, modelled on `client/tests/organisation/store.test.tsx` and `partner-profile-upload.test.tsx`. Cases: Organisation profile: a save reveals the message containing `t.organisationProfile.saved`. Store: a successful change (add a gallery photo, or save details) reveals the message containing `t.merchantStore.saved`; **a second successful change reveals it again**. Offer editor: updating an existing offer reveals the message containing `t.merchantOffers.saved`; **creating** one navigates to the new offer's page and reveals nothing (the page shows no message). Counter-assertions as in T007 (nothing on load, nothing while the request is held, nothing for a refused save the page does not show). Run it and confirm it fails.
- [X] T012 [P] [US2] Write `client/tests/console/outcome-reveal.test.tsx` first, modelled on `client/tests/console/push.test.tsx` and `merchant-offers-admin.test.tsx`. Cases: Offer categories: saving a rename reveals the message containing `t.adminCategories.saved`; saving a **second** one straight after, with the same text still on screen, reveals it again (two reveals, same element or its successor); moving a category (`move`, which shows no message) reveals nothing new. Push: sending a rehearsal reveals the notice (the `Callout` titled `t.pushAdmin.rehearsalQueued`). Counter-assertions as in T007. Run it and confirm it fails.
- [X] T013 [P] [US2] In `client/src/organisation/Profile.tsx`: `useReveal<HTMLDivElement>(message)` above the `if (!profile) return <PageLoader />` early return; `ref` on the `FormMessage`.
- [X] T014 [P] [US2] In `client/src/organisation/Store.tsx`: `useReveal<HTMLDivElement>(message)` above the **first** early return of the component (`store === null` renders the no-store page and returns); `ref` on the `FormMessage` in the main return. `run` already clears the message before each request and sets a new object after it, so no other change.
- [X] T015 [P] [US2] In `client/src/organisation/OfferEditor.tsx`: `useReveal<HTMLDivElement>(message)` above any early return; `ref` on the `FormMessage`. A create navigates away and sets no message, so it reveals nothing.
- [X] T016 [P] [US2] In `client/src/console/admin/OfferCategories.tsx`: `useReveal<HTMLDivElement>(message)` above `if (!items) return <PageLoader />`; `ref` on the `FormMessage`. Do **not** add a `setMessage(null)` before each request: the page keeps its message on screen between saves today and the new object per `setMessage` is what makes the second save count.
- [X] T017 [P] [US2] In `client/src/console/admin/Push.tsx`: `useReveal<HTMLDivElement>(notice)` in the compose component that owns `notice`, with its other hooks; `ref` on the `Callout` that shows `notice` (above the confirm panel). `send` already sets `notice` to `null` when it starts, so each queued message is a change.
- [X] T018 [US2] Run `npm run -w client test -- tests/organisation tests/console`: T011 and T012 pass and every other suite there is unchanged. Then quickstart rows 3 to 7 by hand if the dev stack is up.

**Checkpoint**: US1 and US2 together are every page of FR-009.

---

## Phase 5: User Story 3 - A refusal in the same place is seen too (Priority: P2)

**Goal**: A refusal shown in the same slot is revealed like a success. The pages of US1 and US2 already do it, because the hook takes whatever the page puts in the slot and never reads a tone (research R8); the one page with only a refusal is Offers.

**Independent Test**: Quickstart "Refusal" counter-check, and the cases below.

- [X] T019 [US3] In `client/src/organisation/Offers.tsx`: `useReveal<HTMLDivElement>(message)` above `if (!offers) return <PageLoader />`; `ref` on `<FormMessage tone="danger">{message}</FormMessage>`.
- [X] T020 [P] [US3] Append to `client/tests/member/outcome-reveal.test.tsx`: on Edit profile, choosing a file the page refuses before sending (an unsupported type, or one over `MEDIA_MAX_BYTES`) shows `t.memberThreads.mediaUnsupported` and reveals it. Counter: a server refusal the page only logs reveals nothing.
- [X] T021 [P] [US3] Append to `client/tests/organisation/outcome-reveal.test.tsx`: a 409 stale edit on Store reveals `t.merchantStore.conflict`; a 409 on Offer editor reveals `t.merchantOffers.refusals.conflict`; publishing from Offers with a `profile-incomplete` problem reveals `t.merchantOffers.refusals.profileIncomplete`. Counter: a refusal with any other problem type (which the page shows nothing for) reveals nothing.
- [X] T022 [P] [US3] Append to `client/tests/console/outcome-reveal.test.tsx`: adding an Offer category with a taken slug (409) reveals `t.adminCategories.slugTaken`. Counter: a 500 the page shows nothing for reveals nothing.
- [X] T023 [US3] Run `npm run -w client test -- tests/member tests/organisation tests/console`: all green. **If the refusals are to be left out** (the brief's literal "success only"), do not delete this phase's tests: instead pass `message?.tone === 'success' ? message : null` to `useReveal` at the call sites of T008, T013 to T016 and T019, and drop T020 to T022.

**Checkpoint**: every message a page shows in this slot is revealed.

---

## Phase 6: Polish and cross-cutting

**Purpose**: Make the next page unable to forget, document it, and run the whole gate.

- [X] T024 Create `client/tests/outcome-reveal-guard.test.ts`, in the manner of the source scan in `client/tests/loading-states.test.tsx` (`readdirSync` over `client/src`, `.tsx` only). Export-free helper `unrevealed(path, source)` returns a violation when the source matches `setMessage\(\{\s*tone:\s*'success'` or `<FormMessage[^>]*tone="success"` and does not contain `useReveal(`, unless the path is in an allow-list of `{ path, reason }` (the only entry: `auth/PasswordReset.tsx`, "the success replaces its own form, so it is where the person is looking"). Assertions: no real file is a violation; a second assertion names the seven pages of FR-009 (`member/profile/EditProfile.tsx`, `member/Marketplace.tsx`, `organisation/Profile.tsx`, `organisation/Store.tsx`, `organisation/OfferEditor.tsx`, `console/admin/OfferCategories.tsx`, `console/admin/Push.tsx`) and requires each to contain `useReveal(`; every allow-list entry must still match the success pattern (a stale entry fails). Counter-assertions: a fixture string with a success message and no hook **is** reported, one with the hook is not. If the pattern flags an unrelated file (a `StatusPill` tone), tighten the pattern; do not add the file to the allow-list. State the limit in a comment: a `Callout`-only outcome in a page not on the named list is not caught.
- [X] T025 [P] Add one paragraph to `CLAUDE.md` under Conventions: a page's outcome message (the `FormMessage` or `Callout` it shows after a save) is brought into view with `useReveal` from `client/src/lib/useReveal.ts` (feature 041, `specs/041-scroll-to-form-message/`). Rules that look optional and are not: pass the page's own message value, which must **change** on every outcome (a new object per `setMessage`), because scrolling on mount misses a second identical save; call the hook above any early `return <PageLoader />`; give the ref to the message element, never a wrapper; it is `nearest`, so a message already in view does not move; it runs one frame late so the Drawer's focus return cannot overtake it; `tests/outcome-reveal-guard.test.ts` fails the build for a success-toned message with no hook, but not for a `Callout`-only outcome.
- [X] T026 Run the full gate: `npm run typecheck`, `npm run -w client test`, `npm run -w client lint`, `npm run -w client test:i18n`, `npm run -w client test:tokens`. Compare with T001: no new failure, and no string or colour added. Confirm `git diff --stat` shows `client/`, `specs/` and `CLAUDE.md` only, with no `package.json` or lockfile change.
  - *Result (2026-11-27)*: `tsc` clean for `client`, `packages/contracts` and `expo-client`; **`server` has 1,160 type errors that predate this branch** (no `server/` file is changed here), so the root `npm run typecheck` is red for that reason alone. Lint: 59 problems before and after, none new (compared per file and rule). `test:i18n` and `test:tokens` pass. Client tests: 61 files, 652 tests, 651 pass; the one failure is `merchant-offers-admin > the redemption reports > gives staff with the grant the merchant filter`, the same load-flaky test as at T001, which passes on its own (11 of 11, twice). A second full run, after raising the async wait for this feature's tests, was 650 of 652 with that test and `member/settings > Profile → Settings link sits in the same row as Edit profile` (a `findByRole` that ran out of its default 1 s under load, in a page this feature does not touch); both pass on their own, three times in a row. All five of this feature's test files pass in every full run. `git diff --stat`: `client/`, `specs/`, `CLAUDE.md` only; no `package.json` or lockfile change.
- [ ] T027 Run the manual pass in `quickstart.md` in a real browser: the seven rows and the counter-checks (no move when in view, reduced motion, no move on load, focus, refusal, nothing else changed). It needs the dev stack (`npm run -w server dev`, `seed:demo`, `npm run -w client dev`). If the stack cannot be started, say so, and state in the PR that "already in view means no move" and the drawer sequence are unverified in a browser.
  - **Partly done, so left open.** The dev stack was not started: `server/.env` may point at a real database (see `CLAUDE.md`), and the Chrome extension was not connected. Instead, the *real* `useReveal`, `FormMessage`, `Callout`, `Drawer` and `Button` were served by a throwaway Vite server (scratchpad, not in the repo) and driven in headless Chrome over the DevTools protocol, in three page shapes (Edit profile, Marketplace with the real drawer, Offer categories). **16 of 16 checks passed**: nothing is revealed on first display; from the bottom of a 1,500 px page the message is revealed once, `block: 'nearest'`, eased, ending fully in view with the 24 px gap from `scroll-my-6`; with the message already in view the page does not move (`scrollY` 0 to 0, though the call was made); keyboard focus stays on the Save button; under `prefers-reduced-motion` the behaviour is `auto` and it jumps with no intermediate positions; in the Marketplace shape the drawer closes, focus returns to New listing, and *then* the message is revealed and is fully in view; a second save with the same words keeps the same element and is revealed again.
  - **Still to do by hand**, with the dev stack on a database that is safe to write to: the seven rows of `quickstart.md` on the real pages, and the stale-edit refusal in two tabs.

---

## Dependencies & Execution Order

- **Phase 1** has no dependency. **Phase 2** needs T002 for T006, and T003 and T004 for T006; T003, T004 and T005 are independent of each other. Phase 2 **blocks** every story.
- **US1** and **US2** both need Phase 2 and are independent of each other.
- **US3** needs US1 and US2: its tests are appended to their files, and the pages whose refusals it checks get their hook there. Its only new source change is T019.
- **Phase 6**: T024 needs every page of FR-009 done (US1 and US2); T025 can start any time after Phase 2; T026 and T027 come last.
- Within a story, tests (T007, T011, T012) come first and must fail before the page changes.

### Parallel opportunities

- T002 beside nothing else it depends on (it is before T003 only because T006 uses it); T004 and T005 beside T003.
- US1 and US2 can proceed together after Phase 2. Within US2, T011 and T012, then T013 to T017, are all different files.
- T020, T021 and T022 touch three different files.

```text
# After Phase 2, in parallel:
Task: "T008 EditProfile.tsx"        Task: "T013 organisation/Profile.tsx"
Task: "T009 Marketplace.tsx"        Task: "T014 organisation/Store.tsx"
                                    Task: "T015 organisation/OfferEditor.tsx"
                                    Task: "T016 console/admin/OfferCategories.tsx"
                                    Task: "T017 console/admin/Push.tsx"
```

---

## Implementation Strategy

1. **MVP**: Phase 1, Phase 2, then US1 (T007 to T010). The two pages named in the report, Profile and Marketplace, are fixed, with the shared pieces in place for the rest.
2. Add US2 (T011 to T018): every page of FR-009.
3. Add US3 (T019 to T023): refusals in the same slot, which mostly come for free.
4. Phase 6: the scan, the docs, the gate, and the browser pass.

## Notes

- The hook is called with the page's **own** message value. If a page's message is ever stored as a bare string or boolean that does not change between two outcomes, give the page a value that does; do not scroll on mount instead.
- Left alone on purpose, from the spec's Assumptions: forms that confirm nothing on screen today (staff moderation, applicant decisions, influencer grants, referral changes, the store switch, and the **handle change** on Edit profile), the in-place confirmations, and the missing live-region role on `Callout` (research R11).
- Commit after each phase, not each task.

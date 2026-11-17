---
description: "Tasks for 030: one loader for the web console and the app, on every waiting page and button"
---

# Tasks: One loader for the web console and the app

**Input**: `specs/030-main-loader/` (spec, plan, research, contracts/ui-contract.md, quickstart)
**Branch**: `030-main-loader`, created from `main` in T001. `main-loader.html` (repo root, untracked) is the design source; move it to `specs/030-main-loader/main-loader.html` in T001 so it is committed with the feature.
**Tests**: included for the web (vitest + Testing Library). The Expo app has **no test runner** (no jest or vitest in its `package.json`), so app tasks are verified by `npx tsc --noEmit` and the quickstart's device run, and the app's two hooks mirror the web hooks that are tested.
**Constraints that apply to every task**: user-visible text goes through the i18n catalogues in both languages (`npm run -w client test:i18n`; `client/tests/no-hardcoded-strings.test.ts`); errors keep the project convention (`console.error('<Component>.<fn>', error instanceof ApiError ? error.problem : error)`, no error state, no pop-up); colours from theme tokens only (`client/tests/tokens.test.ts`); no new dependency and nothing that needs a new EAS build.

## Format: `[ID] [P?] [Story] Description`

- US1: a page that is loading shows the loader (P1)
- US2: a button that waits for the server shows the loader and ignores presses (P1)
- US3: accessible and reduced-motion safe (P2)

---

## Phase 1: Setup

- [X] T001 `git switch main && git pull && git switch -c 030-main-loader`; move `main-loader.html` to `specs/030-main-loader/main-loader.html` with `mv` (it is untracked). Confirm `.specify/feature.json` points at `specs/030-main-loader`.
- [X] T002 Build the exact inventory the plan only estimated and save it as `specs/030-main-loader/inventory.md`. Web: `cd client/src && grep -rlE "\b(get|post|patch|put|del|upload)\(|[A-Za-z]+Api\.[a-z]+\(" . | grep '\.tsx$' | sort` (38 files at planning time). For each file record (a) **page-level loads** (a `useEffect` that fetches then renders `null`, text or nothing until data arrives: look for `if (!x) return null`, `status === STATUS.LOADING`, `t.console.loading`), (b) **buttons/forms with a request** (an `onClick`/`onSubmit` that awaits `post/patch/put/del/upload` or a `*Api` call, and the state it uses: `busy`, `saving`, `submitting`, none), (c) **in-place reloads** (load-more, refresh after save). App: `cd expo-client/german-world-club/src && grep -rlE "[A-Za-z]+Api\.[a-z]+\(|api\(" . | grep tsx | sort` (about 33 files) with the same three columns, noting each screen's existing `loading`/`busy` state. The adoption tasks below (T012–T019 and T021–T027) use this file as their checklist; correct their file lists from it if it differs.

## Phase 2: Foundational (blocks every story)

**Goal**: the primitives and hooks exist and are tested, on both platforms, before any page or button adopts them.

- [X] T003 Create `client/src/components/ui/Spinner.tsx`: `Spinner({ size = 'md', className = '', label })` returning an inline `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">` with the two paths copied from `main-loader.html` (ring at `opacity=".25"`, arc as the second path) **without** the `<animateTransform>`; the arc path is wrapped in a `<g className="animate-spin motion-reduce:animate-none" style={{ transformOrigin: '12px 12px' }}>` with `animationDuration: '750ms'`. Sizes `xs` 14, `sm` 20, `md` 32, `lg` 48 px (width and height attributes; `shrink-0`); default colour class `text-navy`, overridable through `className`. It carries no text itself (contract). Export default and named, `memo`, like `Button.tsx`.
- [X] T004 [P] Create `client/src/lib/useGrace.ts`: `useGrace(active: boolean, ms = 150): boolean` — true only once `active` has been continuously true for `ms`, false immediately when `active` goes false; clears its timer on unmount. Create `client/src/components/ui/PageLoader.tsx`: `PageLoader({ size = 'lg', label, delayMs = 150, className = '' })` — a centred flex block (`flex min-h-[40vh] items-center justify-center`, overridable by `className`) with `role="status"` `aria-live="polite"`, containing `<Spinner size={size} />` and `<span className="sr-only">{label ?? t.console.loading}</span>`; renders `null` until `useGrace(true, delayMs)` is true.
- [X] T005 Add the `loading` prop to `client/src/components/ui/Button.tsx` (`loading?: boolean`): when true, force `disabled`, set `aria-busy="true"`, keep the children in the layout but make them `invisible`, and render `<span className="absolute inset-0 flex items-center justify-center"><Spinner size="xs" className="text-current" /></span>` over them; add `relative` to the button's classes so the overlay sits inside it. The button's width and height must not change between `loading` true and false. No other prop changes; `memo` stays.
- [X] T006 [P] Create `client/src/lib/useAction.ts`: `useAction<A extends unknown[]>(name: string, fn: (...args: A) => Promise<unknown>, { onError }: { onError?: (error: unknown) => void } = {}): [(...args: A) => Promise<void>, boolean]`. `run` returns immediately when a `useRef` flag says an action is in flight (set synchronously, so two presses in one frame start one action), otherwise sets the ref and a `pending` state, awaits `fn`, and in `finally` clears both (only if still mounted). A rejection calls `onError` when given, else `console.error(name, error instanceof ApiError ? error.problem : error)`; it is never rethrown and never stored.
- [X] T007 [P] Web tests (each with a counter-assertion): `client/tests/components/spinner.test.tsx` (renders at the four sizes with the right `width`/`height`; has `aria-hidden`; arc group has `animate-spin motion-reduce:animate-none`; takes its colour from `className`); `client/tests/components/page-loader.test.tsx` (nothing before 150 ms with fake timers, visible after, `role="status"` with the label, a custom `delayMs`, and a render that unmounts at 100 ms never shows it); `client/tests/components/button-loading.test.tsx` (`loading` disables, sets `aria-busy`, shows a spinner, keeps the label in the DOM, ignores a click; `loading={false}` is a normal enabled button with no spinner); `client/tests/lib/use-action.test.ts` (two synchronous calls run `fn` once; `pending` is true while running and false after; a rejection is logged with `name` and does not throw and does not leave `pending` true; `onError` replaces the log); `client/tests/lib/use-grace.test.ts`. Run `npm run -w client test -- tests/components tests/lib`.
- [X] T008 Create `expo-client/german-world-club/src/components/spinner.tsx`: `Spinner({ size = 'md', color })`. Sizes `xs` 14, `sm` 20, `md` 32, `lg` 48. A `View` of the given size with `borderWidth = size / 8`, `borderRadius = size / 2`, `borderColor` = the colour at 25 % opacity, `borderTopColor` = the colour, rotated by an `Animated.Value` driven by `Animated.loop(Animated.timing(value, { toValue: 1, duration: 750, easing: Easing.linear, useNativeDriver: true }))` mapped with `interpolate` to `'0deg'→'360deg'`. Colour defaults to `useTheme().tint`. Reduced motion: read `AccessibilityInfo.isReduceMotionEnabled()` on mount and subscribe to `'reduceMotionChanged'`; when true, do not start the loop (the ring and static arc still show). `accessibilityElementsHidden` and `importantForAccessibility="no-hide-descendants"` (the label belongs to the screen loader and the button). Clean up the loop and the subscription on unmount.
- [X] T009 [P] Create `expo-client/german-world-club/src/hooks/use-grace.ts` (same behaviour as T004) and `src/hooks/use-action.ts` (same behaviour as T006, using `ApiError` from `@/api/client`). Create `src/components/screen-loader.tsx`: `ScreenLoader({ size = 'lg', label, delayMs = 150 })` — a centred `View` (`flex: 1`, centred) with `accessibilityRole="progressbar"`, `accessibilityLabel={label ?? t.common.loading}`, `accessibilityLiveRegion="polite"`, containing `<Spinner size={size} />`; renders `null` until `useGrace(true, delayMs)`. Confirm `t.common.loading` is the key at `src/i18n/en.ts:13` (it sits in the `common` group at the top) and exists in `de.ts`.
- [X] T010 Edit `expo-client/german-world-club/src/components/ui.tsx` `Button`: replace the `ActivityIndicator` (and its import if no longer used by another component in that file) with `<View style={StyleSheet.absoluteFill} ...><Spinner size="xs" color={foreground} /></View>` centred over the hidden label, keeping `disabled`, `accessibilityState={{ disabled, busy }}` and the no-size-change behaviour; remove the stray "add to your StyleSheet hidden" comment only if the style already exists. Run `npx tsc --noEmit` in `expo-client/german-world-club`.
- [X] T011 Run `npm run -w client test` (all green, including the new files), `npx tsc --noEmit` in `client/` and the app, `npm run -w client test:i18n` and `client/tests/tokens.test.ts` (the spinner uses only theme colours). Fix anything before the story phases start.

**Checkpoint**: the loader, the grace period, the button state and the action guard exist and are proven on the web; the app has the same primitives and type-checks.

## Phase 3: User Story 1 — pages that load show the loader (P1) 🎯 MVP

**Goal**: no console page or app screen is blank or text-only while its data loads.
**Independent test**: quickstart steps 2–3 (hold each page's data request open → loader; release → content; block → existing failure state).

- [X] T012 [US1] Web, shell-level loads: replace the text in `Authenticated` (`client/src/console/routes.tsx` ~l.130, the `<p>{t.console.loading}</p>` while `status === STATUS.LOADING`) with `<PageLoader className="min-h-svh bg-ground" />`; do the same for `client/src/onboarding/Application.tsx` (~l.89) and `Profiling.tsx` (~l.96); check `client/src/console/RequireGrant.tsx`, `lib/capabilities.tsx` and `ConsoleShell.tsx` from `inventory.md` for any other load text.
- [X] T013 [P] [US1] Web, staff pages: `console/AdminDashboard.tsx` (superadmin figures: `PageLoader` while `data === null && !failed`), `console/admin/{Applications,Influencers,Marketplace,Push,Referrals,Roles,ServerFaults,Threads}.tsx`: wherever the page renders nothing or `null` until its first load, render `<PageLoader />`; the existing failure callout must replace it when `failed` is true.
- [X] T014 [P] [US1] Web, member profile area: `member/profile/{Devices,MyProfile,MemberProfile,OrganisationView,Privacy,EditProfile}.tsx` (`if (!profile) return null` and similar become `<PageLoader />`; keep each page's failure state).
- [X] T015 [P] [US1] Web, member social and marketplace: `member/{Marketplace,Referrals,ListingRequest,MemberLayout}.tsx`, `member/messages/{Inbox,Conversation}.tsx`, `member/threads/{Activity,PostView}.tsx` and the lists in `member/threads/{Feed,PostList}.tsx`, `member/profile/ProfileTabs.tsx`: first load → `<PageLoader />`; **in-place** reloads and "load older/more" → `<PageLoader size="md" className="min-h-0 py-6" />` (or the md `Spinner` at the foot of the list) while the existing items stay on screen (spec US1.5).
- [X] T016 [P] [US1] Web, onboarding and organisation: `onboarding/{Register,VerifyMobile}.tsx`, `onboarding/profiling/steps.tsx`, `organisation/Profile.tsx` and any organisation home (`organisation/*`) with a load: `<PageLoader />` for first loads; city/country pickers that fetch options show an `sm` loader in place.
- [X] T017 [US1] Web, page-level tests in `client/tests/loading-states.test.tsx` using `renderConsole` / `mockCapabilityFetch` (see `tests/console/admin-dashboard.test.tsx`): for **one representative page per area** (staff dashboard, Roles, Devices/Settings, MyProfile, Inbox, Registration), a held request shows `role="status"`; after the 150 ms grace and not before; the data arriving replaces it with the content; a failing request replaces it with the failure state (counter-assertion: no `role="status"` remains). Add the **source scan** from research R5 in the same file: for every `.tsx` under `client/src` that is in `inventory.md` as a page-level load, fail when it contains `if (!` … `) return null` and no `PageLoader`/`Spinner` import, with an allow-list array (each entry a file and a one-line reason) for legitimate renders-nothing components such as `RequireGrant` and `PostBody`.
- [X] T018 [P] [US1] App, member screens: replace each "render nothing / text while loading" with `<ScreenLoader />` (first load) or `<Spinner size="md" />` at the foot of a list (load more / refresh) in `src/app/(member)/activity/index.tsx`, `activity/offer/[id].tsx`, `events/index.tsx`, `events/[id].tsx`, `marketplace/index.tsx`, `marketplace/messages/{index,[id]}.tsx`, `marketplace/request/[id].tsx`, `profile/{index,devices,edit,privacy}.tsx`, `threads/{index,[id]}.tsx`, `threads/member/[id].tsx`, `threads/people/[id].tsx`, `threads/quotes/[id].tsx`; the existing failure/empty states are unchanged (`src/hooks/use-paged.ts` already exposes loading state for lists: read it first and show the loader from it rather than adding state).
- [X] T019 [P] [US1] App, other areas: `src/app/(organisation)/{index,public-profile}.tsx`, `src/app/(profiling)/index.tsx`, `src/app/(applicant)/{waiting,verify-email}.tsx`, `src/app/r/[code].tsx`, `src/app/_layout.tsx` (the session-restoring splash, if it shows nothing or text), and `src/components/{listing-detail,post-card,referrals-view,profiling/cities}.tsx`.
- [X] T020 [US1] Run `npm run -w client test`, `npx tsc --noEmit` in `client/` and the app, `npm run -w client test:i18n`; then do quickstart steps 2–3 on the web with Slow 3G and record the result in `inventory.md` (which pages were checked).

**Checkpoint**: every page in `inventory.md` shows the loader while loading; US1 is shippable on its own.

## Phase 4: User Story 2 — buttons that wait show the loader (P1)

**Goal**: every request-sending button shows the loader inside itself, keeps its size, and sends once per press.
**Independent test**: quickstart steps 4–5.

- [X] T021 [US2] Web, sign-in and recovery: `client/src/auth/SignIn.tsx` (the "Sign in" submit: `loading={busy}`; keep the shown refusal handled by `describeProblem`, which is one of the documented exceptions) and `auth/PasswordReset.tsx` (request and confirm buttons). Convert their handlers to `useAction` only where there is no existing `busy` state; otherwise just pass `loading={busy}`.
- [X] T022 [P] [US2] Web, onboarding: `onboarding/{Register,VerifyMobile,Application,Profiling}.tsx`, `onboarding/profiling/steps.tsx` (Continue, Save, Send code, Resend, Confirm, Submit): `loading={busy}`; where the page shows the `email-in-use`/`mobile-in-use` refusal on the contact change, keep that state and pass it through `useAction`'s `onError`.
- [X] T023 [P] [US2] Web, profile and member actions: `member/profile/{EditProfile,HandleDialog,Devices}.tsx` (Save, Save handle, "Terminate this session" and its Confirm button), `member/{ListingRequest,Marketplace,Referrals}.tsx` (send request, publish, hide, replace link and the dialog's confirm), `member/threads/{Composer,PostCard,PostView,Activity}.tsx` (post, like, repost, follow, report), `member/messages/Conversation.tsx` (send) — each button whose handler awaits a request gets `loading`.
- [X] T024 [P] [US2] Web, staff and organisation: `console/admin/{Applications,Influencers,Marketplace,Push,Referrals,Roles,ServerFaults,Threads}.tsx` (Approve, Deny, Hide, Restore, Remove, Resolve, Send, Rehearse, Reverse, Disable, Save changes, Look up), `organisation/Profile.tsx` (Save), `console/ConsoleShell.tsx` (the Sign out button: it awaits the sign-out request) — `loading` on every button with a request; **no** loader on buttons that only open a dialog, close it, go back or cancel (spec US2.4).
- [X] T025 [US2] Web tests in `client/tests/loading-states.test.tsx` (add a `describe('buttons')`): for sign-in, Edit profile → Save, Settings → Terminate → Confirm and Roles → Save: with the request held, the button is `disabled` with `aria-busy="true"`, a second click sends no second request (count calls on the fetch mock), its bounding classes/width are unchanged, and when the request ends it is enabled again (including after a failure, with the failure handled as before); counter-assertion: "Cancel", "Back" and a dialog-opening button never show `aria-busy`. Run `npm run -w client test`.
- [X] T026 [P] [US2] App, sign-in and registration: `src/app/(public)/{sign-in,sign-in-code,verify-mobile,country}.tsx`, `src/session/session.tsx` (the sign-in call), `src/components/handle-form.tsx`: every submit `Button` gets `loading={busy}` (the app `Button` already supports it); where a screen has no busy state, use `useAction`.
- [X] T027 [P] [US2] App, member and organisation actions: `src/app/(member)/profile/{edit,handle,devices}.tsx` (Save, Terminate), `marketplace/{new,request/[id],messages/[id]}.tsx`, `threads/compose.tsx` (Post), `events/[id].tsx` (Register/Cancel), `(organisation)/public-profile.tsx`, `(profiling)/index.tsx` and `src/components/profiling/steps.tsx` (Continue, Submit), `src/components/{post-card,listing-detail}.tsx` (like, repost, report, send), `src/notifications/notification-router.tsx` only if it triggers a visible button.
- [X] T028 [US2] Run `npx tsc --noEmit` in the app and the client; then quickstart steps 4–5 on the web, and steps 4–5 on a device for sign-in, compose and save; record the result in `inventory.md`.

**Checkpoint**: no request-sending button can be pressed twice, and each shows the loader.

## Phase 5: User Story 3 — accessible and reduced-motion safe (P2)

**Goal**: the loader is announced and stops under reduced motion on both platforms.
**Independent test**: quickstart steps 6–7.

- [X] T029 [US3] Web accessibility checks in `client/tests/a11y/` (see the existing files there for the axe setup): a page showing `PageLoader` and a page showing a busy `Button` have no axe violations; the status region is announced (`role="status"`, label from `t.console.loading`); in `client/tests/components/spinner.test.tsx` add that the arc has `motion-reduce:animate-none` (the class is what honours the OS setting; jsdom cannot evaluate the media query, so assert the class). Add the German and English label if the button needs its own busy text (reuse `t.console.loading`; add a new key only if a screen reader would otherwise hear nothing).
- [X] T030 [P] [US3] App: confirm in `components/spinner.tsx` (T008) that reduced motion starts no loop and that `ScreenLoader` and `Button` announce (`accessibilityRole="progressbar"` / `accessibilityState.busy`); check dark-scheme colours: `Spinner` default `theme.tint` is `#8FB3E8` in dark (`constants/theme.ts`), and inside a primary button the arc uses `theme.onTint`; verify contrast of both against `theme.background` and the button background and note the ratios in `inventory.md`. Fix the colour choice in `Spinner` if a ratio is below 3:1 (non-text UI minimum).

## Phase 6: Polish

- [X] T031 [P] Docs: add a short paragraph to `CLAUDE.md` ("The loader, feature 030"): one `Spinner` per platform from `main-loader.html`; `PageLoader`/`ScreenLoader` for pages, `Button loading` for buttons, `useAction` for handlers; the 150 ms grace; no new native dependency; the source-scan test and its allow-list; and that the app `ActivityIndicator` is gone. Update `specs/030-main-loader/quickstart.md` if a step changed.
- [X] T032 Final run: `npm test` in `client/`, `npx tsc --noEmit` in `packages/contracts`, `client` and `expo-client/german-world-club`, `npm run -w client test:i18n`; confirm `git status` shows no stray files and that `main-loader.html` is no longer in the repo root. Do not commit unless asked.

---

## Dependencies & Execution Order

- T001 → T002 → Phase 2. In Phase 2: T003 → T004/T005/T006 ([P] after T003 where they import the Spinner) → T007; the app side T008 → T009 → T010 is independent of the web side and can run in parallel with it; T011 after both.
- US1 needs Phase 2. T012 first (shell), then T013–T016 in parallel, then T017; T018 and T019 in parallel with the web tasks; T020 last.
- US2 needs Phase 2 and can run in parallel with US1 (different handlers in the same files: if two people work, serialise per file, or do US1 and US2 for a file together). T021 → T022–T024 in parallel → T025; T026/T027 in parallel → T028.
- US3 after Phase 2; T029 and T030 in parallel.
- T031, T032 last.

## Parallel examples

- Phase 2: T004, T006 together after T003; the whole app primitive set (T008–T010) alongside the web set.
- US1: T013, T014, T015, T016 together (web) and T018, T019 together (app).
- US2: T022, T023, T024 together (web) and T026, T027 together (app).

## Implementation strategy

**MVP = Phases 1–3 (US1)**: the primitives plus every waiting page. That alone removes the blank screens. **US2** is the second ask and prevents double submissions; do it file by file together with US1 if you are already in the file. **US3** is small and must not be skipped: reduced motion and the announcement are part of the loader being correct. The source-scan test (T017) is what keeps the next page from going blank again, so keep its allow-list honest.

## Implementation status (2026-11-17)

All 32 tasks done on branch `030-main-loader`; nothing committed.

- Client: 540/540, `tsc` clean in client, contracts and the app, `test:i18n` passes. New: `tests/components/{spinner,page-loader,button-loading}`, `tests/lib/{use-action,use-grace}`, `tests/loading-states` (page loaders, busy buttons, source scan), `tests/a11y/loader`.
- Not verified: anything on a real device or in a real browser (the app has no test runner, so its changes are checked by `tsc` only), the Slow-3G click-through in quickstart steps 2-8, and the dark-scheme contrast ratios of the app spinner (T030 asks for them; not measured).
- `inventory.md` records what was converted and what was deliberately left without a loader.

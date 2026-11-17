# Research: One loader for the web console and the app

Findings are from reading the code on 2026-11-17.

## R0. What `main-loader.html` is
A single inline `<svg viewBox="0 0 24 24" fill="hsl(228, 97%, 42%)">` with two paths: a full ring at `opacity=".25"` and an arc animated by SMIL `animateTransform` (`rotate`, `0.75s`, infinite). It has no size (the caller sets it) and a fixed bright blue. Both are the two things the request says to adjust.
- **Decision**: keep the geometry; `fill="currentColor"`; rotate with CSS.
- **Rejected**: embedding the file as an `<img>` (cannot take the theme colour or follow reduced motion).

## R1. Web: where the API is called
38 `.tsx` files call `get/post/patch/put/del/upload` or a `*Api.*` helper:
`auth/{PasswordReset,SignIn}`, `console/{AdminDashboard,ConsoleShell,routes}`, `console/admin/{Applications,Influencers,Marketplace,Push,Referrals,Roles,ServerFaults,Threads}`, `lib/capabilities`, `member/{ListingRequest,Marketplace,MemberLayout,Referrals}`, `member/messages/{Conversation,Inbox}`, `member/profile/{Devices,EditProfile,HandleDialog,MemberProfile,MyProfile,OrganisationView,Privacy}`, `member/threads/{Activity,Composer,PostBody,PostCard,PostView}`, `onboarding/{Application,Profiling,Register,VerifyMobile}`, `onboarding/profiling/steps`, `organisation/Profile`.
Roughly 30 files in `client/src` already mention a `busy/loading/saving/submitting/pending` state (a `grep` that also matches a few files outside this list), so most buttons need only `loading={busy}`; the rest need a state or `useAction`. The exact per-file list is built in the first implementation task.
- Page pattern today: `if (!data) return null` (`Devices.tsx`, `MyProfile.tsx`, `Roles.tsx` …) or `<p>{t.console.loading}</p>` (`onboarding/Application.tsx`, `Profiling.tsx`, `routes.tsx:132`). Both become `PageLoader`.
- Existing string: `t.console.loading` ("Loading …"), reused as the accessible label.

## R2. App: where the API is called
About 33 files: the member screens (`activity`, `events`, `marketplace` incl. `messages/`, `new`, `request/[id]`, `profile` incl. `devices`, `edit`, `handle`, `privacy`, `threads` incl. `compose`, `[id]`, `member/[id]`, `people/[id]`, `quotes/[id]`), `(organisation)`, `(profiling)`, `(public)/country`, plus `components/{listing-detail,post-card,referrals-view,profiling/cities,handle-form}` and `session/session.tsx`. Roughly 40 app files already mention a busy/loading flag (same caveat); the exact list is built in the first implementation task.
- The app `Button` already has `loading` (a hidden label plus an `ActivityIndicator` over it, no width change), so button adoption is `loading={busy}`; only the indicator changes to the shared `Spinner`.
- **Decision**: replace `ActivityIndicator` everywhere for one look; `ActivityIndicator` is the platform's own spinner and would not match the web.

## R3. No new native dependency
`react-native-svg` is not in `expo-client/german-world-club/package.json`. Adding it is a native module, so it needs a new EAS build (CLAUDE.md, FR-011). A ring with one coloured border side rotated by `Animated` reproduces the same figure with built-ins.
- **Rejected**: `react-native-svg` (new build); a Lottie animation (new dependency); `ActivityIndicator` (a different look per platform and not the supplied design).

## R4. Reduced motion
- Web: SMIL ignores `prefers-reduced-motion`, so the arc is rotated with a CSS animation (`animate-spin`) and `motion-reduce:animate-none` stops it; a stopped arc still reads as a loader because the ring and arc are both drawn.
- App: `AccessibilityInfo.isReduceMotionEnabled()` plus the `reduceMotionChanged` event; when on, no `Animated.loop` is started.

## R5. Not leaving a page blank by accident
Hand-checking 70 files will miss some and the next page written will repeat the habit.
- **Decision**: a source-scan test (like `tests/dev-server.test.ts` scanning fetch calls) in `client/tests/loading-states.test.tsx` that, for every console component calling the API, fails when it contains `return null` guarded by a `!`-data check without a `PageLoader` in the same file. The pattern is narrow enough to be precise (`if (!x) return null`), and an allow-list with a reason handles the legitimate cases (a component that is meant to render nothing until a parent supplies data).
- **Rejected**: a lint rule (the repo has no custom ESLint plugin); wrapping every route in Suspense (the pages fetch in effects, not with Suspense).

## R6. Buttons and re-entry
A `disabled` attribute set from state lags one render: two presses in the same frame can both fire. `useAction` guards with a `useRef` flag set synchronously and cleared in `finally`, and `Button`'s `loading` also sets `disabled` + `aria-busy`.
- The project's rule for failures stays: `catch → console.error('<Component>.<fn>', error instanceof ApiError ? error.problem : error)`, no error state, and the shown-as-well exceptions (sign-in refusal, `email-in-use`) keep their own state. `useAction` therefore **logs and swallows** by default and accepts an `onError` for those exceptions.

## R7. Grace period
A loader that appears for 40 ms is worse than none. `useGrace(active, 150)` returns true only once `active` has been true for 150 ms and resets when it goes false. Page loaders use it; buttons do not (the press needs immediate feedback and the button is already on screen).

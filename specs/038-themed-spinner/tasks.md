---

description: "Task list for the themed, growing-arc loader (feature 038)"
---

# Tasks: A themed, growing-arc loader on the web and in the app

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), the supplied sample [loading-spinner.html](./loading-spinner.html)

**Tests**: included on the web (a test that renders the component and reads the stylesheet). The app has no test runner, so its tasks are checked by `typecheck`, `lint`, a numeric check of the geometry and a render of the real component through `react-native-web`.

## Format: `- [ ] [ID] [P?] [Story] Description with file path`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 the web console shows the new loader, US2 the app shows the same loader, US3 it stays accessible and honours the person's settings

## Notes that apply to every task

- Colours come from each platform's theme. **No hex, `rgb()` or named colour from the sample may appear** in either implementation (SC-002); `client/scripts/check-tokens.mjs` enforces it for the web.
- The loader stays decorative (`aria-hidden`, no text). Its wrappers, sizes (14, 20, 32, 48 px) and the grace period do not change.
- No new native module and no new dependency in the app, so no new EAS build.
- Read the Expo SDK 57 docs before changing app code (`expo-client/german-world-club/AGENTS.md`); this change uses only `Animated` and `View` from React Native, already used by the loader.

---

## Phase 1: Setup

- [x] T001 Create branch `038-themed-spinner` from `main` (this is a separate feature from 037, so it is reviewable on its own), create `specs/038-themed-spinner/`, and save the supplied sample unchanged as `specs/038-themed-spinner/loading-spinner.html`.
- [x] T002 [P] Prove the sample's technique survives this build before writing against it: put the stylesheet in `client/src/styles/spinner.css`, run `npx vite build` in `client`, and confirm the output keeps the three `@property` rules (including the one whose `initial-value` starts with a comma), both `@supports` blocks, the forced-colours block and the reduced-motion block. **Result:** all survive, and the build adds a `-webkit-` mask prefix and widens the `border-area` test by itself.

---

## Phase 2: Foundational (blocks US2)

- [x] T003 Check the app's arc geometry against the sample's keyframes before building any UI. The arc is drawn from two half-rings, so verify numerically (a one-off script, not committed) that across 101 points of the 3 s cycle the covered angles are exactly `[0, L]` with `L` = head minus tail from the keyframes (tail 0, 100, 360 degrees; head 3, 358, 363). **Result:** the worst error is 0.0 degrees at every point, and the two stop points where each half changes from growing to full are `177/510` and `333/510` of the cycle.

**Checkpoint**: the technique works on the web build and the app geometry is right.

---

## Phase 3: User Story 1 - The web console shows the new loader (Priority: P1) MVP

**Goal**: every web loader shows a ring with an arc that grows, shrinks and turns, in the club's theme colours.

**Independent test**: open a console page with its data request held open, and press a button with its request held open.

- [x] T004 [US1] Write `client/src/styles/spinner.css`: the three registered properties, `.gwc-spinner` with the conic-gradient arc, the four sizes by `data-spinner` (14/2, 20/2, 32/3, 48/4 px), the `border-area` clip with a mask fallback, the forced-colours block, `gwc-spinner-turn` (1.5 s) and `gwc-spinner-dash` (3 s, tail 0/100/360, head 3/358/363), and the reduced-motion block. Colours only through `currentColor` and `color-mix`; flat rules, no nesting.
- [x] T005 [US1] Change `client/src/components/ui/Spinner.tsx` to render `<span aria-hidden="true" data-spinner={size} class="gwc-spinner …">` with the same `size` and `className` props (default `text-navy`), keep `SPINNER_SIZES`, add `SPINNER_THICKNESS`, and import `./styles/spinner.css` in `client/src/konsole.tsx` beside `theme.css`. `PageLoader` and `Button` are not edited: they inherit it.
- [x] T006 [P] [US1] Rewrite `client/tests/components/spinner.test.tsx`: the component half (sizes, order, decorative, default and overridden colour) and a half that reads `spinner.css` (each size's `--gwc-size` and `--gwc-thickness` equal the component's tables; arc and ring use `currentColor` and a 25% `color-mix`; no hex, `rgb()` or `prefers-color-scheme` and only `Canvas` and `CanvasText` as named colours; the dash keyframes; the reduced-motion block slows to 6 s, detaches the dash and sets a 158° arc; nothing in the file stops the animation). Counter-assertions: put the sample's `#2563eb` back and change the reduced-motion duration to `0s` and each fails the suite. **Done and both mutations confirmed.**
- [x] T007 [US1] Look at it in a real browser: build `client`, serve a page that uses the compiled stylesheet, and with headless Chrome capture all four sizes, the `xs` size inside a navy, a gold and an outline button, and eight frozen points of the dash cycle. **Result:** the arc runs from a dot to about three quarters of the ring and back, the ring is thin and even at every size, and the arc takes each button's text colour.
- [x] T008 [US1] Run the whole web suite, `npx tsc --noEmit`, `npm run test:i18n` and `npm run test:tokens` in `client`. **Result:** 603 tests pass, typecheck and i18n parity are clean, and the token check passes. Six other tests looked for the old `svg` element (`loading-states`, `a11y/loader`, `button-loading`, `page-loader`) and were pointed at `[data-spinner]`, including two "there is no spinner" assertions that would otherwise have passed for the wrong reason. One test, `console/merchant-offers-admin`, failed once and passes alone: it is flaky, it does not touch the loader, and it also failed in an earlier run before this feature.

**Checkpoint**: the web shows the new loader; the loading-state and token checks still pass.

---

## Phase 4: User Story 2 - The app shows the same loader (Priority: P1)

**Goal**: every app loader shows the same figure and timing in the theme's colours, in light and dark.

**Independent test**: open a screen with its request held open, in light and dark.

- [x] T009 [US2] Rewrite `expo-client/german-world-club/src/components/spinner.tsx`. Keep the API (`size`, `color`) and `SPINNER_SIZES`; add `SPINNER_THICKNESS` with the web's values. Draw the ring (a quarter-strength tint) and an arc built from two clipped half-rings whose rotations are interpolated from one `dash` value (two 1.5 s eased halves, the sample's `cubic-bezier(.42, 0, .58, 1)`) and a `turn` value (1.5 s linear). All motion on the native driver (not on web, as before); each `interpolate` built once in `useMemo`. Colour is `color ?? theme.tint`, nothing else. No new module, and no `react-native-svg`.
- [x] T010 [P] [US2] Typecheck and lint it: `npx tsc --noEmit` and `npx expo lint src/components/spinner.tsx` in `expo-client/german-world-club`. The previous file had two `react-hooks/refs` errors from `useRef(new Animated.Value(0)).current`; use `useState(() => new Animated.Value(0))` so those are gone. **Done: clean, and the app's lint count drops by two.**
- [x] T011 [US2] Render the real component and look at it: bundle `spinner.tsx` through `react-native-web` into a throwaway page (stubbing only `useTheme` with the two palettes' tint, background and text), then capture real-time frames over one cycle in headless Chrome through the DevTools protocol, in light and in dark, at all sizes and as a button's label colour. **Result:** the same grow-shrink-turn as the web, pale-blue tint in dark, a dark spinner on the gold dark-theme button.
- [x] T012 [US2] Fix what T011 showed: faint hairlines at the clip seams, from the left half-ring's edges sitting exactly on the clip's edges while it has nothing to draw. The left half is now opacity 0 outside the part of the cycle where the arc is longer than 180° (ramp 0.0005 of the cycle, too short to see), and is not rendered at all under reduced motion. **Re-rendered: no hairlines.**
- [ ] T013 [US2] On a real iPhone and a real Android phone, open a screen that loads (Marketplace, Threads) and press a button that waits (Sign in): the arc grows and shrinks smoothly, the `xs` size in a button is legible, nothing stutters with several loaders on screen. **Needs a device; not done here.**

**Checkpoint**: the app shows the same loader; typecheck and lint are clean for the changed file.

---

## Phase 5: User Story 3 - Accessible and honours the person's settings (Priority: P2)

**Goal**: reduced motion slows the loader and fixes its arc, forced colours use system colours, and screen readers hear nothing extra.

**Independent test**: turn on reduced motion (and forced colours on the web) and open a loading page.

- [x] T014 [US3] Reduced motion on both platforms, as the sample does: 6 s a turn, no grow-and-shrink, a fixed 158° arc, and never stopped. Web: the `prefers-reduced-motion` block in `spinner.css`. App: `useReduceMotion` (already in the file) picks the 6 s turn and the fixed arc. **Verified in Chrome with reduced motion forced on: a fixed arc of about 158° turning about 60° a second, in the app component; the web rule is asserted by the stylesheet test.**
- [x] T015 [P] [US3] Forced colours on the web: the `forced-colors: active` block opts out of colour adjustment and uses `CanvasText` and `Canvas`. Asserted by the stylesheet test; it was not rendered in forced-colours mode.
- [ ] T016 [US3] With VoiceOver or TalkBack on, and (web) Windows High Contrast, open a loading page and a waiting button: the loader itself announces nothing, the wrapper still announces that it is busy, and the arc is visible in system colours. **Needs a device or a Windows machine; not done here.**

**Checkpoint**: nothing about announcements changed; motion preferences are honoured.

---

## Phase 6: Polish

- [x] T017 [P] Record the change where the next reader will look: add a note at the top of `specs/030-main-loader/contracts/ui-contract.md` saying 038 supersedes its figure, ring width, speed and "nothing rotates under reduced motion" (everything else in that contract stands); update the loader paragraph in `CLAUDE.md` (the figure, the stylesheet, `SPINNER_THICKNESS`, the half-ring construction and why, the reduced-motion decision).
- [ ] T018 Final gate before the pull request: `npx tsc --noEmit` in `client` and in `expo-client/german-world-club`, `npm run test:i18n` in `client`, the whole web suite, the app lint (no new problem in a changed file), and `npm test` for contracts if touched (it was not). **Done:** all of the above, and `spinner.tsx` is no longer flagged by lint (its two old `react-hooks/refs` errors are gone). **Left:** T013 and T016 on devices.

---

## Dependencies and order

```
T001 ─► T002 ─► T003 ─┬─► US1: T004 ─► T005 ─► T006, T007 ─► T008 ──┐
                      └─► US2: T009 ─► T010, T011 ─► T012 ─► T013 ──┼─► US3: T014..T016 ─► T017 ─► T018
```

- US1 and US2 are independent once T002 and T003 are done: different files, different platforms.
- US3 touches both implementations, so it follows them.
- T006 and T007 can run in parallel; so can T010 and T011.

## Implementation strategy

1. **MVP = US1.** The web alone is a complete, shippable change; the app keeps feature 030's loader until US2 lands.
2. Add US2 so the two faces match again (feature 030's point). Do not ship US2 without US1: a mismatch is worse than either.
3. US3 is already inside both implementations; its remaining tasks are the on-device checks.

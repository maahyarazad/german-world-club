# Implementation Plan: One loader for the web console and the app

**Branch**: `030-main-loader` (create from `main`) | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

## Summary

One loader, drawn from `main-loader.html` (a faint ring with a rotating arc), built twice because the two platforms cannot share a component: a React `Spinner` for the web console and a React Native `Spinner` for the Expo app. Both take a `size` and an accessible label, take their colour from the theme, and stop rotating under reduced motion. On top of that, three small pieces make it reach every screen without hand-writing state in 70 files:

- **`PageLoader`** (centred, large, 150 ms grace) replaces every "render nothing while `data` is null" and every ad-hoc "Loading …" line.
- **`Button`'s new `loading` prop** (web) and the existing one (app) show the small loader inside the button at constant size and ignore presses.
- **`useAction`** (both platforms): `const [run, pending] = useAction('Component.save', async () => { … })` wraps a click handler, tracks `pending`, ignores re-entry, and logs a failure the project's way (`console.error('<Component>.<fn>', problem)`) with no error state, so adopting it does not change how errors are reported.

No server change, no new dependency, no new native build, no data.

## Technical Context

**Language/Version**: TypeScript; React 19 + Vite + Tailwind (web), Expo SDK 57 / React Native (app)
**Primary Dependencies**: none added. The app already has `react-native` `Animated`; `react-native-svg` is **not** installed and adding it would need a new EAS build (CLAUDE.md), which FR-011 forbids.
**Storage**: N/A
**Testing**: vitest + Testing Library (web); the app has no component test runner in this repo, so its behaviour is covered by `tsc`, the pure parts (grace-period hook, reduced-motion) extracted into plain TS tests where the app can run them, and the quickstart's manual device run
**Target Platform**: web console (modern browsers), iOS and Android
**Project Type**: web client + mobile client (workspaces)
**Performance Goals**: a response under 150 ms shows no loader (SC-003); the animation runs on the compositor (CSS transform on web, native-driven `Animated` on the app), never on the JS thread
**Constraints**: strings via the i18n catalogues in both languages (`client/tests/no-hardcoded-strings.test.ts`, `npm run -w client test:i18n`); error handling convention unchanged (no error state, `console.error`); colours from theme tokens only (`client/tests/tokens.test.ts` guards the palette)
**Scale/Scope**: about 38 web files and about 33 app files touch the API (research R1, R2)

## Constitution Check

*Checked against `.specify/memory/constitution.md` (4.0.0 once PR #20 is on `main`).*

| Principle | Result |
|---|---|
| I One rule set | PASS. Nothing here is a business rule; it renders waiting. Shared copy lives in each platform's i18n. |
| II Declare posture | N/A. No routes. |
| III Published = real | N/A. Gated surfaces only; the public landing page has no data request and is untouched. |
| IV Integrity in the DB | N/A. |
| V Failure explicit | PASS. The loader never hides a failure: a rejected request ends the loading state and the existing failure UI shows (FR-010); no spinner without an end. |
| VI Server shapes output | N/A. |
| Baseline | N/A. |

No violations; Complexity Tracking is empty. Post-design re-check: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/030-main-loader/
├── plan.md  research.md  quickstart.md
├── contracts/ui-contract.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```
(No `data-model.md`: the feature has no data.)

### Source Code

```text
client/src/components/ui/Spinner.tsx            # the ring + arc, sizes, currentColor, reduced motion
client/src/components/ui/PageLoader.tsx         # centred, large, grace period, role=status
client/src/components/ui/Button.tsx             # + `loading` prop
client/src/lib/useAction.ts                     # pending + re-entry guard + project error logging
client/src/lib/useGrace.ts                      # "show only if still waiting after N ms"
client/src/i18n/{en,de}.ts                      # console.loading reused; + button/page labels if needed
client/src/{console,member,onboarding,organisation,auth}/**  # adopt PageLoader / loading / useAction (R1)
client/tests/components/{spinner,page-loader,button-loading}.test.tsx, client/tests/lib/use-action.test.ts
client/tests/loading-states.test.tsx            # page-level: held request -> loader; arrives -> content; fails -> failure state
expo-client/german-world-club/src/components/{spinner,screen-loader}.tsx
expo-client/german-world-club/src/components/ui.tsx    # Button uses Spinner instead of ActivityIndicator
expo-client/german-world-club/src/hooks/{use-action,use-grace}.ts
expo-client/german-world-club/src/app/**                # adopt ScreenLoader / loading / useAction (R2)
expo-client/german-world-club/src/i18n/{en,de}.ts       # accessibility labels
```

**Structure Decision**: a primitive per platform next to the existing UI kit (`client/src/components/ui/`, `expo-client/.../components/`), plus two tiny hooks per platform. The two hooks are written twice on purpose (React DOM vs React Native have no shared package for UI), but they are the same 20 lines, so a test file on each side pins the same behaviour.

## Design decisions (detail in research.md)

- **D1** The supplied SVG is reproduced, not embedded: ring at 25 % opacity plus one arc, `fill="currentColor"`. SMIL `animateTransform` is replaced by a CSS rotation so reduced motion can switch it off (SMIL ignores `prefers-reduced-motion`).
- **D2** Colour: web `currentColor`, defaulting to `text-navy`; app `theme.tint` (and `theme.onTint` inside a primary button). The supplied `hsl(228,97%,42%)` is dropped.
- **D3** Sizes (px): `xs` 14 (inside a button), `sm` 20, `md` 32 (cards, in-place reloads), `lg` 48 (page). The app uses the same numbers.
- **D4** The page loader waits 150 ms (`useGrace`) before showing; a button shows its loader immediately (the press itself is the feedback to match).
- **D5** The app's loader is `Animated` + a bordered `View` ring (faint border plus one coloured side), with `useNativeDriver: true`. Rotation stops when `AccessibilityInfo.isReduceMotionEnabled()` is true.
- **D6** `useAction` guards re-entry with a ref (not state) so two presses in the same frame still send one request, and never stores the error.
- **D7** Adoption is mechanical and per file; the inventory in research.md is the checklist, and a source-scan test fails when a console component file calls the API and renders nothing while loading (R5).

# Implementation Plan: Keep onboarding screens clear of the phone's status bar

**Branch**: `033-profiling-safe-area` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/033-profiling-safe-area/spec.md`

## Summary

Screens in the Expo app that hide their navigation header (the profiling group, the applicant "waiting" screen, the referral-link screen) draw their first line under the phone's clock and Wi-Fi indicators, because the shared containers protect only the bottom edge. Fix it once, in the shared containers: `FormScreen` and `Centered` (and so `Loading`) in `src/components/ui.tsx` become safe-area aware on the top edge as well. They use `react-native-safe-area-context`'s native `SafeAreaView`, which measures the real overlap of the view with the status bar and cut-out, so a screen that already sits below a navigation header gets no extra gap (FR-004) and no fixed number is used (FR-002). See [research.md](research.md).

Also on this branch (User Story 3): the app's 11 `FlatList`s become `FlashList`s from `@shopify/flash-list` 2.0.2, a JavaScript-only dependency, so FR-007 still holds.

## Technical Context

**Language/Version**: TypeScript 5, React Native 0.86, Expo SDK 57 (expo-router ~57.0)

**Primary Dependencies**: `@shopify/flash-list 2.0.2` (added for US3); `react-native-safe-area-context ~5.7` (already installed; already used by `FormScreen`, `country.tsx`, `(public)/index.tsx`); expo-router supplies the provider

**Storage**: N/A

**Testing**: `tsc --noEmit` (the app has no test runner) plus the manual device walk-through in [quickstart.md](quickstart.md)

**Target Platform**: iOS (notch and Dynamic Island) and Android (status bar, cut-out, edge-to-edge)

**Project Type**: mobile-app (Expo workspace member `expo-client/german-world-club`)

**Performance Goals**: N/A (layout only)

**Constraints**: no new native module, so no new EAS build (FR-007); bottom inset and keyboard behaviour unchanged (FR-005)

**Scale/Scope**: two shared components; roughly 20 screens use them

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict |
|---|---|
| I. One rule set, three clients | Pass. No shape or rule is added; nothing is duplicated on a client. |
| II. Declare every posture | N/A. No route. |
| III. Published state matches real state | N/A. |
| IV. Integrity in the database | N/A. |
| V. Failure explicit and bounded | N/A. No request. |
| VI. The server shapes what leaves it | N/A. |
| Quality gates | Pass with a stated limit: the app has no test runner, so verification is `tsc` plus a manual walk-through, as for features 030 and 031's app work. |

No violations; Complexity Tracking is empty. Re-checked after design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/033-profiling-safe-area/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── tasks.md             # /speckit-tasks
```

(No `contracts/`: no interface is added or changed.)

### Source Code (repository root)

```text
expo-client/german-world-club/src/
├── components/ui.tsx          # FormScreen + Centered: top edge protected (the fix)
└── app/(profiling)/           # unchanged; the screens it hosts inherit the fix
```

**Structure Decision**: change the two shared containers only. No screen gets its own padding, which is the "one shared place" the spec asks for (FR-003).

## Complexity Tracking

None.

# Implementation Plan: Register focus chain and partner question marking

**Branch**: `016-register-focus-partner-title` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/016-register-focus-partner-title/spec.md`

## Summary

There are three asks, and one of them is already met:

1. **Register (Expo)**: pressing return moves to the next field. `useRef` per field,
   `returnKeyType`/`submitBehavior`/`onSubmitEditing`, and auto-advance on full Day/Month,
   because the iOS number pad has no return key. `TextField` and `MobileField` accept a `ref`.
2. **Partner heading (Expo `StepView`)**: only the `partnerTitle` text ("Your partner:" /
   "Ihre Partnerschaft:") is gold. It uses a new text-legible `accentText` token, because the
   existing `accent` is 2.42:1 on white.
3. **Partner never gets Q1 (both clients)**: **already true** since `95e52ee` (contracts step
   engine, strict PATCH, migration 039, and tests in contracts, server and web). This feature
   removes the leftover dead `title()` wrapping on the `settling*` cases in both `StepView`s and
   fixes the stale Expo comment ("Q1-Q5"). With that gone, the code no longer suggests a partner
   Q1 exists. No behaviour changes.

## Technical Context

**Language/Version**: TypeScript. React 19.2, React Native 0.86, Expo SDK 57 (app). React + Vite (web console).

**Primary Dependencies**: `expo-router`, `react-native-safe-area-context`, `@gwc/contracts` (profiling step engine)

**Storage**: N/A (no persisted change; see data-model.md)

**Testing**: Expo has `tsc --noEmit` + `expo lint` and no unit runner. Vitest covers contracts, server and the web client. The existing partner-Q1 tests are the regression guard.

**Target Platform**: iOS and Android (Expo app). Web console in evergreen browsers (cleanup only).

**Project Type**: Mobile + web clients over one API. Client-only change.

**Performance Goals**: N/A

**Constraints**: Text colour ≥ 4.5:1 against the screen background in both schemes. No new i18n keys. Partner step order stays defined only in `@gwc/contracts/profiling`.

**Scale/Scope**: Expo: 6 files (`register.tsx`, `ui.tsx`, `mobile-field.tsx`, `profiling/steps.tsx`, `profiling/types.ts`, `constants/theme.ts`). Web: 1 file (`onboarding/profiling/steps.tsx`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Engaged? | Verdict |
|---|---|---|
| I. One rule set, three clients | Yes. "Partner gets Q2–Q5" is a business rule. | **PASS.** It stays in `profilingSteps`/`partnerAnswersSchema` in `@gwc/contracts` and the server's strict PATCH. Clients render the step list they are given. R1 rejects adding a client-side duplicate guard for this reason. Checked by `packages/contracts/tests/profiling-steps.test.ts` and `server/tests/profiling/settling.test.ts`. |
| II. Declare every posture | No route or surface added. | **PASS.** Nothing to declare. The route-posture boot gate is untouched. |
| III. Published state = real state | No public surface touched. | **PASS.** Only gated onboarding screens change. |
| IV. Integrity in the database | Partner data shape relies on it. | **PASS.** The migration 039 schema and the finality triggers are unchanged. No write path changes. |
| V. Failure explicit and bounded | No dependency or request path. | **PASS.** No outbound calls or budgets change. |
| VI. Server shapes what leaves it | No response or log change. | **PASS.** The client logging convention (CLAUDE.md, "Clients report failures to the console") is untouched. No new state holds a server refusal. |

Project conventions also checked: interface strings stay in the i18n catalogues (`partnerTitle`
is reused, not split into new keys, R3). Comments explain *why* (the `accentText` contrast note,
the Year-does-not-submit note, the iOS auto-advance note).

**Post-design re-check**: unchanged. All PASS. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/016-register-focus-partner-title/
├── spec.md              # written with this plan (no prior spec existed)
├── plan.md              # this file
├── research.md          # R1–R6
├── data-model.md        # no persisted change; tokens and focus order
├── quickstart.md        # automated + manual validation
├── contracts/
│   └── ui-contract.md   # keyboard behaviour, component props, partner heading
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
expo-client/german-world-club/src/
├── app/(public)/register.tsx            # refs, returnKeyType/submitBehavior/onSubmitEditing, Day/Month auto-advance
├── components/ui.tsx                    # TextField: ref prop → TextInput; FormScreen: title ReactNode
├── components/mobile-field.tsx          # optional ref, returnKeyType, onSubmitEditing → inner TextField
├── components/profiling/steps.tsx       # partner heading in accentText; Frame/Choice/Multi title ReactNode;
│                                        #   settling cases unwrapped; doc comment Q1-Q5 → Q2–Q5
├── components/profiling/types.ts        # split partnerTitle on {question} (beside `fill`)
└── constants/theme.ts                   # accentText: light #856B1A, dark #E0BD4A

client/src/onboarding/profiling/steps.tsx   # settling cases unwrapped (dead partner title())
```

**Structure Decision**: Client-only edits in the existing Expo and web onboarding modules.
`packages/contracts` and `server/` are read, not changed. The rule they hold is already correct (R1).

## Design notes for implementation

- **Partner heading** (R3): `StepView` builds `title(own)` as a `ReactNode` for partner steps:
  `[before, after] = copy.partnerTitle.split('{question}')`, then
  `<>{before && <Text style={{ color: theme.accentText }}>{before}</Text>}{own}{after && <Text …>{after}</Text>}</>`.
  Non-partner steps return `own` unchanged (a string). `FormScreen` already wraps `title` in a
  `ThemedText type="title"`, so the nested `Text` inherits size and weight.
- **Year does not submit** (R4): the chips below it are still unanswered. Calling `next()` would
  only show three validation errors. A comment says so.
- **Auto-advance** (R5) fires only on the change that reaches two digits, so editing a
  restored draft value never moves focus.
- **Out of scope** (R6): web gold heading, web Enter-to-next, gold on the review screen, and an
  iOS accessory "Next" bar for Mobile.

## Complexity Tracking

None. No constitution violations.

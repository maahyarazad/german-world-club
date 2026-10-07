---

description: "Task list for feature 016: Register focus chain and partner question marking"
---

# Tasks: Register focus chain and partner question marking

**Input**: Design documents from `specs/016-register-focus-partner-title/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: No new test tasks. The spec does not ask for them, and the Expo app has no unit
runner (only `tsc --noEmit` and `expo lint`). The partner-Q1 rule is already guarded by
`packages/contracts/tests/profiling-steps.test.ts:83-88`, `server/tests/profiling/settling.test.ts:85-97`
and `client/tests/onboarding/profiling.test.tsx:290-298`. Those must stay green **unmodified**.

**Organization**: Tasks are grouped by user story so each can be implemented and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 Register focus · US2 gold partner label · US3 partner never gets Q1
- Expo paths are relative to `expo-client/german-world-club/`. Web paths are relative to `client/`.

---

## Phase 1: Setup

**Purpose**: Confirm the starting point is green, so any later failure is attributable to this feature.

- [X] T001 On branch `016-register-focus-partner-title`, run `npm run -w expo-client/german-world-club typecheck`, `npm test -w packages/contracts` and `npm test -w client -- onboarding/profiling`, and record that all pass before any edit (baseline for quickstart.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared primitives that US1 and US2 both build on. Both tasks below touch different files.

- [X] T002 [P] In `expo-client/german-world-club/src/components/ui.tsx`: (a) add `ref?: Ref<TextInput>` to `TextFieldProps` (import `Ref` from `react`), destructure `ref` in `TextField` and pass `ref={ref}` to the inner `<TextInput>`. React 19 passes `ref` through `memo` as an ordinary prop, so no `forwardRef` (research R4). (b) Widen `FormScreen`'s `title` prop from `string` to `ReactNode`, keeping the `title ? … : null` guard. Existing string callers are unaffected (contracts/ui-contract.md C2)
- [X] T003 [P] In `expo-client/german-world-club/src/constants/theme.ts`, add `accentText` to `Colors.light` (`'#856B1A'`) and `Colors.dark` (`'#E0BD4A'`), next to `accent`, with a comment explaining why: `accent` `#C9A227` is 2.42:1 on white and must not carry text, while `#856B1A` is the smallest darkening of the same hue reaching 5.10:1 on `#ffffff` (4.60:1 on `backgroundElement`), and dark `#E0BD4A` is 10.7:1 on `#0B0D10` (research R2). `ThemeColor` picks the new key up automatically

**Checkpoint**: `npm run -w expo-client/german-world-club typecheck` passes. No screen looks different yet.

---

## Phase 3: User Story 1: Move through Register with the keyboard (Priority: P1) 🎯 MVP

**Goal**: Pressing return on Register moves focus Full name → Email → Password → Mobile → Day → Month → Year. Day and Month auto-advance at two digits. Year closes the keyboard without submitting.

**Independent Test**: quickstart.md, "Manual: Register focus (US1)", steps 1–5, on an iOS simulator and an Android emulator.

- [X] T004 [P] [US1] In `expo-client/german-world-club/src/components/mobile-field.tsx`, add optional props `ref?: Ref<TextInput>`, `returnKeyType?: ReturnKeyTypeOptions` and `onSubmitEditing?: () => void` to `MobileField`, and pass all three, plus `submitBehavior="submit"` when `onSubmitEditing` is given, to the inner `TextField`. Leave the country `Pressable` and `Modal` untouched. `src/app/(public)/verify-mobile.tsx` passes none of them and must not change (C2)
- [X] T005 [US1] In `expo-client/german-world-club/src/app/(public)/register.tsx`, add `useRef<TextInput>(null)` for `emailRef`, `passwordRef`, `mobileRef`, `dayRef`, `monthRef` and `yearRef` (import `useRef` from `react`, `TextInput` from `react-native`). Wire per contracts/ui-contract.md C1:
  - Full name, Email, Password, Mobile, Day and Month: `returnKeyType="next"`, `submitBehavior="submit"`, and `onSubmitEditing={() => <nextRef>.current?.focus()}`.
  - Year: `returnKeyType="done"` and `submitBehavior="blurAndSubmit"`, with no `onSubmitEditing`. Add a comment explaining why Year does not call `next()`: the gender, language and age chips below it are still unanswered, and submitting would only flash validation errors (FR-002).

  Depends on T002 and T004
- [X] T006 [US1] In the same file, `expo-client/german-world-club/src/app/(public)/register.tsx`, make Day's and Month's `onChangeText` call `monthRef.current?.focus()` / `yearRef.current?.focus()` when the digits-only value reaches length 2. Compute it from the cleaned value inside the handler, so a restored draft never moves focus. Add a one-line comment that the iOS number pad has no return key (research R5). Do **not** auto-advance Mobile, which has no fixed length

**Checkpoint**: US1 works on both platforms. On iOS the only tap needed between fields is Mobile → Day (a known limitation, R5).

---

## Phase 4: User Story 2: See which questions are about the partner (Priority: P1)

**Goal**: On the four partner steps, only the `partnerTitle` text ("Your partner:" / "Ihre Partnerschaft:") is gold (`accentText`), and the question keeps the title colour. Non-partner steps show no gold.

**Independent Test**: quickstart.md, "Manual: partner heading (US2, US3)", steps 1–5 and 7.

- [X] T007 [P] [US2] In `expo-client/german-world-club/src/components/profiling/types.ts`, beside `fill`, export `splitTemplate(template: string, key: string): [before: string, after: string]`. It splits on the first `{key}` and returns `[template, '']` when the placeholder is absent, so a malformed catalogue still renders. Add a short comment that it exists so the literal part of a template can be styled separately in any word order (research R3)
- [X] T008 [US2] In `expo-client/german-world-club/src/components/profiling/steps.tsx`, widen `title` from `string` to `ReactNode` on `Frame`, `Choice` and `Multi`. Leave `Text`, which uses `title` as a `TextField` label and must stay `string`, and leave `PlacePicker`. Then make `StepView`'s `title(own)` return, for partner steps, `<>{before ? <Text style={{ color: theme.accentText }}>{before}</Text> : null}{own}{after ? <Text style={{ color: theme.accentText }}>{after}</Text> : null}</>`, where `[before, after] = splitTemplate(copy.partnerTitle, 'question')`. Use `const theme = useTheme()` (from `@/hooks/use-theme`) and RN `Text` (aliased, e.g. `import { Text as RNText } from 'react-native'`, because a local `Text` component already exists in this file). Do **not** nest `ThemedText`, whose default type style would reset the title's size. Non-partner steps still return `own` (a plain string). Depends on T002, T003 and T007

**Checkpoint**: The partner Q2–Q5 headings show a gold label in light and dark, and in en and de. The member's own Q2–Q5 show none. Screen readers read each heading as one phrase (FR-006).

---

## Phase 5: User Story 3: The partner is never asked Q1 (Priority: P1)

**Goal**: There is no behaviour change, because the rule already holds in contracts, the server and both clients (research R1). Remove the dead partner wrapping on the settling (Q1) screens and the stale comment, so the code no longer suggests a partner Q1.

**Independent Test**: The three existing tests named under **Tests** above pass unmodified, plus quickstart.md "Manual: partner heading" step 6 on the app and on `/konsole`.

- [X] T009 [US3] In `expo-client/german-world-club/src/components/profiling/steps.tsx`, in `StepView`, replace `title(copy.settlingTitle)` (the `settling` and `settling-info` cases), `title(copy.settlingPlaceTitle)` and `title(copy.workingDurationTitle)` with the bare copy strings, so `title()` is used only by `languages`, `qualification`, `occupation` and `income`. Correct the doc comment above `StepView` from "Partner steps are the German Q1-Q5 again" to say the partner steps are German Q2–Q5 (never Q1, settling, nor Q6), as listed by `profilingSteps` in `@gwc/contracts/profiling`. Runs after T008 (same file)
- [X] T010 [P] [US3] In `client/src/onboarding/profiling/steps.tsx`, in `StepView`, make the same replacement on the `settling`, `settling-info`, `settling-place` and `settling-work` cases (`title(copy.settlingTitle)`, `title(copy.settlingPlaceTitle)`, `title(copy.workingDurationTitle)` become bare strings). The doc comment there is already correct. No other change on the web; the gold heading is out of scope (research R6)

**Checkpoint**: `grep -n "title(copy.settling\|title(copy.workingDuration" client/src/onboarding/profiling/steps.tsx expo-client/german-world-club/src/components/profiling/steps.tsx` returns nothing.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T011 Run the automated block in `specs/016-register-focus-partner-title/quickstart.md`: Expo `typecheck` and `lint`, `npm test -w packages/contracts`, `npm run -w server test -- profiling/settling` (needs a DB; report it as skipped if none is available, rather than calling it passed), `npm test -w client -- onboarding/profiling` and `npm run -w client test:i18n`. All green with no test file edited
- [ ] T012 Walk the manual sections of `specs/016-register-focus-partner-title/quickstart.md` on an iOS simulator and an Android emulator, in light and dark mode, in en and de. Note any deviation in this file under a "Validation notes" heading

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: no dependencies.
- **Foundational (T002, T003)**: after T001. Blocks US1 (T002) and US2 (T002, T003).
- **US1 (T004–T006)**: after T002. Independent of US2 and US3.
- **US2 (T007–T008)**: after T002 and T003. Independent of US1.
- **US3 (T009–T010)**: T010 depends on nothing beyond T001. T009 shares `profiling/steps.tsx` with T008, so it runs after T008.
- **Polish (T011–T012)**: after all stories.

### Within each story

- US1: T004 → T005 → T006 (T005 and T006 share `register.tsx`).
- US2: T007 → T008.
- US3: T008 → T009. T010 is free.

## Parallel Opportunities

```text
# After T001:
T002 ui.tsx  ‖  T003 theme.ts  ‖  T010 web steps.tsx

# After T002 (and T003 for US2):
T004 mobile-field.tsx  ‖  T007 profiling/types.ts

# Then, on different files:
T005→T006 register.tsx  ‖  T008→T009 profiling/steps.tsx
```

## Implementation Strategy

**MVP**: Phase 1 → Phase 2 (T002 is all US1 needs) → US1. That delivers keyboard focus on Register on its own.

**Incremental**: add US2 (gold label), then US3 (cleanup, no behaviour change), then Polish. Each story's
checkpoint can be validated on a device before the next one starts. US3's web task (T010) can land
at any point.

## Notes

- No contracts, server, migration or i18n-key changes. If an implementation step seems to need
  one, stop: the plan's research rules it out (R1, R3).
- Commit after each story checkpoint.

## Validation notes (2026-10-06)

- **Baseline (T001)**: Expo typecheck clean; contracts 115/115; web `onboarding/profiling` 22/22.
- **After (T011)**:
  - Expo `tsc --noEmit` clean.
  - `eslint` clean on every file this feature touches.
  - Contracts 115/115 and web `onboarding/profiling` 22/22, with no test file edited.
  - `test:i18n` agrees on every key.
- **Lint deviation**: `expo lint` still exits non-zero, with 8 errors (`react-hooks/*`) that predate
  this branch. They are in `(member)/events/[id].tsx`, `(profiling)/index.tsx`,
  `handle-form.tsx`, `use-color-scheme.web.ts`, `use-paged.ts`, `notification-router.tsx` and
  `registration.ts`, none of which this feature touches. A first draft of `register.tsx` used a
  `nextField(ref)` spread helper, which `react-hooks/refs` flagged (5 errors). The props are now
  inline.
- **Server**: `profiling/settling` was **skipped** (8 tests). No PostgreSQL was reachable at
  `DATABASE_URL`. This feature does not change the server.
- **Client tsc**: `client` `tsc --noEmit` reports pre-existing errors in
  `tests/member/marketplace.test.tsx`, which this feature does not touch.
- **T012 (manual, devices)**: not yet run. It needs an iOS simulator and an Android emulator.

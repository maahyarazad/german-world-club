---

description: "Task list for 036: move every inline style in the Expo app to StyleSheet.create"
---

# Tasks: Expo app styles in `StyleSheet.create`

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md) (R1 baseline, R2 hook, R3 lint rule), [quickstart.md](./quickstart.md)

**Tests**: Not requested. The Expo workspace has no unit-test runner; verification is `tsc`, ESLint (with the new rule), grep counts and the manual light/dark check in quickstart.md.

## Format: `[ID] [P?] [Story] Description`

Paths are under `expo-client/german-world-club/` unless they start with `specs/`. Run npm commands from the repo root. **Every per-file task means the same thing** (plan.md "Approach", step 3): constant values go to the file's `const styles = StyleSheet.create({…})` at the bottom (extend the existing sheet if the file has one); anything reading `theme.*` goes to `useThemedStyles` (T003); a value computed from data stays as one inline key with an `eslint-disable-next-line no-restricted-syntax -- <reason>` comment (FR-003); keep the order of entries in style arrays; if the file imports `styles` from `@/components/ui`, import it as `uiStyles` (FR-004). Do not change any value.

## Phase 1: Setup

- [X] T001 Record the baseline: run `npx tsc --noEmit` and `npm run -w german-world-club lint` from the repo root and paste the pass/fail result and every existing error/warning line under "R1 Baseline" in `specs/036-expo-stylesheet/research.md` (replace the summary sentence), so the final comparison in T058 is exact.
- [X] T002 Confirm `git status` is clean for `expo-client/` (commit or stash anything else first) so each phase below can be committed on its own and reverted on its own.

## Phase 2: Foundational (blocks every user story)

- [X] T003 Create `src/hooks/use-themed-styles.ts` exporting `useThemedStyles(factory)`: `factory` is `(theme: ReturnType<typeof useTheme>) => T` with `T extends StyleSheet.NamedStyles<T>`, and the hook returns `useMemo(() => StyleSheet.create(factory(theme)), [theme])` with `theme` from `useTheme()` (`src/hooks/use-theme.ts`). Add a comment saying why it exists: `StyleSheet.create` runs once at module load and cannot see the theme (research.md R2).
- [X] T004 In `eslint.config.js` add a `no-restricted-syntax` rule at severity `warn` with two selectors, `JSXAttribute[name.name=/[sS]tyle$/] > JSXExpressionContainer > ObjectExpression` and `JSXAttribute[name.name=/[sS]tyle$/] > JSXExpressionContainer > ArrayExpression > ObjectExpression`, and a message that says to use `StyleSheet.create` (or `useThemedStyles` for theme colours). It is `warn` for now so the tree stays green while the phases below run (research.md R3).
- [X] T005 Prove the guard: run `npm run -w german-world-club lint` and check it reports roughly the R1 counts (about 200 literals plus the array forms); then add `<View style={{ flex: 1 }} />` to any screen, confirm it is reported, and remove it again.

**Checkpoint**: hook and rule exist; nothing else has changed. User stories can start.

## Phase 3: User Story 1 - Shared components (Priority: P1) 🎯 MVP

**Goal**: every file under `src/components/` styles through `StyleSheet.create`. **Independent Test**: `grep -rn "style={{" src/components` returns nothing but FR-003 exceptions; a screen using each component looks the same in light and dark.

- [X] T006 [P] [US1] In `src/components/club-offers.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (12 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". The list's `ItemSeparatorComponent`-style arrows become a named component or a stable function using `styles.separator`.
- [X] T007 [P] [US1] In `src/components/ui.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (7 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". Extend the existing exported `styles`; keep every current key and name, since 15 files import them.
- [X] T008 [P] [US1] In `src/components/referrals-view.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (7 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T009 [P] [US1] In `src/components/mobile-field.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (7 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T010 [P] [US1] In `src/components/media-carousel.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (6 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". Extend its existing sheet; the per-item `width`/`height` come from props and stay as the single inline keys.
- [X] T011 [P] [US1] In `src/components/profile-header.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (5 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T012 [P] [US1] In `src/components/organisation-card.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (5 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T013 [P] [US1] In `src/components/upload-progress.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (4 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T014 [P] [US1] In `src/components/date-parts-field.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (4 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T015 [P] [US1] In `src/components/profiling/cities.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (3 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T016 [P] [US1] In `src/components/country-picker.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (3 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". Extend its existing sheet.
- [X] T017 [P] [US1] In `src/components/avatar.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (3 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". The avatar `size` is a prop: keep `width`/`height`/`borderRadius` derived from it as the one inline array entry, with the reason.
- [X] T018 [P] [US1] In `src/components/post-card.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (2 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". Extend its existing sheet.
- [X] T019 [P] [US1] In `src/components/spinner.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (1 inline literal) to `StyleSheet.create` per plan.md "Conversion rule". The spinner size and colour are props: only constant keys move.
- [X] T020 [P] [US1] In `src/components/profiling/steps.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (1 inline literal) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T021 [P] [US1] In `src/components/post-body.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (1 inline literal) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T022 [P] [US1] In `src/components/notification-prompt.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (1 inline literal) to `StyleSheet.create` per plan.md "Conversion rule". Extend its existing sheet.
- [X] T023 [P] [US1] In `src/components/listing-field.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (1 inline literal) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T024 [P] [US1] In `src/components/listing-detail.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (1 inline literal) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T061 [P] [US1] In `src/components/themed-text.tsx` replace the inline `{ color: theme[themeColor ?? 'text'] }` with one themed style per theme token (`useThemedStyles(makeColors)`), picked by `themeColor` (found by the lint rule; not in the original inventory).
- [X] T062 [P] [US1] In `src/components/themed-view.tsx` do the same for `backgroundColor` and `type` (`makeBackgrounds`).
- [X] T063 [US1] Convert the inline style objects the lint rule cannot see: the `useMemo`'d array in `TextField` and the `Pressable` function style in `Card` (`src/components/ui.tsx`), the `box` const in `src/components/quote-embed.tsx`, `gold` in `src/components/profiling/steps.tsx`, the conditional pair in `src/components/screen-loader.tsx`, and the `labelStyle` objects in `src/app/(member)/_layout.tsx`.
- [X] T064 [US1] Add `WideImage` to `src/components/media-carousel.tsx` and use it for the per-image aspect ratio in `src/components/club-offers.tsx`, `src/app/(organisation)/store.tsx` and `src/app/(organisation)/my-offer/[id].tsx`, so no inline `aspectRatio` is left.
- [X] T025 [US1] Checkpoint for US1: run `npx tsc --noEmit` and lint; confirm `grep -rn "style={{" src/components` is empty apart from commented FR-003 exceptions and that no component warns under the new rule. Commit: `refactor(expo): shared components use StyleSheet.create`.

## Phase 4: User Story 2 - Onboarding and profiling screens (Priority: P2)

**Goal**: `(public)`, `(applicant)` and `(profiling)` use `StyleSheet.create`, unchanged visually. **Independent Test**: no inline literal under those groups; Welcome, Register, Waiting and Profiling look the same in both themes.

- [X] T026 [P] [US2] In `src/app/(public)/register.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (11 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". The birthday row's `flex: 1` / `flex: 2` wrappers become `styles.dayCell` / `styles.monthCell` / `styles.yearCell`.
- [X] T027 [P] [US2] In `src/app/(applicant)/waiting.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (5 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T028 [P] [US2] In `src/app/(public)/index.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (3 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". Extend its existing sheet.
- [X] T029 [P] [US2] In `src/app/(profiling)/index.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (3 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". Keep the 4-point gap on the review blocks and the centred outcome text.
- [X] T030 [US2] Checkpoint for US2: `tsc`, lint, and `grep -rn "style={{" 'src/app/(public)' 'src/app/(applicant)' 'src/app/(profiling)'` is empty; do the Welcome → Register → Country → Waiting and Profiling steps of quickstart.md step 4. Commit: `refactor(expo): onboarding and profiling screens use StyleSheet.create`.

## Phase 5: User Story 3 - Member screens (Priority: P3)

**Goal**: every screen under `src/app/(member)` uses `StyleSheet.create`. **Independent Test**: no inline literal under `(member)` apart from FR-003 exceptions; each tab opens and looks unchanged.

- [X] T031 [P] [US3] In `src/app/(member)/marketplace/new.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (10 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T032 [P] [US3] In `src/app/(member)/threads/[id].tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (8 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T033 [P] [US3] In `src/app/(member)/marketplace/index.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (8 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". The `ItemSeparatorComponent={() => <View style={{ height: … }} />}` becomes one stable component using `styles.separator`.
- [X] T034 [P] [US3] In `src/app/(member)/threads/compose.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (7 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T035 [P] [US3] In `src/app/(member)/events/index.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (7 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". `contentContainerStyle={{ padding: … }}` becomes `styles.listContent`.
- [X] T036 [P] [US3] In `src/app/(member)/threads/member/[id].tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (6 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T037 [P] [US3] In `src/app/(member)/events/[id].tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (5 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T038 [P] [US3] In `src/app/(member)/profile/privacy.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (5 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T039 [P] [US3] In `src/app/(member)/profile/edit.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (5 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T040 [P] [US3] In `src/app/(member)/threads/people/[id].tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (4 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T041 [P] [US3] In `src/app/(member)/profile/devices.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (4 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T042 [P] [US3] In `src/app/(member)/profile/activity.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (4 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". `ListEmptyComponent` text and the row `Pressable` use `styles.empty` and a themed `styles.row` (border colour is a theme value).
- [X] T043 [P] [US3] In `src/app/(member)/marketplace/messages/[id].tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (4 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T044 [P] [US3] In `src/app/(member)/threads/index.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (3 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T045 [P] [US3] In `src/app/(member)/profile/notifications.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (3 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T046 [P] [US3] In `src/app/(member)/marketplace/messages/index.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (3 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". Same separator and `contentContainerStyle` treatment as marketplace/index.tsx.
- [X] T047 [P] [US3] In `src/app/(member)/threads/quotes/[id].tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (2 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T048 [P] [US3] In `src/app/(member)/profile/index.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (2 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T049 [P] [US3] In `src/app/(member)/marketplace/request/[id].tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (1 inline literal) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T050 [US3] Checkpoint for US3: `tsc`, lint, `grep -rn "style={{" 'src/app/(member)'` is empty apart from commented exceptions; do the Threads, Marketplace, Events and Profile steps of quickstart.md step 4 in light and dark. Commit: `refactor(expo): member screens use StyleSheet.create`.

## Phase 6: User Story 4 - Merchant and partner screens, and the guard (Priority: P4)

**Goal**: `(organisation)` converted, and the lint rule becomes an error. **Independent Test**: lint fails on a newly added inline style and passes on the tree.

- [X] T051 [P] [US4] In `src/app/(organisation)/store.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (5 inline literals) to `StyleSheet.create` per plan.md "Conversion rule". The cover and gallery `aspectRatio` come from the media item: keep only that key inline, with the reason.
- [X] T052 [P] [US4] In `src/app/(organisation)/my-offer/[id].tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (5 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T053 [P] [US4] In `src/app/(organisation)/index.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (2 inline literals) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T054 [P] [US4] In `src/app/(organisation)/public-profile.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (1 inline literal) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T055 [P] [US4] In `src/app/(organisation)/my-offers.tsx` convert every `style={{…}}`, `contentContainerStyle={{…}}` and object literal inside a `style={[…]}` array (1 inline literal) to `StyleSheet.create` per plan.md "Conversion rule".
- [X] T056 [US4] Run a final inventory: `grep -rn "style={{\|Style={{" src` and `grep -rn "style={\[" src | grep "{ [a-zA-Z]*:"`; every hit must be a runtime-data exception with its `eslint-disable-next-line` reason. Convert anything that was missed, in the file that owns it. (Done: the only one left is the spinner's `Animated` rotation, with its disable comment.)
- [X] T057 [US4] Change the `no-restricted-syntax` rule in `eslint.config.js` from `warn` to `error`; run lint and confirm the only failures are the 15 errors that were already there (research.md R1). Re-run T005's proof (add `<View style={{ flex: 1 }} />`, expect an error, remove it). Commit: `refactor(expo): organisation screens use StyleSheet.create; inline styles are a lint error`.

## Phase 7: Polish & cross-cutting

- [X] T058 Compare against the baseline: `npx tsc --noEmit` is clean and `npm run -w german-world-club lint` reports exactly the issues recorded in T001 (no new ones); note the result in `specs/036-expo-stylesheet/research.md` under a new "R4 Result" heading with the final grep counts.
- [ ] T059 Run the full manual check in `specs/036-expo-stylesheet/quickstart.md` step 4 (every screen listed, light and dark, member and merchant login) and fix any difference in the file that caused it; do not adjust a value to "look right", restore the original one.
- [X] T060 Document the convention in the repo `CLAUDE.md` under "Conventions": styles in the Expo app live in `StyleSheet.create`; theme colours via `useThemedStyles`; the only inline keys are runtime-data values carrying an `eslint-disable-next-line` reason; the lint rule enforces it.

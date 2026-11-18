---

description: "Task list for keeping onboarding screens clear of the phone's status bar"
---

# Tasks: Keep onboarding screens clear of the phone's status bar

**Input**: `/specs/033-profiling-safe-area/` (plan.md, spec.md, research.md, data-model.md, quickstart.md)

**Scope note**: User Story 3 (Phase 4b, T009–T026) was added later, by the owner's request, to this same branch: replace React Native `FlatList` with Shopify's FlashList across the Expo app. Existing task IDs T001–T008 are unchanged, which is why Phase 4b's IDs follow Phase 5's.

**Prerequisites**: plan.md, spec.md

**Tests**: The Expo app has no test runner (only `tsc`), and layout cannot be asserted in jsdom, so there are no test tasks. Verification is `tsc` plus the manual device walk-through in `quickstart.md` (T005–T006). Never run the app against the production database in `server/.env`.

**Format**: `[ID] [P?] [Story] Description`

All paths are under `expo-client/german-world-club/` unless they start with `specs/`.

## Phase 1: Setup

- [X] T001 Baseline: in `expo-client/german-world-club` run `npx tsc --noEmit` and note it is clean; read `src/components/ui.tsx` (`FormScreen` ~l.24, `Centered` ~l.256, `Loading` ~l.266, `styles.centered` ~l.310) and confirm the research R1 cause (`edges={['bottom']}`; `Centered` is a plain `View`). Record under Findings.

---

## Phase 2: Foundational

None. The fix is two shared components, and both user stories depend on it.

---

## Phase 3: User Story 1 - Profiling questions clear of the status bar (Priority: P1) 🎯 MVP

**Goal**: every profiling screen (questions, information screens, review, outcome) starts below the clock, signal and Wi-Fi indicators and any cut-out, on iOS and Android.

**Independent Test**: quickstart checks 2, 3 and 6 on a notched iPhone, an iPhone SE and an Android phone with a cut-out.

- [X] T002 [US1] In `src/components/ui.tsx`, change `FormScreen`'s `SafeAreaView` from `edges={['bottom']}` to `edges={['top', 'bottom']}`. Extend the doc comment with the **why** (feature 033): the profiling and applicant groups hide their navigation header, so nothing else keeps the title off the status bar; the library's native `SafeAreaView` measures the view's real overlap, so a screen below a native header gets a 0 top inset and no fixed number is used.
- [X] T003 [US1] In `src/components/ui.tsx`, make `Centered` a `SafeAreaView` from `react-native-safe-area-context` with `edges={['top', 'bottom']}`, keeping `styles.centered` and the theme background, so the profiling outcome screen, `waiting` and `Loading` (which renders `Centered`) stay inside the usable area. Add a one-line why-comment pointing at `FormScreen`.
- [ ] T004 [US1] Run `npx tsc --noEmit` in `expo-client/german-world-club` (clean). Then run the profiling checks of `quickstart.md` (2, 3, 6) on the three devices and record results under Findings. If any screen cannot be run, say so there instead of ticking it.

**Checkpoint**: profiling is readable on every device; User Story 1 is deliverable alone.

---

## Phase 4: User Story 2 - Every other header-less screen is clear too (Priority: P2)

**Goal**: no screen shows content under the status bar, and screens that already have a navigation header gain no extra gap.

**Independent Test**: quickstart checks 4 and 5.

- [ ] T005 [US2] Walk the onboarding path and a sample of member screens on the three devices per `quickstart.md` checks 4 and 5: register and country (steps 1–2), verify-mobile, verify-email, `waiting`, the referral-link screen (`src/app/r/[code].tsx`), the loading screen, and member Profile, Threads and Marketplace. Record any screen that now shows a larger gap than before under Findings.
- [ ] T006 [US2] If T005 finds a screen under a native header that gained a gap, add an optional `edges` prop to `FormScreen`/`Centered` in `src/components/ui.tsx` (default `['top', 'bottom']`) and pass `edges={['bottom']}` from that screen only. Skip this task, and say so under Findings, if nothing was found.

**Checkpoint**: whole-app walk-through is clean.

---

## Phase 4b: User Story 3 - Lists use Shopify FlashList (Priority: P3)

**Goal**: every scrolling list in the Expo app is a `FlashList` from `@shopify/flash-list` (https://github.com/shopify/flash-list) instead of React Native's `FlatList`, so long feeds recycle their rows. Same data, same look, same pull-to-refresh and paging; no screen changes behaviour. It rides on this branch by the owner's request, and needs no new EAS build only if the installed version is JavaScript-only (checked in T009).

**Independent Test**: quickstart check 8: each of the 11 lists scrolls, refreshes and pages as before, and `grep -rn FlatList src` finds nothing.

**Lists to migrate (all under `expo-client/german-world-club/`)**: `src/app/(member)/activity/index.tsx`, `marketplace/index.tsx`, `marketplace/messages/index.tsx`, `threads/index.tsx`, `threads/[id].tsx`, `threads/member/[id].tsx`, `threads/quotes/[id].tsx`, `threads/people/[id].tsx`, `events/index.tsx` (all in `src/app/(member)/`), `src/components/media-carousel.tsx` and `src/components/country-picker.tsx`.

**Migration rules that apply to every list below** (confirmed in T010, because FlashList differs from FlatList):
- Import `FlashList` from `@shopify/flash-list` and drop `FlatList` from the `react-native` import. Props that carry over unchanged: `data`, `renderItem`, `keyExtractor`, `onEndReached`, `onEndReachedThreshold`, `refreshControl`, `ListHeaderComponent`, `ListEmptyComponent`, `ItemSeparatorComponent`, `keyboardShouldPersistTaps`, `horizontal`.
- **`gap` in `contentContainerStyle` is not supported** (padding is). `marketplace/index.tsx`, `marketplace/messages/index.tsx` and `events/index.tsx` use it: keep the padding, and move the spacing into an `ItemSeparatorComponent` of the same size.
- Do not pass `estimatedItemSize` (removed in v2 and a type error there); do not wrap a `FlashList` in a `ScrollView`.
- A recycled row keeps its component instance, so row state must not leak between items (T012).

- [X] T009 [US3] In `expo-client/german-world-club` run `npx expo install @shopify/flash-list` so Expo picks the SDK 57-compatible version, and confirm the root `package-lock.json` (npm workspace) changed. Confirm the installed major is v2 (JavaScript-only, New Architecture; React Native 0.86 is New Architecture only) and that it adds no config plugin and no native code, i.e. no new EAS build (feature 033 FR-007, and the `react-native-svg` precedent in feature 030). If it does need a native build, STOP and ask the owner before continuing. Record the version under Findings.
- [X] T010 [US3] Per `expo-client/german-world-club/AGENTS.md`, read the Expo SDK 57 page https://docs.expo.dev/versions/v57.0.0/sdk/flash-list/ and the FlashList docs (https://shopify.github.io/flash-list/docs/ — usage, migration from FlatList, `getItemType`, recycling state). Check the migration rules above against what the installed version really supports, in particular `style`, `snapToInterval`/`decelerationRate` on a horizontal list, and `contentContainerStyle`. Correct the rules in this file and record under Findings.
- [X] T011 [US3] Add User Story 3 to `specs/033-profiling-safe-area/spec.md` (P3, "lists use FlashList", one new FR: every list in the Expo app is a `FlashList`; one SC: no `FlatList` import remains) and one sentence plus the `@shopify/flash-list` dependency to the Summary and Technical Context of `specs/033-profiling-safe-area/plan.md`, and change plan.md's "no new native module" only if T009 found otherwise.
- [X] T012 [US3] Audit recycling safety: read the row components rendered by these lists (`PostCard`, `EventCard`, `Card`, `ProfileHeader`, the people and conversation rows, `src/components/media-carousel.tsx` items) in `expo-client/german-world-club/src/components/` and the screens above. For any row that keeps `useState` seeded from its props (liked, expanded, busy, local edits), make it derive from props or reset on item change (FlashList v2 `useRecyclingState` or a reset effect keyed on the item id), so a row never shows the previous item's state after recycling. List what was checked and changed under Findings.
- [X] T013 [P] [US3] Migrate `src/app/(member)/activity/index.tsx` to `FlashList`. The rows come in several kinds (`i.kind`), so add `getItemType={(i) => i.kind}`. Keep `refreshControl`, `onEndReached` and the background `style` (or move it to a wrapping `View` if T010 says `style` is unsupported).
- [X] T014 [P] [US3] Migrate `src/app/(member)/marketplace/index.tsx` to `FlashList`: replace `gap: Spacing.two` in `contentContainerStyle` with an `ItemSeparatorComponent` of `Spacing.two` height, keep the horizontal padding and bottom padding, `onEndReachedThreshold`, `refreshControl` and the existing empty/loading handling.
- [X] T015 [P] [US3] Migrate `src/app/(member)/marketplace/messages/index.tsx` to `FlashList`: replace `gap` with an `ItemSeparatorComponent`, keep `padding: Spacing.three` and `refreshControl`.
- [X] T016 [P] [US3] Migrate `src/app/(member)/threads/index.tsx` to `FlashList`, keeping the `keyExtractor` (`post.id` + `repostedBy.id`, so a repost is its own row), the three `setItems` callbacks on `PostCard`, paging and refresh.
- [X] T017 [P] [US3] Migrate `src/app/(member)/threads/[id].tsx` (replies list) to `FlashList`, keeping `refreshControl`, the header that shows the post and the background `style` handling from T013.
- [X] T018 [P] [US3] Migrate `src/app/(member)/threads/member/[id].tsx` (profile posts) to `FlashList`, keeping the `ListHeaderComponent` (`ProfileHeader` with follow/block buttons) and `onEndReached`.
- [X] T019 [P] [US3] Migrate `src/app/(member)/threads/quotes/[id].tsx` to `FlashList`, keeping `onEndReached` and the `onChange` update of the list.
- [X] T020 [P] [US3] Migrate `src/app/(member)/events/index.tsx` to `FlashList`: replace `gap: Spacing.three` with an `ItemSeparatorComponent`, keep `padding: Spacing.three` and `refreshControl`.
- [X] T021 [P] [US3] Migrate `src/app/(member)/threads/people/[id].tsx` (followers/following/likes) to `FlashList`, keeping `ListEmptyComponent`, `onEndReached` (`onEnd`) and the row `Pressable` navigation.
- [X] T022 [P] [US3] Migrate `src/components/media-carousel.tsx` to a horizontal `FlashList`: keep `horizontal`, `showsHorizontalScrollIndicator={false}`, `snapToInterval={cell + Spacing.one}`, `decelerationRate="fast"` and the `Spacing.one` `ItemSeparatorComponent`. A horizontal FlashList needs a known height: give the container the cell height explicitly. If snapping or sizing cannot be made to behave like today's carousel, record why under Findings and ask the owner before leaving this one on `FlatList`.
- [X] T023 [P] [US3] Migrate `src/components/country-picker.tsx` to `FlashList`, keeping `keyboardShouldPersistTaps="handled"`, the selected-row styling and `accessibilityRole="radio"`; check it still scrolls inside its container or modal and that the selected country stays reachable.
- [X] T024 [US3] In `expo-client/german-world-club` run `npx tsc --noEmit` (clean) and `grep -rn "FlatList" src` (no result, apart from a comment that explains why a list stayed one, if T022 required it). Also run `npx expo-doctor` if available and record the result under Findings.
- [ ] T025 [US3] Walk all 11 lists on one iPhone and one Android device or simulator (throwaway API, never the production database): scroll fast without blank gaps or jumping rows, pull to refresh, page to the end (`onEndReached` fires once per page), like or hide a post in a feed and see only that row change, open a profile (header stays at the top), swipe the media carousel (snaps), pick a country. Record results under Findings; list what could not be run instead of ticking it.
- [X] T026 [US3] Add check 8 to `specs/033-profiling-safe-area/quickstart.md` ("lists use FlashList": the steps of T025 and the `grep` of T024).

**Checkpoint**: no `FlatList` left; every list behaves as before.

---

## Phase 5: Polish & Cross-Cutting

- [ ] T007 Check `quickstart.md` check 7 (dark and light appearance, rotation, large text) and check 6 for the bottom edge and keyboard on a text question; record under Findings.
- [X] T008 Run `npx tsc --noEmit` in `expo-client/german-world-club` one last time; tick the tasks that were really performed, and leave any that were not run unticked with the reason under Findings.

---

## Findings (fill in during T001, T004–T010, T012, T022, T024, T025)

- **T001**: baseline `tsc` clean. Cause confirmed in `src/components/ui.tsx`: `FormScreen` used `edges={['bottom']}` and `Centered` was a plain `View`; the profiling group, `(applicant)/waiting` and `r/[code]` hide their header.
- **T002, T003**: done. `FormScreen` and `Centered` (so `Loading`) now use `edges={['top', 'bottom']}`.
- **T008 (type check only)**: `tsc --noEmit` clean after the change.
- **T009**: `@shopify/flash-list` 2.0.2 installed with `expo install`; `package.json` and the root `package-lock.json` changed. It has no `android/`, `ios/`, podspec or config plugin, so no new EAS build.
- **T010**: checked against the installed source (the web docs were not opened). `style` is a plain `ViewStyle`; `getItemType` and `useRecyclingState` exist; `estimatedItemSize` is gone. `gap` in `contentContainerStyle` is not supported, so the three lists using it got an `ItemSeparatorComponent`. A list whose rows read props outside `data` (the country picker's `selected`) needs `extraData`.
- **T012**: only two rows hold state seeded per item: `PostCard.pending` and `VideoItem.playing` (media carousel). Both are fixed by a `key` on the row at the call site, which remounts a recycled cell. `EventCard` and the other rows have no state.
- **T013–T023**: all 11 lists migrated; marketplace, messages and events use separators instead of `gap`; the activity list uses `getItemType` by kind; the country picker has `extraData`; the carousel sits in a View of the cell height.
- **T024**: `tsc --noEmit` clean; `grep -rn FlatList src` finds nothing. `expo-doctor` was not run.
- **T025 NOT done**: no device or simulator was run. The scroll, refresh, paging, snapping and header checks (quickstart check 8) remain for the owner. Riskiest: the horizontal carousel's snapping and sizing, and variable-height feed rows.
- **T004, T005, T006, T007 NOT done**: no device or simulator was run (none booted, and running the app needs an API that is not the production database). Device checks from `quickstart.md` remain for the owner. T006 stays open until T005 shows whether any screen under a native header gained a gap.

---

## Dependencies & Execution Order

T001 → T002 ∥ T003 (same file, so do them in order) → T004 → T005 → T006 (conditional) → T007 → T008.
User Story 2 needs the same two component changes, so it adds verification and the conditional opt-out only.

User Story 3 (FlashList) is independent of Stories 1 and 2 and touches other files, so it can run before or after them. Inside it: T009 → T010 → T011 ∥ T012 → T013–T023 (any order) → T024 → T025 → T026. T009 is a gate: a native requirement stops the story. T007/T008 (Polish) should be repeated after US3 if US3 lands in the same pass.

## Parallel Opportunities

T013–T023 each touch one different file and run in parallel once T012 is done. T002 and T003 touch one file and are done in sequence. T004 and T005 are manual checks on the same devices and can be run in one pass.

## Implementation Strategy

**MVP = T001–T004**: the two-component change plus the profiling check. Then T005–T008 to confirm nothing else regressed.

**US3 (P3)**: ship after the MVP. If T009 shows a native dependency, split it into its own branch and EAS build rather than holding up the safe-area fix.

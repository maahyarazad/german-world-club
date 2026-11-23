---

description: "Task list for 034: Android dark-theme bottom tabs, then Expo SDK 58 + stable native-tabs"
---

# Tasks: Show every bottom tab on Android in the dark theme (and move to Expo SDK 58)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md) (R1-R7), [quickstart.md](./quickstart.md)

**Tests**: Not requested. The Expo client has no unit-test runner; verification is `tsc`, `expo lint`, `expo-doctor`, a bundle export and the manual steps in quickstart.md.

## Format: `[ID] [P?] [Story] Description`

Source paths are under `expo-client/german-world-club/` unless they start with `/`. Run npm commands from the repo root (npm workspace; lockfile is the root `package-lock.json`).

## Phase 1: Setup

- [ ] T001 Reproduce the bug first: run the app on an Android emulator in dark mode as a member (`npm run -w server seed:demo` prints credentials); confirm only the current tab is visible (quickstart step 2); note the result in specs/034-android-dark-tabs/research.md under R1.
- [X] T002 Record the SDK 57 baseline so regressions are attributable: run `npm run -w german-world-club typecheck` and `npm run -w german-world-club lint`, save the outputs (pass/fail and any warnings) in specs/034-android-dark-tabs/research.md under a new "R8 Baseline" heading.

## Phase 2: Foundational (blocks US2 only)

None for US1: its tokens already exist.

## Phase 3: User Story 1 - See and use all five tabs in dark mode (P1) 🎯 MVP

**Goal**: all five tabs visible on Android dark. **Independent Test**: quickstart steps 3 and 5.

- [X] T003 [US1] In `src/app/(member)/_layout.tsx`, give `NativeTabs` Android-only inactive colours (`iconColor` and `labelStyle` `{ default: textSecondary, selected: tint }`), iOS unchanged, with a comment giving the reason (research.md R1).
- [X] T004 [US1] Run `npx tsc --noEmit` in `expo-client/german-world-club`; no errors.
- [ ] T005 [US1] Verify on Android dark (quickstart steps 3 and 5): five visible tabs, each opens, Activity badge shows and caps at `99+`.

**Checkpoint**: shippable on SDK 57 on its own.

## Phase 4: User Story 2 - Expo SDK 58 and the stable tab API (P2)

**Goal**: app on SDK 58, all dependencies aligned, stable import used. **Independent Test**: T014-T017.

- [X] T006 [US2] Read the SDK 58 docs and upgrade notes at `https://docs.expo.dev/versions/v58.0.0/` (per `AGENTS.md`), list every breaking change that touches this app's dependencies in specs/034-android-dark-tabs/research.md under "R9 SDK 58 breaking changes"; add a follow-up task below for each one that applies.
- [X] T007 [US2] Create a restore point: `git stash list` is empty or noted, and commit the finished US1 work on branch 034-android-dark-tabs (`git add 'expo-client/german-world-club/src/app/(member)/_layout.tsx' specs/034-android-dark-tabs && git commit`) so the upgrade is a separate, revertible commit.
- [X] T008 [US2] Upgrade the SDK: from `expo-client/german-world-club` run `npx expo install expo@^58.0.0`, then `npx expo install --fix` so every Expo-managed package takes the version SDK 58 expects (this rewrites `package.json` and the root `package-lock.json`).
- [X] T009 [US2] Update the remaining non-Expo dependencies in `package.json` (`typescript`, `eslint`, `eslint-config-expo`, `eslint-import-resolver-typescript`, `@types/react`): bump `eslint-config-expo` to its SDK 58 line, check `npm outdated` for the rest, and take the newest versions that keep `npm run typecheck` and `expo lint` passing; `@gwc/contracts` stays `*`. Do not touch `server/`, `client/` or `packages/`.
- [X] T010 [US2] Run `npx expo-doctor` in `expo-client/german-world-club` and fix every reported mismatch or deprecation until it reports no issues.
- [X] T011 [US2] In `src/app/(member)/_layout.tsx` change the import to `import { NativeTabs } from 'expo-router/native-tabs';`, then `grep -rn "unstable-native-tabs" src` must return nothing. If the stable API renamed any prop used here (`backgroundColor`, `indicatorColor`, `iconColor`, `labelStyle`, `Trigger.Label/Icon/Badge`), adapt it using the installed `node_modules/expo-router/build/native-tabs/types.d.ts` and keep the Android-only colour logic from T003.
- [X] T012 [US2] Fix every type or lint error the upgrade causes (`npx tsc --noEmit`, `npx expo lint`), in the files they name, without loosening config or adding `any`/`@ts-ignore`.
- [X] T013 [US2] Review `app.config.js` against the SDK 58 notes (R9): plugins list (`expo-router`, `expo-splash-screen`, `expo-secure-store`, `expo-image-picker`, `expo-video`, `expo-notifications` and any others), new-architecture and Android/iOS settings. Then bump the app `version` so `runtimeVersion.policy: "appVersion"` yields a new runtime (research.md R7, FR-011).
- [X] T014 [US2] Bundle smoke test, non-destructive: `npx expo export --platform android` and `--platform ios` in `expo-client/german-world-club` (output to a scratch directory, not the repo); both must finish without errors.
- [ ] T015 [US2] From the repo root run `npm test` (typecheck of contracts, server, client and the Expo app, plus all workspace tests); the server tests that need a database may skip loudly, anything else must pass.
  - Status: contracts, client and Expo typechecks 0 errors; client tests 548 passed. Root `npm test` still stops at the server typecheck (1155 errors), which is identical on untouched HEAD (checked in a clean worktree), so not caused by this feature; server tests not run (need a DB).
- [ ] T016 [US2] Build and install development builds with EAS (`eas build --profile development --platform android` and `--platform ios`, or `npx expo run:android` / `run:ios` locally) and run quickstart steps 3-8 plus: sign-in, push registration, image upload, a deep link, sign-out.
- [ ] T017 [US2] Verify the OTA guard: confirm in `eas update` / the Expo dashboard that the new runtimeVersion differs from the one currently in production, so no 57 binary is offered the 58 bundle.

**Checkpoint**: SDK 58, stable import, health check clean.

## Phase 5: User Story 3 - Light theme and iOS unchanged (P3)

**Goal**: no regression. **Independent Test**: quickstart steps 4 and 7.

- [ ] T018 [US3] On the SDK 58 build verify Android light, and a live light↔dark switch (quickstart step 4).
- [ ] T019 [US3] Verify iOS in both themes against the previous build (quickstart step 7).

## Phase 6: Polish

- [ ] T020 Edge cases (quickstart step 6): largest system font, German and English labels, gesture and 3-button navigation.
- [ ] T021 Re-run the contrast calculation in research.md R2 if any colour changed; labels ≥ 4.5:1, icons ≥ 3:1.
- [X] T022 Update docs that name SDK 57: `AGENTS.md` (change `v57.0.0` to `v58.0.0` in the docs URL), `/CLAUDE.md` ("Expo SDK 57" → "Expo SDK 58"), and any "unstable native tabs" wording in `src` comments.
- [ ] T023 Open the PR (or update the existing one): title mentions both the Android tab fix and the SDK 58 upgrade, body lists the new-EAS-build requirement and the runtimeVersion bump.

## Dependencies & Execution Order

- T001, T002 first (both on SDK 57). US1 (T003-T005) before US2 so the fix is separable.
- US2: T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013 → T014 → T015 → T016 → T017 (all edit `package.json`, the lockfile or the same layout file, so they run in order).
- US3 needs T016. T018 and T019 are independent of each other [P].
- Polish after US3; T022 can be done any time after T008.

## Implementation Strategy

MVP = T001-T005 (the colour fix on SDK 57). Commit it separately (T007), then do the upgrade as US2 so it can be reverted without losing the fix. Do not merge until T016-T019 pass on real Android and iOS builds, because a native SDK change cannot be proven by typecheck alone.

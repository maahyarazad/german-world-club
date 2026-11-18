# Implementation Plan: Show every bottom tab on Android in the dark theme

**Branch**: `034-android-dark-tabs` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

## Summary

`(member)/_layout.tsx` gives `NativeTabs` a background, an indicator colour and a *selected* label colour only. On Android the inactive label and icon colours then fall back to `Color.android.dynamic.onSurfaceVariant`, a Material colour taken from the phone's system theme, not the app's theme (`expo-router/build/native-tabs/appearance.android.js`). With the app in dark and that fallback not matching, inactive tabs are drawn nearly the bar's own colour. The fix is to set the inactive label and icon colours, and the selected icon colour, from the existing theme. The same branch then moves the app to Expo SDK 58 (the stable `expo-router/native-tabs` entry only exists there) and switches the import; see research.md R5-R7.

## Technical Context

**Language/Version**: TypeScript, React Native via Expo SDK 57, expo-router 57.0.22
**Primary Dependencies**: Expo SDK 57 -> 58 (expo ~58, expo-router 58.x, react-native 0.8x as pinned by the SDK), `expo-router/native-tabs`; before the upgrade `expo-router/unstable-native-tabs` (`NativeTabs`: `iconColor`, `labelStyle` accept `{ default, selected }`)
**Storage**: N/A
**Testing**: `npm run typecheck` (`tsc --noEmit`); the Expo client has no unit-test runner. Contrast checked by calculation (research.md) and on an Android emulator in both themes.
**Target Platform**: Android (fix); iOS must be unchanged
**Project Type**: mobile-app (client only)
**Performance Goals**: N/A
**Constraints**: US1 uses only existing `Colors` tokens. US2 changes native code, so it needs new EAS builds and an OTA-safe `runtimeVersion`.
**Scale/Scope**: US1: 1 file, ~6 lines. US2: `expo-client/german-world-club/package.json`, root `package-lock.json`, `app.config.js` review, the tab layout import, and docs that name SDK 57.

## Constitution Check

*Gate before research; re-checked after design.*

- I. One rule set: no business rule involved; presentation only. Pass.
- II-VI (routes, published state, database integrity, failure handling, server output): no server, route, data or log change. Pass / not touched.
- Workflow: spec first (done). "Every principle has an automated check" applies to principles touched; none is. Pass.
- Technology baseline: no secrets, no new dependency. Pass.

No violations; Complexity Tracking is empty. Re-check after design: unchanged.

## Project Structure

```text
specs/034-android-dark-tabs/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── tasks.md            # /speckit-tasks

expo-client/german-world-club/src/app/(member)/_layout.tsx   # the only source change
expo-client/german-world-club/src/constants/theme.ts         # read-only: tokens reused
expo-client/german-world-club/package.json, ../../package-lock.json  # SDK 58 + dependency bumps
expo-client/german-world-club/app.config.js                  # plugins / runtimeVersion review
expo-client/german-world-club/{AGENTS,CLAUDE}.md, ../../CLAUDE.md  # "SDK 57" -> "SDK 58" docs pointer
```

**Structure Decision**: edit the existing layout in place; no new component, because the colours are one prop each.

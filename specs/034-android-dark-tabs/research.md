# Research: 034 Android dark tabs

## R1. Why are inactive tabs invisible?
- **Decision**: cause is the unset inactive colours.
- **Evidence**: `appearance.android.js` sets `normal.tabBarItemTitleFontColor = labelStyle?.color ?? onSurfaceVariant` and `normal.tabBarItemIconColor = iconColor ?? onSurfaceVariant`. The layout passes `labelStyle={{ selected: … }}` only and no `iconColor`, so `normal` uses the Material dynamic colour, which follows the system's Material theme, not the app's `useTheme()`. The bar background is the app's `theme.background` (`#0B0D10` dark), so the two disagree. The selected tab is visible because `tint` and `backgroundSelected` are set explicitly.
- **Alternatives**: a wrong `indicatorColor` (rejected: the active tab is fine); a layout/overflow issue (rejected: spec says the tabs exist and the active one renders).
- **Confidence**: high from source; confirm on a device (quickstart step 2).

## R2. What to set?
- **Decision**: `iconColor={{ default: theme.textSecondary, selected: theme.tint }}` and `labelStyle={{ default: { color: theme.textSecondary }, selected: { color: theme.tint } }}`.
- **Rationale**: both props accept `{ default, selected }` (`types.d.ts`); `textSecondary` is the app's existing muted text token.
- **Contrast** (WCAG relative luminance, calculated): dark `#A0A5AB` on `#0B0D10` ≈ 7.8:1; light `#60646C` on `#ffffff` ≈ 5.9:1. Both clear 4.5:1 (labels) and 3:1 (icons). Selected: dark `#8FB3E8` on indicator `#2A2E33` ≈ 6.4:1; light `#0B2545` on `#E3E5E8` ≈ 12.2:1.
- **Alternatives**: `tintColor` alone (rejected: selected-only fallback chain, and spec FR-003 wants current vs inactive clearly distinct); a custom tab bar (rejected: abandons native tabs for a one-prop fix).
- **Not colour alone (FR-003)**: the active-indicator pill and the filled icon variant (`sf` selected, Android indicator) already differ in shape.

## R3. iOS impact
- `appearance.ios.js` also reads `iconColor` and `labelStyle`, so the props reach iOS. Muted inactive tabs match iOS's own convention, but FR-006 says no change, so the planned edit is applied through `Platform.OS === 'android'` unless a visual comparison shows no difference.
- **Decision**: gate to Android; leave iOS untouched.

## R4. Docs
`https://docs.expo.dev/versions/v57.0.0/sdk/router-native-tabs/` returned 404 when fetched; the installed package's types and source were used instead. Re-check the docs page once located.

## R5. Is there a stable `native-tabs` entry, and where?
- **Decision**: it ships with SDK 58 only. expo-router 57.0.22/57.0.31 export `./unstable-native-tabs` only; 58.0.32's `package.json` exports both `./native-tabs` and `./unstable-native-tabs`.
- **Alternative**: stay on 57 with the unstable import (rejected by the owner: wants SDK 58).

## R6. Target version
- `npm view expo dist-tags`: `latest` = 58.0.26, so SDK 58 is the current stable line, not a canary. Use `npx expo install expo@^58` then `npx expo install --fix`, so every Expo-managed package is pinned to the SDK's own table.
- "All dependencies" = the Expo workspace's `dependencies` and `devDependencies` (including `@shopify/flash-list`, `react-native-*`, `typescript`, `eslint`, `eslint-config-expo`). Packages outside it are out of scope.
- Per `AGENTS.md`, read the SDK 58 docs and upgrade notes before coding: `https://docs.expo.dev/versions/v58.0.0/`. Breaking changes found there become tasks; none are assumed here.

## R7. Native and OTA consequences
- `android/` and `ios/` are git-ignored (generated), so nothing native is committed; EAS builds regenerate them.
- A new SDK needs new store/internal builds. `runtimeVersion` in `app.config.js` must change with the SDK so an OTA update built for 58 is never offered to a 57 binary (FR-011). Check its current policy before building.
- Push, associated domains and Google services config are native: smoke-test them on the new build.
- `runtimeVersion.policy` is `"appVersion"`, so the runtime changes only when the app `version` in `app.config.js` changes. The SDK upgrade therefore MUST bump `version` (currently `1.0.0` in package.json; check `app.config.js`), otherwise a 58 OTA update would be offered to 57 binaries.

## R8. Baseline on SDK 57 (before the upgrade, 2026-11-18)
- `npx tsc --noEmit` in `expo-client/german-world-club`: clean (no output).
- `npx expo lint`: **15 errors, 2 warnings** already present, e.g. `react-hooks/refs` "Cannot update ref during render" at `src/notifications/registration.ts:82`. These are not caused by this feature; after the upgrade the count must not rise, and new ones must be fixed.

## R9. SDK 58 breaking changes (sources: expo.dev/blog/how-to-upgrade-to-sdk-58, docs.expo.dev/router/migrate/sdk-57-to-58, docs.expo.dev/versions/v58.0.0)
Versions: React Native 0.86 → 0.88, React 19.2.3 → 19.3.0, Node ≥ 22.13, Android compileSdk 36 → 37, Xcode ≥ 26.4. Upgrade command: `npx expo install expo@^58.0.0 --fix`, then `npx expo-doctor@latest`.

Checked against this app with a grep of `src/` and `app.config.js`. No hit for: `InteractionManager`, `ImageBackground`, `Modal animated`, `StatusBar` removed props, `react-native/Libraries/*`, `initialRouteName`, `beforeRemove`, `freezeOnBlur`, `navigationKey`, `initialParams`, `redirect=`, `expo-router/react-navigation`, `expo-router/head`, `withLayoutContext`, `navigation.navigate/dispatch`, `enableSceneSupport`.

Still applies, to verify during the upgrade:
- **Native tabs import** moves to `expo-router/native-tabs` (the goal). Screens must now be declared in the layout: the tab layout declares all five `Trigger`s, so it is fine; the other groups' layouts must be checked (T012).
- **Strict TypeScript API** is the default: type errors expected for refs (use instance types) and deep imports; run `tsc` early.
- **Android R8** is on by default for release builds: reflection-based libraries may need keep rules (`expo-build-properties`); test a release build (T016).
- **iOS 26+ headers** are transparent Liquid Glass; scroll views need `contentInsetAdjustmentBehavior="automatic"`, screens without a scroll view `headerTransparent: false`. Related to feature 033's safe-area work: re-check header-less and header screens on iOS.
- **iOS scene lifecycle**: prebuild now generates `SceneDelegate.swift`; `android/` and `ios/` are generated here, so nothing to migrate by hand.
- **iOS 27 orientation**: `app.config.js` sets `orientation: "portrait"`; per the notes a lock may be ignored while the app is resizable on iPad/iOS 27; check.
- **EAS**: if `eas.json` pins an iOS image, use `sdk-58`/`latest`. It pins none (checked `ios` entries), nothing to do.
- **Expo Go** supports SDK 58 only: the project uses development builds, so unaffected.
- **Fingerprint** default preset is now `balanced`: `version` changes no longer alter the fingerprint, but `runtimeVersion.policy: "appVersion"` still follows `version`, so T013 stands.
- **Optional peers**: `expo-symbols` (Android `md` icons) and `@expo/ui` are already dependencies here.
- Web-only changes (`web.output` default `server`, async routes, `expo-router/head`) are not used by the app.

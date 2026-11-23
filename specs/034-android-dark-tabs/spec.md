# Feature Specification: Show every bottom tab on Android in the dark theme

**Feature Branch**: `034-android-dark-tabs`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "On Android in the dark theme, the member bottom tab bar shows only the active tab; the inactive tabs (icon and label) are not visible. Make every tab visible in both themes on Android."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See and use all five tabs in dark mode (Priority: P1)

A signed-in member on an Android phone whose appearance is set to dark opens the app. The bottom bar should show all five destinations (Threads, Marketplace, Activity, Events, Profile), each with its icon and label, with the current one clearly marked. Today only the current tab is visible; the others are invisible, so the member cannot tell where they can go or tap where they cannot see.

**Why this priority**: The bottom bar is the app's only top-level navigation. With it invisible, members cannot discover or reach four of five areas in dark mode.

**Independent Test**: On an Android device or emulator in dark mode, sign in as a member and look at the bottom bar: five icons with labels are visible, one is marked as current. Tap each.

**Acceptance Scenarios**:

1. **Given** an Android member in dark theme, **When** any member screen is shown, **Then** all five tabs show icon and label and are readable against the bar.
2. **Given** the same state, **When** the member taps a visible inactive tab, **Then** that tab opens and becomes the marked one, and the previous one stays visible as an inactive tab.
3. **Given** the same state, **When** the current tab is compared with the others, **Then** the difference between current and inactive is clear without relying on colour alone.
4. **Given** the Activity tab has unread items, **When** the bar is shown, **Then** the unread count remains visible on that tab.

---

### User Story 2 - Run on Expo SDK 58 with the stable tab API (Priority: P2)

Added by the owner's request. The app moves from Expo SDK 57 to SDK 58, all Expo-managed and development dependencies are brought to the versions that SDK expects, and the member tab bar uses the stable tab entry point (`expo-router/native-tabs`) instead of the `unstable-` one, which does not exist in SDK 57. Members see no change except the fix in User Story 1.

**Why this priority**: The stable entry point only ships with SDK 58, and staying behind accumulates upgrade cost. It follows P1 because P1 is a shippable fix on its own.

**Independent Test**: Install the new build; sign in, walk every tab and the main flows on Android and iOS; the dependency health check reports no mismatches, and the type check, lint and the workspace tests pass.

**Acceptance Scenarios**:

1. **Given** the upgraded project, **When** the dependency health check runs, **Then** it reports no version mismatches or deprecated packages.
2. **Given** the upgraded project, **When** the bottom bar is built, **Then** it imports from the stable entry point and no `unstable-native-tabs` import remains in the app.
3. **Given** the upgraded app on Android and iOS, **When** a member signs in and uses Threads, Marketplace, Activity, Events, Profile, push registration, media upload and sign-out, **Then** each works as before.
4. **Given** members on the previous app version, **When** an over-the-air update is published for the new SDK, **Then** it is not delivered to builds that cannot run it.

---

### User Story 3 - Light theme and iOS look unchanged (Priority: P3)

Members in light theme on Android, and all members on iOS, already see their tabs. The fix must not make any of those worse.

**Why this priority**: Guards against regression while fixing the reported case.

**Independent Test**: Compare the bar before and after on Android light and on iOS in both themes.

**Acceptance Scenarios**:

1. **Given** Android in light theme, **When** the bar is shown, **Then** all five tabs remain visible and readable.
2. **Given** iOS in either theme, **When** the bar is shown, **Then** it looks and behaves as before.
3. **Given** a member switches the phone between light and dark while the app is open, **When** the bar re-renders, **Then** all tabs stay visible in the new theme.

---

### Edge Cases

- Dark theme with a large system font size: labels stay readable and are not clipped.
- A badge count above 99 still shows as "99+".
- Phone with gesture navigation versus three-button navigation: the bar is not hidden or overlapped by the system bar.
- English and German labels: both are visible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On Android in dark theme, the member bottom bar MUST show all five tabs, each with icon and label.
- **FR-002**: Inactive tabs MUST have enough contrast against the bar background to be readable (at least the WCAG 2.2 AA minimums: 4.5:1 for labels, 3:1 for icons).
- **FR-003**: The current tab MUST be visibly distinct from inactive tabs, and also meet the same contrast minimums.
- **FR-004**: The same guarantees MUST hold in light theme on Android and when the theme changes at runtime.
- **FR-005**: The unread badge on Activity MUST stay visible and correct.
- **FR-006**: iOS appearance and tab navigation behaviour MUST NOT change.
- **FR-008**: The app MUST run on Expo SDK 58, with every Expo-managed and development dependency at the version that SDK expects, and the dependency health check clean.
- **FR-009**: The member tab bar MUST use the stable tab entry point; no `unstable-native-tabs` import may remain in the app.
- **FR-010**: Existing behaviour (sign-in, tabs, push registration, media, sign-out, deep links) MUST be unchanged after the upgrade.
- **FR-011**: Over-the-air updates MUST NOT reach builds on a different SDK.
- **FR-007**: The colours used for the bar MUST come from the app's existing theme, so a future theme change cannot reintroduce an invisible tab.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In dark theme on Android, 5 of 5 tabs are visible with icon and label on every member screen that shows the bar.
- **SC-002**: A member can reach each of the five areas from the bar on the first attempt without guessing where to tap.
- **SC-003**: Contrast of every inactive tab label and icon against the bar meets the minimums in FR-002 in both themes.
- **SC-005**: The dependency health check reports 0 issues, and the type check, lint and workspace tests pass.
- **SC-006**: A fresh Android and iOS build starts, signs in and reaches all five tabs with no crash and no new warning on launch.
- **SC-004**: No visual difference on iOS and no loss of tabs on Android light, compared with today.

## Assumptions

- The cause is that inactive tab colours blend into the dark bar background; the exact cause is a planning matter, not decided here.
- Five tabs remain the maximum, as already recorded for this bar.
- The tab-bar colour fix (US1) is in scope for the bar only; the SDK upgrade (US2) touches the whole mobile app.
- "All the dependencies" means the Expo client workspace (`expo-client/german-world-club`); the server, web client and contracts packages are not upgraded here.
- The upgrade needs new native builds (EAS) for both platforms; android/ and ios/ are generated and git-ignored.
- Verified on Android 13+ on a real device or emulator, since this is native rendering.

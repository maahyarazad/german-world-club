# Feature Specification: Keep onboarding screens clear of the phone's status bar

**Feature Branch**: `033-profiling-safe-area`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "in the Expo RN application - during the profiling steps the text of application is overlaped with the ios wifi and clock indicator at the very top - I think it is going to be same in the Android - I believe expo should have a API to measure this and deduct it from the height - add this fix"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read the profiling questions without them hiding under the clock (Priority: P1)

An approved applicant is answering the profiling questionnaire in the mobile app. Today the first line of each question (its title) is drawn underneath the phone's clock, signal and Wi-Fi indicators, so it is partly unreadable and looks broken. The applicant should see the title fully, starting below those indicators, on every question and on the review and outcome screens that follow.

**Why this priority**: The questionnaire is the second onboarding gate; every new member passes through it, and the first thing they see on each screen is clipped. It is the reported defect.

**Independent Test**: Open the app on a phone with a notch or camera cut-out (and one without), reach the profiling questionnaire, and check every screen: the title and first element are fully visible and nothing touches the status indicators.

**Acceptance Scenarios**:

1. **Given** an applicant on iPhone with a notch or Dynamic Island, **When** any profiling question is shown, **Then** the title starts below the clock, signal and Wi-Fi indicators and is fully readable.
2. **Given** an applicant on Android with a status bar (with or without a camera cut-out), **When** any profiling question is shown, **Then** the title is fully readable and clear of the status bar.
3. **Given** a phone with a short status bar and no cut-out, **When** the same screens are shown, **Then** the content still fits and no large blank band appears at the top.
4. **Given** the applicant rotates the phone or changes text size, **When** a profiling screen is shown, **Then** the content stays clear of the status bar and cut-outs.

---

### User Story 2 - Every other onboarding and waiting screen is clear too (Priority: P2)

The same gap likely exists on other screens that have no navigation header: the waiting-for-approval screen, the verification screens, the loading and centred message screens, and the outcome screen at the end of profiling. The applicant should never see content under the status bar anywhere in the app.

**Why this priority**: The cause is shared, so the same defect appears wherever a screen has no header of its own. Fixing only the profiling questions would leave the next screen broken.

**Independent Test**: Walk the app from registration to the signed-in home on iOS and Android, looking at the top edge of each screen.

**Acceptance Scenarios**:

1. **Given** any screen that shows no navigation header, **When** it is displayed, **Then** its content starts below the status bar and any cut-out.
2. **Given** a screen that already shows a navigation header, **When** it is displayed, **Then** it does not gain an extra blank band above the header.
3. **Given** the loading screen or a centred message, **When** it is displayed, **Then** it stays centred in the usable area, not under the indicators.

---

### User Story 3 - Long lists scroll on Shopify FlashList (Priority: P3)

Added to this branch by the owner's request. Every scrolling list in the mobile app (feeds, replies, activity, marketplace, messages, events, followers, the media carousel and the country picker) uses `@shopify/flash-list` instead of React Native's `FlatList`, so long lists recycle their rows. Nothing changes for the member: same rows, same pull-to-refresh, same paging.

**Independent Test**: scroll, refresh and page each list; `grep -rn FlatList src` finds nothing.

**Acceptance Scenarios**:

1. **Given** any list in the app, **When** the member scrolls, refreshes or reaches the end, **Then** it behaves as before.
2. **Given** a row with a busy flag or a playing video, **When** the row is recycled for another item, **Then** it shows no state of the previous item.

---

### Edge Cases

- A phone with a camera cut-out that is taller than the status bar (Dynamic Island, punch-hole, notch).
- An Android phone using gesture navigation, three-button navigation, or an edge-to-edge display.
- The keyboard open on a question with a text field: the focused field stays visible and the top stays clear.
- Dark and light appearance, and the status bar's own icon colour staying readable on the screen's background.
- Very large accessibility text sizes.
- Screens that already handle the bottom edge (home indicator, navigation bar) must keep doing so.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On every profiling screen (each question, the information screens, the review, and the outcome), no text or control MUST be drawn beneath the phone's status indicators or a camera cut-out.
- **FR-002**: The space kept clear at the top MUST come from the phone itself (its actual status bar and cut-out size), not from a fixed number, so it is right on every iPhone and Android model and orientation.
- **FR-003**: The same protection MUST apply to every other screen in the app that shows no navigation header, so one shared place decides it rather than each screen.
- **FR-004**: A screen that already shows a navigation header MUST NOT gain extra space above it.
- **FR-005**: Existing protection at the bottom of the screen (home indicator, navigation bar) MUST be kept, and the on-screen keyboard behaviour on forms MUST be unchanged.
- **FR-006**: The status indicators MUST stay legible in both light and dark appearance.
- **FR-007**: The fix MUST work on iOS and Android with the current app build, without needing a new native build.
- **FR-008**: Every list in the Expo app MUST be a `FlashList` (`@shopify/flash-list`), with no row state surviving recycling, and without a new native build (v2 is JavaScript-only).

### Key Entities *(include if feature involves data)*

No data is involved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a notched iPhone, a Dynamic Island iPhone and an Android phone with a camera cut-out, 100% of profiling screens show their first line fully visible and clear of the status indicators.
- **SC-002**: On a phone with no cut-out, the blank space above the first line is no larger than the status bar itself plus the screen's normal padding.
- **SC-003**: Across the whole onboarding path (registration through the signed-in home), no screen is found with content under the status bar on any of the checked devices.
- **SC-004**: No screen that already had a navigation header shows a visibly larger gap above it than before.
- **SC-005**: The bottom edge and keyboard behaviour on forms are unchanged on the checked devices.
- **SC-006**: No `FlatList` import remains in the Expo app, and each list scrolls, refreshes and pages as before.

## Assumptions

- The app reads the status bar and cut-out sizes from the device through the safe-area facility the app already uses on some screens, so the fix is a shared change, not per-screen numbers.
- The root cause is that the shared form container and the centred and loading containers protect only the bottom edge, and the onboarding groups hide their navigation header.
- Checking is done on a real or simulated iPhone with a notch or Dynamic Island, an iPhone without one, and an Android phone or emulator with a cut-out; there is no automated test runner for the app, so verification is by type checking plus a manual walk-through.
- Out of scope: redesigning screen layouts, changing the navigation structure, and the signed-in member tabs, which have their own header.

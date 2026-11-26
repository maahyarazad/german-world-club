# Feature Specification: The header menu opens below the header, and stays the phone's own menu (app)

**Feature Branch**: `040-menu-below-header`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "apply the changes but DO NOT CHANGE THE NATIVE MENU" — said while an earlier request was being carried out: "in iOS the three dots open a menu, this menu opens on top of the three dots (the three-dots icon goes behind the menu); the menu should open below the entire header (below the header); this should be applied to both iOS and Android".

## Context

In the app, the Marketplace and Threads screens show three dots at the right of the header. Tapping them opens a short menu (Marketplace: Messages, My listings, New listing; Threads: New post). On each phone that menu is the phone's own: the system menu on an iPhone, the Material drop-down on an Android phone. The app draws no pop-up of its own (feature 039, US8).

Two things were reported or asked:

1. On an iPhone the menu opens **on top of the three dots**, so the icon goes behind it (the result of the iPhone check, task T045 of feature 039).
2. The menu should open **below the whole header**, on both phones, so nothing of the header is covered while it is open.

An earlier plan for the second request (feature 039, US9, FR-026 to FR-029) solved it on the iPhone by drawing a menu card of the app's own. That is **withdrawn**: the instruction for this feature is *do not change the native menu*. So this feature is the same request with that constraint added: the menu must go below the header, and it must stay the phone's own menu.

**Amended 2026-11-26, after this spec was written:** Threads no longer has the three dots. Its only action, New post, became a plain icon button (AntDesign `plus`, `components/header-icon-button.tsx`), because a drop-down for a single row is a tap more than the action needs. So the menu this feature is about is on **Marketplace only**: wherever this spec says Marketplace and Threads, read Marketplace. The Threads button is not part of this feature, and nothing here is judged on Threads.

Not in scope: what the menu's rows say or do, how the three dots look, the header's layout, and any screen other than Marketplace and Threads (the only two with a menu).

## Clarifications

### Session 2026-11-26

- Q: With the phone's own menu, what should the iPhone do about the menu covering the three dots? → A: Option B: try one native-only change (lengthen the invisible area that opens the menu downward past the header so the system anchors the menu lower), and if a phone test shows it does not help, take it back out and leave the iPhone as it is today. No app-drawn replacement, and no library upgrade in this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - On an Android phone the menu opens below the header (Priority: P1)

A member on an Android phone taps the three dots in Marketplace or Threads. The Material drop-down opens with its top edge at the header's bottom edge. The three dots, the club's emblem and the title are all still visible above it.

**Why this priority**: it is the request, and it is the platform where it can be met while keeping the phone's own menu (see Assumptions).

**Independent Test**: on an Android phone open Marketplace, tap the three dots: the menu starts under the header's bottom line and the dots are visible.

**Acceptance Scenarios**:

1. **Given** an Android phone on Marketplace or Threads, **When** the three dots are tapped, **Then** the menu opens with its top edge at or below the header's bottom edge and none of the header is covered.
2. **Given** the menu is open, **When** a row is chosen, **Then** the menu closes and that row's screen opens, exactly as before.
3. **Given** the menu is open, **When** the member taps outside it or uses the phone's back, **Then** it closes and nothing opens.
4. **Given** the three dots are at the right edge of the screen, **Then** the menu stays fully on screen.

---

### User Story 2 - The menu is still the phone's own, on both phones (Priority: P1)

On both phones the menu that opens is the one the phone itself uses, with the phone's look, animation and accessibility. The app does not draw a menu, a card, a sheet or a dialog in its place, and it does not change what kind of menu this is.

**Why this priority**: it is the explicit constraint of this feature and overrides the earlier plan.

**Independent Test**: open the menu on each phone and compare it with another system menu on the same phone: they look and move alike; nothing in the app's own style is drawn.

**Acceptance Scenarios**:

1. **Given** an iPhone, **When** the three dots are tapped, **Then** the system's menu opens.
2. **Given** an Android phone, **When** the three dots are tapped, **Then** the Material drop-down opens.
3. **Given** either phone, **Then** the rows, their labels, the red dot that marks a row with news, and where each row leads are unchanged.

---

### User Story 3 - On an iPhone the menu does not cover the three dots (Priority: P1)

A member on an iPhone taps the three dots. The system menu opens, and the three dots, the emblem and the title are still visible, with the menu below the header.

**Why this priority**: it is the first thing reported (the menu opened over the dots) and the second half of the request ("on both"). It is listed apart from the Android story because it is not known to be possible with the phone's own menu and the libraries the app uses now: it is an attempt, with a defined fallback (FR-003).

**Independent Test**: on an iPhone open Marketplace, tap the three dots: the menu's top edge is under the header's bottom line and the dots remain visible.

**Acceptance Scenarios**:

1. **Given** an iPhone on Marketplace or Threads, **When** the three dots are tapped, **Then** the system menu opens below the header and none of the header, including the dots, is covered. *(An attempt: if the phone test shows the system menu still covers the dots, the change is taken back out and the iPhone is left as it is today, FR-003.)*
2. **Given** the menu is open, **When** a row is chosen or the member taps outside it, **Then** it behaves as the system's menu does: a row opens its screen once the menu has closed, and a tap outside closes it without opening anything.

---

### User Story 4 - Nothing else about the header and menu changes (Priority: P2)

Apart from where the menu opens, the header and the menu behave as they do now.

**Why this priority**: a placement change must not cost anything else.

**Independent Test**: use Marketplace and Threads as before: the dots look and sit as before, the badge shows when there is news, and every row leads where it did.

**Acceptance Scenarios**:

1. **Given** unread messages, **Then** the three dots still carry the red dot and the Messages row still shows its own.
2. **Given** a screen reader, **Then** the dots are still announced as a button named "More" (with a dot when there is news) and the rows by their labels.
3. **Given** light and dark mode, **Then** the dots keep their theme colour and the menu follows the phone.
4. **Given** a tab with no header actions, **Then** it still shows no three dots.
5. **Given** the member taps the three dots, **Then** the dots do not move, jump or resize.

### Edge Cases

- A screen with the same header presented as a sheet over another (Threads' compose and handle, Profile's edit): the menu is only on Marketplace's and Threads' main screens, but wherever the header sits, the menu opens below *that* header.
- A long German row label: it stays inside the menu and the menu inside the screen.
- The area that opens the menu must not grow so much that a tap on the page under the header opens it by mistake (FR-007).
- The first tap after launch opens the menu as every later one does (nothing depends on the menu having been shown before).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On an Android phone the menu MUST open with its top edge at or below the header's bottom edge, covering no part of the header.
- **FR-002**: On both phones the menu MUST remain the phone's own menu. The app MUST NOT draw a replacement (no card, sheet, dialog or overlay of its own), and MUST NOT change which kind of menu it is.
- **FR-003**: On an iPhone the menu MUST open below the header and MUST NOT cover the three dots. This MUST be attempted with the phone's own menu only, by one native-only change: the invisible area that opens the menu is lengthened downward past the header, within FR-007, so that the system anchors its menu lower. If a test on an iPhone shows that the system menu still covers the dots, the change MUST be taken back out and the iPhone's menu left exactly as it is today. No app-drawn replacement is made in either case (FR-002).
- **FR-004**: The rows, their order, their labels, the marker for a row with news, and the screen each row opens MUST be unchanged.
- **FR-005**: The three dots MUST stay as they are: the same icon, size and position, a button called "More" (with a dot when there is news), and they MUST NOT move or resize when the menu opens.
- **FR-006**: Choosing a row MUST close the menu and then open that row's screen; a tap outside the menu, or the phone's back, MUST close it and open nothing.
- **FR-007**: The area that opens the menu MUST NOT extend below the header by more than 12 points (a default, see Assumptions), so that a tap on the page further down never opens it.
- **FR-008**: No change to the server, the shared contracts or the web console, and no change to the header's look or to any screen other than Marketplace's and Threads' menus.

### Key Entities

None: this is a placement and presentation change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On an Android phone, with the menu open on Marketplace and on Threads, the menu overlaps the header by 0 px, and the three dots, the emblem and the title are fully visible.
- **SC-002**: On both phones the menu that opens is the phone's own, and the app draws no menu, card or sheet in its place (checked by looking at it next to a system menu on the same phone).
- **SC-003**: On an iPhone, with the menu open, the three dots are fully visible and the menu's top edge is below the header's bottom edge — or, if the phone test shows the native-only change does not achieve that, the change is removed, the iPhone's menu is exactly as it is today, and the result is recorded in this spec.
- **SC-004**: 100% of the rows lead where they did before, and the unread marker, the dots' accessibility name and both colour schemes are unchanged.
- **SC-005**: A tap on the page more than 12 points below the header's bottom edge never opens the menu, and a tap anywhere inside the header outside the dots' own area never opens it either.

## Assumptions

- **"The native menu" means the phone's own menu.** The system menu on an iPhone and the Material drop-down on an Android phone. They stay. This reads the instruction as withdrawing the earlier plan for an app-drawn card on the iPhone (039 US9, FR-026 to FR-029, plan item 8, tasks T046 to T054), which this feature supersedes.
- **What was checked in the libraries the app uses now** (the installed versions, read in their source, recorded in `specs/039-profile-activity-tabs/research.md` R2): the Android menu opens at the bottom edge of whatever it is anchored to, and can be opened by code, so it can be anchored to a thin invisible strip along the header's bottom edge while the dots stay where they are; that meets FR-001 with the Material menu unchanged. The iPhone's menu has no way to be placed, and cannot be opened by code, so it always opens relative to the view that was tapped; on the phone it opened over that view.
- **The iPhone attempt (decided in Q1, option B)** is the one native-only idea left, and it is untested: make the invisible native area that the dots sit on extend downward past the header, so that the system anchors its menu lower. It needs a phone to learn whether the system then opens the menu below the header or still covers the dots, and it enlarges the area that opens the menu by that many points below the header (FR-007). An earlier note in the research said that a view outside its parent's bounds gets no touches on iOS; that was wrong for the React Native version installed here, and the correction is recorded in `specs/039-profile-activity-tabs/research.md` (R3). Whether the header's own parents clip such a view was not checked.
- **12 points** (FR-007, SC-005) is a default, chosen because it is well under the 44 points of a comfortable tap target and small beside the header, so the added area reads as part of the dots' own. It is to be revisited with the phone result if the iPhone experiment is chosen.
- The iPhone's version of iOS was not reported. What the system menu does on other versions is not known.
- Portrait only (the app is locked to portrait), so rotation is not a case.
- No new dependency or native module is assumed. Looking for a newer library version that can place the iPhone menu (Q1, option C) was not chosen; it could mean an upgrade, which would be its own decision and its own feature.
- The previous header padding change (the header's side padding raised to a larger step) is separate and stays.

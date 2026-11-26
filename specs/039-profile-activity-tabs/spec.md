# Feature Specification: Your posts move from Profile to Activity (app)

**Feature Branch**: `039-profile-activity-tabs`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "in Expo application - in the profile section move the Member Threads activity (Threads, Replies, Media and reposts) to Activity section"

## Context

In the app's Profile tab, below the contact details and the settings buttons, the member sees their own posts in four tabs: Threads, Replies, Media and Reposts (feature 010, FR-008). The Activity screen, opened from a button on Profile, is a separate feed of what happened to the member: likes, replies, quotes, reposts, mentions and follows.

Those two things are both "my Threads activity", and today they live on two different screens. This feature moves the four post tabs from Profile to Activity, so Profile is a place for who the member is and their settings, and Activity is the one place for everything they have done and everything that has happened to them.

Not in scope: the web console, the server, the public profile of another member (`threads/member/[id]`, which keeps its own four tabs), and what any tab shows.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - My posts are in Activity (Priority: P1)

A member opens Profile, taps Activity, and finds their own posts there in the same four tabs they used to see on Profile: Threads, Replies, Media and Reposts. The tabs behave as before: the same posts in the same order, the same cards, the same like, repost, reply and delete actions.

**Why this priority**: it is the request.

**Independent Test**: sign in, post a thread and a reply, open Profile, tap Activity, choose Threads and Replies: both posts are there, and deleting one removes it from the list.

**Acceptance Scenarios**:

1. **Given** a member with posts, **When** they open Activity and choose Threads, **Then** their top-level posts show, newest first.
2. **Given** the same member, **When** they choose Replies, Media or Reposts, **Then** the matching posts show, as they did on Profile.
3. **Given** a member with no posts in a tab, **Then** the tab says so (the existing empty text) and nothing else is shown.
4. **Given** a long list, **When** the member scrolls to the end, **Then** more posts load. (On Profile only the first page was ever shown.)
5. **Given** the member deletes one of their posts from the list, **Then** it disappears from that list at once.
6. **Given** the member opens a post and comes back, or composes a new post and comes back, **Then** the list shows the change.

---

### User Story 2 - Profile no longer lists my posts (Priority: P1)

The Profile screen shows the member's header, contact details, the settings and Activity buttons, the language choice and sign out, and no longer shows the four tabs or any posts.

**Why this priority**: moving means removing from the old place; leaving a copy would be two lists to keep in step.

**Independent Test**: open Profile with a member who has posts: no tabs and no posts are on the screen, and the Activity button (with its unread count) still opens Activity.

**Acceptance Scenarios**:

1. **Given** a member with posts, **When** they open Profile, **Then** no post tabs and no posts are shown.
2. **Given** unread activity, **Then** the Activity button still shows the unread count.
3. **Given** another member's profile, **Then** it still shows that member's four tabs, unchanged.

---

### User Story 3 - Activity keeps working as it did (Priority: P1)

Everything Activity does today still works. The feed of likes, replies, quotes, reposts, mentions and follows is the first thing shown, opening it still marks it as seen so the unread count clears, and pull-to-refresh and load-more still work.

**Why this priority**: adding tabs must not break what the screen was for.

**Independent Test**: with unread activity, open Activity: the interactions are listed first and the unread count on Profile clears.

**Acceptance Scenarios**:

1. **Given** unread activity, **When** the member opens Activity, **Then** the interactions feed shows first and the unread count clears.
2. **Given** the member switches to a post tab and back, **Then** the feed is reloaded and shows anything new, and the seen boundary only ever moves forward (what the feed shows is what counts as seen; the server never moves it back).
3. **Given** the member's feed is empty, **Then** the existing "No activity yet" text shows on that tab only.

### Edge Cases

- A member who signed in a moment ago and whose id is not yet known shows a loader, never an empty list that reads as "no posts".
- A request that fails shows an empty tab after logging the problem, as the feed does today; it does not leave a loader spinning.
- Switching tabs quickly must not show one tab's posts under another tab's name.
- A post deleted or hidden elsewhere (staff, the author) disappears the next time the list reloads.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Activity screen MUST offer five choices at its top: Interactions (the existing feed) and the four post tabs Threads, Replies, Media and Reposts, with Interactions selected when the screen opens.
- **FR-002**: Choosing a post tab MUST list the signed-in member's own posts for that tab, the same posts the Profile screen listed.
- **FR-003**: The post lists MUST load more on reaching the end, refresh on pull, and reload when the screen regains focus after the member has left it.
- **FR-004**: A post tab MUST keep the actions its posts had on Profile, including deleting one's own post.
- **FR-005**: The Profile screen MUST NOT show the four tabs or the member's posts.
- **FR-006**: The Activity button on Profile MUST keep its unread count and MUST still open Activity.
- **FR-007**: Opening Activity, or returning to Interactions, MUST mark what the feed shows as seen. The boundary only ever moves forward, and opening a post tab MUST NOT change it.
- **FR-008**: The public profile of another member MUST be unchanged.
- **FR-009**: The five choices MUST have German and English labels, and the existing four keep their current words.
- **FR-010**: No server or contract change is needed or allowed: the screens call the same endpoints.

### Key Entities

- **Activity view**: which of the five choices is showing (Interactions, or one of the four post tabs).
- **Own post list**: the signed-in member's posts for one tab, a cursor-paged list of the existing post shape.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member reaches any of their own post tabs in two taps from Profile (Activity, then the tab).
- **SC-002**: The Profile screen contains no request for the member's posts (one fewer request on opening Profile).
- **SC-003**: With 60 posts in a tab, all 60 are reachable by scrolling (the previous screen reached only the first page).
- **SC-004**: The unread count clears when Activity opens, exactly as before.
- **SC-005**: No contract, server or web file changes.

## Assumptions

- "Member Threads activity" means the member's own posts shown in four tabs at the bottom of the Profile screen, which is where the app shows exactly those four names. The public profile of another member is a different screen and keeps its tabs.
- The interactions feed stays the first and default view of Activity, so nothing about how Activity opened before changes. The new first choice is called "Interactions" because that is what the feed is (likes, replies, quotes, reposts, mentions, follows); "Activity" would be the screen's own title repeated, and "Notifications" would blur it with push notifications, which are a different record.
- The four post tabs use the member's own id from the session, as other screens already do, so no extra request is needed to find it.
- The tabs sit in one row that wraps, as the four did on Profile; five labels fit on a phone in German and English.

## Addendum: the same header on every tab (added to this branch on request)

**Input**: "in the Marketplace stack in Expo application; move the buttons from the header (Messages, My listings, and New listing) to a drop down (like WhatsApp) and replace it with three dots (like WhatsApp). move all the Header title to the left side and add the gwc-logo in the middle (and make it small so it does not change the height of the header) ... Do this for all the tabs."

Today the Marketplace list's header carries three text buttons on the right (Messages, My listings, New listing) and the Threads feed's carries one (New post). On iOS every title is centred. This addendum is a separate change from the Activity move above; it is on this branch because it was asked for here. The first pass did the Marketplace stack only, with a dimmed pop-up; this one makes the pop-up a WhatsApp-style drop-down and applies the header to every tab.

### User Story 4 - The header actions are in a drop-down behind three dots (Priority: P1)

Where a screen's header had action buttons, it has one three-dots button instead. Tapping it opens a small drop-down under the dots, as WhatsApp's does; choosing a row closes it and opens that screen.

**Independent Test**: open Marketplace: the header has three dots and no text buttons; tap them, choose Messages: the drop-down closes and Messages opens. Open Threads: the same, with New post.

**Acceptance Scenarios**:

1. **Given** the Marketplace list, **Then** the header shows three dots on the right and none of the three text buttons.
2. **Given** the drop-down is open, **When** the member taps Messages, My listings or New listing, **Then** it closes and that screen opens.
3. **Given** the drop-down is open, **When** the member taps outside it or uses the system back, **Then** it closes and nothing opens.
4. **Given** a member who may not post, **Then** the Marketplace drop-down shows Messages only.
5. **Given** unread messages, **Then** the three dots carry a small dot and the Messages row carries one, so the news is not hidden by moving the button.
6. **Given** the Threads feed, **Then** its header shows three dots, and its drop-down has one row, New post, which opens the composer.
7. **Given** the drop-down is open, **Then** the page behind it is not dimmed.
8. **Given** any screen with the three dots, on iOS or on Android, **Then** the dots are a vertical column (turned 90 degrees from the first version's iOS row), as in WhatsApp.

### User Story 5 - Titles on the left, the club's emblem in the middle (Priority: P1)

Every screen shows its title on the left, the club's emblem small in the middle, and its own button (the three dots, where it has actions) on the right. The header is the same height as before.

**Independent Test**: open a screen with a short title, one with a long German title, one with no title and a back button: on each the title is at the left, the emblem is in the middle, and the header is not taller than before.

**Acceptance Scenarios**:

1. **Given** any screen, **Then** its title is at the left, after the back button if there is one.
2. **Given** any screen, **Then** the emblem is exactly in the middle of the header, whatever the title or the right-hand button is.
3. **Given** a long title (German), **Then** it is cut with an ellipsis and the emblem does not move.
4. **Given** a screen whose title arrives late (a conversation, a member's profile), **Then** the title appears when it arrives.
5. **Given** the light and the dark theme, **Then** the emblem is readable on both and the header uses the navigation theme's own colours.
6. **Given** the edge swipe or the back button, **Then** going back works as before.

### User Story 6 - Every tab has the same header (Priority: P1)

Threads, Marketplace, Offers, Events and Profile, and every screen inside each, show the same header, so the app does not change character from tab to tab.

**Independent Test**: open each of the five tabs and one screen inside it: each has its title at the left and the emblem in the middle.

**Acceptance Scenarios**:

1. **Given** any of the five tabs or a screen in one, **Then** it shows the header of US5.
2. **Given** a tab with no actions (Offers, Events, Profile), **Then** it shows no three dots.
3. **Given** the screens that open as a sheet (Threads: new post and handle; Profile: edit and handle), **Then** they show the header too, with no gap above it.
4. **Given** a screen with an empty title (an offer, an event, a store), **Then** it shows the back button and the emblem only.

### User Story 7 - A screen the drop-down opens opens like the platform's own (Priority: P2)

Choosing Messages, My listings or New listing opens that screen with the transition the phone itself uses to open a screen, which is how Settings opens: on Android a slide in from the right with a short fade, on iPhone the standard push (the new screen slides in from the right and the old one shifts a little left). Going back reverses it.

**Independent Test**: open Marketplace, tap the dots, choose each of the three rows, then go back: the screen enters from the right and leaves to the right, and looks the same as opening a screen inside the phone's Settings.

**Acceptance Scenarios**:

1. **Given** an iPhone, **When** a row is chosen, **Then** the screen opens with the standard push, and the edge swipe goes back.
2. **Given** Android 13 or later, **When** a row is chosen, **Then** the screen opens with the system's own transition: a short slide in from the right with a fade, the old screen shifting a little left (Material's shared axis, X).
3. **Given** Android 12 or earlier, **When** a row is chosen, **Then** the screen slides in from the right (the system's own transition there is a zoom, which is not the horizontal move wanted).
4. **Given** Messages, My listings, New listing and Edit listing, **Then** all four open the same way, and so does every other screen pushed in the Marketplace stack.
5. **Given** back (the header's button, the edge swipe or the hardware button), **Then** the same transition plays in reverse.

### User Story 8 - The drop-down is the platform's own menu (Priority: P1)

The three dots open the menu the phone itself uses: on iPhone SwiftUI's `Menu`, on Android a Material drop-down, both through `@expo/ui`. The app draws no pop-up of its own, so each menu looks and moves like the rest of that phone.

**Independent Test**: on an iPhone and an Android phone open Marketplace, tap the dots and choose Messages.

**Acceptance Scenarios**:

1. **Given** an iPhone, **When** the dots are tapped, **Then** the system's menu opens at the dots, with the system's look and animation, and choosing a row opens that screen.
2. **Given** an Android phone, **When** the dots are tapped, **Then** a Material drop-down opens anchored to the dots and stays on screen although they are at the right edge, and choosing a row opens that screen.
3. **Given** a row with news, **Then** on iPhone it carries a small red dot beside its label, and on Android its label ends with a dot ("Messages •").
4. **Given** the menu is open, **When** the member taps outside it (or uses the system back on Android), **Then** it closes and nothing opens.
5. **Given** a screen reader, **Then** the dots are announced as a button named "More" (and with a dot when there is news) and each row by its label.
6. **Given** the dots are tapped, **Then** they stay exactly where they are, with no shift, jump or resize while the menu opens, and the menu opens under them, not over them.
7. **Given** an iPhone, **Then** the dots are Entypo's `dots-three-vertical`, the same drawing as on Android, in the theme's tint; a tap anywhere in their 40 x 44 box, not only on the glyph, opens the menu; and the menu opens below them.

### User Story 9 - The menu opens below the whole header (Priority: P1)

> **Superseded by [feature 040](../040-menu-below-header/spec.md).** The iPhone half (an app-drawn card, FR-027) was declined: *do not change the native menu*. The requirement that the menu open below the header (FR-026) is carried into 040, with the phone's own menu kept on both phones. Nothing in this story was implemented.

The menu that the three dots open sits **below the header**, on both phones: nothing of the header (the dots, the emblem, the title, the back button) is covered while it is open. On Android it is still the platform's own Material drop-down. On iPhone it is a drop-down the app draws, because the system's menu cannot be placed (`research.md` R2); this reverses US8's "the app draws no pop-up of its own" for the iPhone only.

**Why this priority**: the first phone test of the sixth pass found the iPhone's menu opening over the dots, with the icon behind it. It is the request.

**Independent Test**: on an iPhone and an Android phone open Marketplace, tap the dots: the menu's top edge is under the header's bottom edge and the dots are still visible.

**Acceptance Scenarios**:

1. **Given** an iPhone, **When** the dots are tapped, **Then** a drop-down opens whose top edge is below the header's bottom edge (a small gap), right-aligned with the dots' side of the screen, with the header, including the dots and the emblem, fully visible above it and the page behind it not dimmed.
2. **Given** an Android phone, **When** the dots are tapped, **Then** the Material drop-down opens with its top edge at the header's bottom edge and the dots and the emblem uncovered.
3. **Given** the menu is open, **When** a row is chosen, **Then** the menu closes and that row's screen opens (on iPhone after the menu has finished closing).
4. **Given** the menu is open, **When** the member taps outside it, or on Android uses the system back (or on iPhone the hardware-equivalent close), **Then** it closes and nothing opens. A tap on the header while it is open closes it and does not also press what is under the finger.
5. **Given** a row with news, **Then** on iPhone it carries a small red dot beside its label and on Android its label ends with " •", as before.
6. **Given** a screen reader, **Then** the dots are a button called "More" (with a dot when there is news); on iPhone each row is a button with its label, the card is announced as a modal surface and the area outside it as "Close".
7. **Given** a screen shown as an iOS sheet that has this header (a modal presentation), **Then** the drop-down still starts below that header, not below the top of the window.
8. **Given** a long German row label, **Then** it wraps inside the card; the card never runs off the screen's edge.

### Additional Requirements

- **FR-011**: A screen whose header carried action buttons (the Marketplace list; the Threads feed) MUST show a three-dots button in their place, opening a drop-down with those actions; the rows that need permission to post MUST still be shown only to a member who may post (display only; the server decides).
- **FR-012**: The drop-down MUST open under the dots, MUST NOT dim the page, MUST close when a row is chosen, when the member taps outside it and on the system back, and MUST have accessible labels.
- **FR-013**: Every screen in the stacks of the five member tabs MUST show its title at the left of the header and the club's emblem in the middle, with the same bar height as the platform's own (44 on iOS, 56 on Android below the status bar).
- **FR-014**: The emblem MUST stay centred however long the title is or whatever is on the right, and MUST NOT make the header taller.
- **FR-015**: The header MUST take its colours from the navigation theme and the app theme, and MUST work in light and dark.
- **FR-016**: The emblem MUST be the club's own logo as one lockup: the mark, the golden line and "GERMAN WORLD CLUB" under it (`assets/gwc-logo-header.png`, 296 x 194, transparent background, cropped from `assets/react-logo@3x.png`, which holds the club's logo under a template file name). *(Amended 2026-11-26: it was the mark alone, cropped from `assets/gwc-logo.png`, because the lettering is small at this size; the line and the lettering are part of the logo and are now in.)*
- **FR-017**: No server, contract or web change, and no new native module (no new build).
- **FR-018**: There MUST be one header and one drop-down, shared by every tab; a tab MUST NOT carry its own copy, because a copy is how one tab comes to differ.
- **FR-019**: A tab with no header actions MUST show no three dots.
- **FR-020**: The three dots MUST be a vertical column on both platforms.
- **FR-021**: Every screen pushed in the Marketplace stack MUST open with the platform's own push transition: the system default on iOS and on Android 13 and later, and a slide in from the right on Android 12 and earlier. No screen in the stack MAY choose its own.
- **FR-022**: The drop-down MUST be the platform's own menu: SwiftUI's `Menu` on iOS and a Material drop-down on Android, both from `@expo/ui` (on Android its drop-in `MenuView`). The app MUST NOT draw a pop-up of its own for it.
- **FR-023**: A screen MUST still hand the menu its rows as data (a key, a label, where it goes, whether it has news) and the menu MUST know nothing about the screen; there is one `HeaderMenu`, with one file per platform.
- **FR-024**: The three dots MUST be static: they MUST NOT move, resize or change shape when tapped or while the menu opens, and the menu MUST open under them and MUST NOT cover them.
- **FR-025**: The dots MUST be the same Entypo `dots-three-vertical` icon on both platforms (one `MenuIcon`). *(Amended by the seventh pass: the rest of the original FR-025, on iPhone an icon laid over an invisible native `Menu` label, is withdrawn, because the system menu opened over it (FR-026, FR-027). The icon stays one drawing.)*
- **FR-026**: On both platforms the menu MUST open below the header: its top edge MUST NOT be above the header's bottom edge, and no part of the header (dots, emblem, title, back button) MAY be covered by it.
- **FR-027**: On iPhone the menu MUST be a drop-down drawn by the app, in a transparent `Modal`, positioned from the header's measured bottom edge and not from the status bar's height, because SwiftUI's `Menu` cannot be placed or opened by code (`research.md` R2). This **supersedes FR-022 for iPhone**; FR-022 still holds for Android. On Android the menu MUST remain `MenuView`'s Material drop-down, opened by `ref.show()` and anchored to a thin invisible strip along the header's bottom edge, so that the dots can stay where they are while the menu opens below the header.
- **FR-028**: The dots MUST be an ordinary pressable on both platforms (a button called "More", with a dot when a row has news). On iPhone a row's navigation MUST wait for the drop-down to finish closing before it pushes.
- **FR-029**: No new native module and no new build: nothing is added to `package.json`, and the iPhone no longer needs `@expo/ui`'s `Menu` at all.

### Success Criteria

- **SC-006**: No screen has more than one button in its header, and every action that was a button is reachable in two taps.
- **SC-007**: On every screen of the five tabs the emblem's centre is within 1 px of the header's centre.
- **SC-008**: The header's height equals the platform's own native header height, on every screen of the five tabs.
- **SC-009**: Opening Messages, My listings and New listing looks like opening a screen in the phone's own Settings: a move in from the right on both platforms.
- **SC-010**: With the menu open, the overlap between the menu and the header is 0 px on both phones, with the iPhone's card at most `Spacing.one` + the hairline below the header's bottom edge.

### Assumptions

- "A drop-down like WhatsApp" means a small menu anchored under the three dots, with the page behind left as it is; a full-screen page, a bottom sheet and a dimmed pop-up were all heavier than a few short rows need. A tap outside it closes it. Since US8 it is the platform's own menu, so the iPhone's and the Android phone's differ from each other the way their systems do, which is intended.
- The request names two Expo pages (the SwiftUI `Menu` and the drop-in `Menu`) from the latest docs, which are SDK 58; the app is on SDK 57 with `@expo/ui` 57.0.20. The installed package's source was read, and both exist there with the props used.
- `@expo/ui` has been a dependency since the app began and is already autolinked, so this adds no dependency. A development build made from an older patch of it may not have `Menu` or `RNHostView`: the symptom is a missing native view, and a rebuild is the fix. Which version is on a phone cannot be seen from here.
- *(Superseded 2026-11-26: Threads' New post is now a plain icon button, not a drop-down, because a drop-down for one row is a tap more than it needs; see `header-icon-button.tsx`.)* Threads' drop-down has one row. It is a drop-down all the same, so a second action added later has somewhere to go and every tab's header is one pattern.
- "All the tabs" is the five bottom-bar tabs: Threads, Marketplace, Offers, Events and Profile. The merchant and partner screens (`(organisation)`), onboarding, applicant and public screens are not tabs and keep their own headers.
- The titles are one size for all screens (16). This replaces the earlier, separate request to make three of the titles 20% smaller, which could not be done with the native header.
- The three dots are vertical on both platforms. "Rotate 90 degrees" is read as turning iOS's horizontal row into a column, as WhatsApp draws it, and not as an animation of the dots turning when the menu opens.
- "The rule for the opening animation" is read as the transition of the screens the menu opens (the way Settings opens from WhatsApp's menu), not of the drop-down itself, which fades in.
- Nothing is built for the transition: it is the platform's own through the stack's `animation` option, because a shared-axis transition of our own would need native code, and so a new build.
- The dots are one drawing on both platforms: Entypo's `dots-three-vertical` from `@expo/vector-icons`, in the theme's tint. (Until the sixth pass iPhone drew the system's `ellipsis` symbol turned 90 degrees, because the menu's label there must not be a React Native view hosted inside it; that is still true, and is why the iPhone's icon is laid over the menu and not put in its label. FR-025.)
- Nothing in `@expo/ui` chooses which side of its label the iPhone's menu opens on. "Open below the dots" is therefore met by making the native label exactly the dots' box, with nothing hosted inside it, so that the system, which opens a menu on the side with room (below, for a header at the top), anchors to the right place. Whether it does is for a phone to show.
- `@expo/vector-icons` is a new dependency of the app. It is JavaScript and a font file, and it loads the font through `expo-font`, which the app already has natively, so it adds no native module and needs no new build of its own.
- The first phone test of the native menu found two faults on the iPhone build the author was using: the menu opened over the dots and the dots moved when tapped. Android was not reported and its menu is unchanged; if it shows the same, that is a separate fault with its own cause (see the plan). The request after that asked for Entypo on the iPhone too and for the menu to open below the dots. What is built for it is the option the plan had named and not tried, a transparent native `Menu` under the icon; whether an invisible label takes taps on a real phone, and whether the menu then opens below it, is untested until T045.
- **T045's result** (the seventh pass's input): the invisible label took the tap and the system menu opened, but it opened **over** the dots, with the icon behind it. `@expo/ui` 57.0.20 gives no way to place that menu or to open it by code on iOS (`research.md` R2), so the iPhone's drop-down is drawn by the app (FR-027). That is a reversal of US8's premise for the iPhone, made because the placement was asked for and nothing native gives it. Android was not reported as faulty; it is changed too, as the request says both, by moving the menu's anchor and not by replacing the menu.
- The iPhone's drop-down is drawn in the system's style (rounded card, hairline, soft shadow, 17 pt rows, the theme's colours, a fade) and is **not** the system's own: it has no iOS 26 glass and the system's animation, and says so. If one look on both phones is wanted, the same card can be used on Android (`research.md` R3, option F).
- "Below the entire header" is read as: the menu's top edge is at or below the header's bottom border, with a small gap on iPhone. It is not read as a full-width sheet or a menu that pushes the page down.
- The iPhone's iOS version was not reported, so what the system menu does on other versions is not known; it no longer matters for the iPhone, which no longer uses it.
- This replaces feature 017's choice of `slide_from_right` for New listing (a slide of the whole width with no fade), which matches neither platform's rule.

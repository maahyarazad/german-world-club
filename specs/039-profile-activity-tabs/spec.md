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

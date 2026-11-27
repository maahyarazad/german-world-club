# Feature Specification: Bring the outcome of a save into view

**Feature Branch**: `041-scroll-to-form-message`

**Created**: 2026-11-27

**Status**: Implemented; the by-hand pass on the real pages (tasks.md T027) is still open

**Input**: User description: "anywhere in the Web Client that there is a Form that submit (Post or Put, or Patch API triggers) so the client waits for the response - in the Web Client the Message that appears at the top (Keep it as it is); so on every Success scroll into the Message (For example in the Market Place or Profile you hit the save but you dont know get the outcome)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A member saves and sees that it worked (Priority: P1)

A member edits their profile, or posts or edits a listing in the Marketplace, on a page long enough to scroll. They press Save at the bottom of the form (or in the drawer, which then closes). The page already shows a success message at its top ("Saved.", "Your listing is live."), but the member is looking at the bottom, so they see nothing change and cannot tell whether it worked. After this feature the page moves so the message is in front of them, and it is the same message it always was.

**Why this priority**: This is the reported defect, on the two pages the report names. A member who cannot tell a save worked presses it again, or leaves and wonders.

**Independent Test**: Open Edit profile on a window short enough that the message's place at the top is scrolled out of view, scroll down, change the bio and save. The message "Saved." is fully on screen when the save returns. Repeat with a Marketplace edit saved from the drawer: when the drawer has closed, the page's "Saved" message is on screen.

**Acceptance Scenarios**:

1. **Given** Edit profile scrolled so the top of the page is out of view, **When** a save succeeds, **Then** the success message is brought fully into view.
2. **Given** the same page with the message already fully on screen (a short page, or scrolled to the top), **When** a save succeeds, **Then** the page does not move.
3. **Given** a Marketplace listing saved or published from the drawer, **When** the save succeeds and the drawer closes, **Then** the message at the top of the Marketplace page is on screen, not left above the fold.
4. **Given** a save that succeeds twice in a row with the same message, **When** the second one returns, **Then** the message is brought into view again.
5. **Given** the page has just opened, or the data has just loaded, **When** nothing has been saved, **Then** the page does not move.

---

### User Story 2 - A merchant or a staff member saves and sees that it worked (Priority: P1)

The same happens on the merchant portal (organisation profile, store, offer editor) and in the admin console (offer categories, push notifications): each already shows a message at the top of the page, or above the send button, when a save succeeds, and each needs the same treatment so the outcome is seen from wherever the person pressed Save.

**Why this priority**: The report says "anywhere in the Web Client". These pages have the same defect for the same reason, and a person on a merchant's store page with ten photos is further from the message than anyone.

**Independent Test**: On each page in the list under Requirements, with the message out of view, make the change and save: the message is on screen when the save returns.

**Acceptance Scenarios**:

1. **Given** the store page scrolled down to the gallery, **When** adding a photo succeeds, **Then** the "Saved." message at the top is brought into view.
2. **Given** the offer categories page, **When** a second category is saved straight after the first (the message is still showing, with the same text), **Then** the message is brought into view again for the second.
3. **Given** the push notification form, **When** a message is queued, **Then** the "queued" notice is brought into view.

---

### User Story 3 - A refusal in the same place is seen too (Priority: P2)

On some of the same pages, a refusal that the person must know about (a stale edit, a taken identifier, an offer that cannot be published yet) is shown in the same slot as the success message. The report asks for success only, but a refusal that appears off screen leaves exactly the same question, "did it work?". These are brought into view the same way.

**Why this priority**: Not asked for in so many words; the same defect, one condition to include or drop. It is isolated in its own story so it can be struck out without touching the first two.

**Independent Test**: On the store page, scrolled down, cause a stale-edit refusal: the refusal message is on screen.

**Acceptance Scenarios**:

1. **Given** the store page scrolled down, **When** a save is refused as a stale edit, **Then** the refusal message is brought into view.
2. **Given** a failure the page deliberately does not show on screen (the server's other refusals are logged to the console only), **When** it happens, **Then** nothing is shown and the page does not move.

---

### Edge Cases

- A page that does not scroll at all, or a message already in view: no movement.
- A message that appears while another change happens in the same moment (the Marketplace drawer closing and focus returning to the New listing button): the message must still end up in view, not hidden by the other change.
- Two requests in a row on one page (the store page saves a cover, then a gallery photo): the latest message is the one shown, and the page does not fight itself.
- The person has asked their system for reduced motion: the page moves without animation.
- The message is removed or replaced before the move happens (the person navigates away): no error, no stray movement.
- The person pressed Save from the keyboard: their keyboard position does not change. The message is an alert that announces itself already, so moving focus onto it would take the person away from the button they were on.
- A client-side check that stops a request before it is sent (a picture too big) and shows a message in the same slot: counts as a refusal in the same place (User Story 3).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a save that the page waits for (a POST, PUT or PATCH) succeeds and the page shows its success message, the page MUST bring that message fully into view if any part of it is out of view.
- **FR-002**: When the message is already fully in view, the page MUST NOT move.
- **FR-003**: The message MUST stay as it is: the same text, tone, colours, position in the page and the same announcement to assistive technology. Only the page's scroll position changes.
- **FR-004**: Every success MUST bring the message into view, including a second success with the same text as the one still showing.
- **FR-005**: When something else on the page changes at the same moment (a drawer closing, focus returning to a button), the message MUST end up in view after those changes.
- **FR-006**: Bringing the message into view MUST NOT move keyboard focus, open or close anything, or change what is announced.
- **FR-007**: When the person has asked for reduced motion, the move MUST NOT be animated.
- **FR-008**: The page MUST NOT move on first display, on loading data, or when no new message has appeared.
- **FR-009**: This MUST apply to every page that shows a success message in this way today: Edit profile and Marketplace (member); organisation Profile, Store and Offer editor (merchant and partner); Offer categories and Push notifications (admin).
- **FR-010**: A page that adds a success message in this way later MUST NOT be able to forget this: an automated check MUST fail when it does.
- **FR-011**: A refusal shown in the same slot as the success message (a stale edit, a taken identifier, an offer that cannot be published yet, a file the page refuses before sending it) SHOULD be brought into view the same way (User Story 3).
- **FR-012**: The change MUST NOT add or change any text, add a server call, change what the server returns, or add a dependency.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On each of the seven pages in FR-009, with the message out of view, 100% of successful saves leave the whole message on screen.
- **SC-002**: With the message already in view, the scroll position is identical before and after a save in 100% of cases.
- **SC-003**: Apart from the scroll position, the page after a save is the same as before this feature: the message's text, tone and place, and the element that has keyboard focus.
- **SC-004**: A person pressing Save at the bottom of a long form sees the outcome without scrolling by hand: no step between pressing Save and reading the message.
- **SC-005**: A success message added to a page without this behaviour fails the build.

## Assumptions

- **Scope is the web client** (`client/`). The mobile app has its own forms and its own way of showing an outcome and was not asked for.
- **"The message that appears at the top" is the one each page already shows** (the page-top message block, or the notice above the send button on the push page). It stays exactly as it is; this feature only moves the page to it.
- **A form that shows no success message today is left without one.** The report says to keep the message as it is, and a new message needs new text in both languages. These confirm nothing on screen and update a list or table in place: staff moderation (hide, restore, remove, resolve), applicant decisions, influencer grants, referral reversals and rate changes, the store on/off switch, and the member's **handle change** on Edit profile. The handle change is the one most likely to be wanted: it saves from a dialog, closes it and shows no "Saved." although the same page shows one for every other save. It is listed here as a separate decision (reusing the existing "Saved." string is one line) and not done here.
- **In-place confirmations are already in view and are not included**: the "request sent" line that replaces the button the member just pressed on a listing, the "report sent" note under a post, the "code sent again" note in sign-up, and the password-reset success that replaces its own form. Each sits where the person just acted, so there is nothing to bring into view.
- The page is the whole document: the console scrolls the window, not an inner panel, and has no bar fixed over the top of the content.
- People who prefer reduced motion are served by the browser's own setting, read at the moment of the move.

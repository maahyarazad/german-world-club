# Feature Specification: One loader for the web console and the app

**Feature Branch**: `030-main-loader` (not yet created; branch from `main`)

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "create a main loader component for both web-application and expo RN from the main-loader.html (adjust the theme color and sizing) - add to every page in the konsole that has a fetch request from API (different size) and add it to login or any button that also has a fetch or API request so the user needs to wait for that request"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A page that is loading says so (Priority: P1)

Opening any page in the web console or in the app that has to fetch data first shows the club's loader, centred where the content will appear, until the data has arrived. Today many of these pages show nothing at all, or a line of text, while they wait, which reads as "broken". The loader is the same shape in both places, in the club's navy, sized to its surroundings (large for a whole page, smaller for a card or a list that loads more).

**Why this priority**: It is on every screen the user opens, and a blank screen is the most common reason to doubt that something is working.

**Independent Test**: Open each page while its data request is held open: the loader is shown; release it: the content replaces the loader.

**Acceptance Scenarios**:

1. **Given** a console page that needs data, **When** it opens, **Then** a loader is visible until the data has arrived and no blank page is shown in between.
2. **Given** the data fails to load, **Then** the loader is replaced by the page's existing failure state (not left spinning).
3. **Given** the data arrives within a fraction of a second, **Then** no loader flashes on and off.
4. **Given** a screen in the app that needs data, **Then** the same applies with the app's loader.
5. **Given** a list that loads more or reloads in place, **Then** a smaller loader is shown at that spot and the content already on screen stays.

---

### User Story 2 - A button that waits for the server shows it (Priority: P1)

Every button that sends a request (sign in, send a code, save, post, approve, terminate a session, and so on) shows the loader inside itself while the request runs, and cannot be pressed again until it finishes. The user sees that something is happening and cannot double-submit.

**Why this priority**: It is the second thing asked for, and it prevents duplicate submissions (two posts, two codes, two registrations).

**Independent Test**: Press each such button with its request held open: the loader appears, a second press does nothing, and when the request ends the button returns to normal.

**Acceptance Scenarios**:

1. **Given** the sign-in form, **When** the member presses "Sign in", **Then** the button shows the loader and is disabled until the answer arrives.
2. **Given** a button that is waiting, **When** it is pressed again, **Then** no second request is sent.
3. **Given** the request fails, **Then** the button returns to normal and the page's usual failure handling applies.
4. **Given** a button with no request behind it (opening a dialog, going back), **Then** it never shows a loader.

---

### User Story 3 - It is accessible and respects the user's settings (Priority: P2)

A person using a screen reader hears that content is loading and when it has finished. A person who has asked their device for reduced motion sees a still indicator rather than a spinning one. The loader keeps readable contrast in light and dark colour schemes.

**Why this priority**: Required for the loader to be correct, but not what the user asked for first.

**Independent Test**: Turn on a screen reader and reduced motion; load a page and press a button.

**Acceptance Scenarios**:

1. **Given** a page is loading, **Then** assistive technology is told it is busy and, once loaded, that it is done.
2. **Given** reduced motion is on, **Then** the loader does not rotate.
3. **Given** the dark colour scheme in the app, **Then** the loader stays visible against the background.

---

### Edge Cases

- A page that loads several things at once: one loader until the page is usable, not one per request.
- A page that reloads after an action (for example a list after a save): the content stays and a small loader marks the reload; the page does not go blank.
- A very slow or failed network: the loader is replaced by the existing failure state; it never spins forever.
- A button inside a dialog or a card: the loader is sized to the button, and the button does not change width while it waits.
- A page restored from history or opened by a direct link: behaves like a fresh open.
- Uploads that already show a percentage bar keep it; the loader does not replace real progress.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide one loader, in the web console and in the app, with the same shape and animation, drawn from the supplied `main-loader.html` design (a faint full ring with a rotating arc).
- **FR-002**: The loader MUST use the club's colours (navy in the light scheme, the lighter tint in the app's dark scheme) instead of the supplied blue, and MUST inherit the colour of the text it sits in when used inside a button.
- **FR-003**: The loader MUST come in at least four sizes: small (inside buttons), medium (cards and in-place reloads), large (a whole page or screen), with the page size larger than the card size.
- **FR-004**: Every web console page and app screen that fetches data to render MUST show the loader, centred in the content area, from when it opens until the data has arrived or has failed.
- **FR-005**: A loader shown for a page MUST NOT appear for fast responses; a short grace period applies so a response that arrives almost at once shows no flicker.
- **FR-006**: Every button that triggers a request MUST show the loader inside it, be disabled, and ignore further presses until the request ends, on the web (sign-in, password reset, registration steps, save/post/approve/terminate buttons, dialogs) and in the app (sign-in, codes, register, compose, save, and the rest).
- **FR-007**: A button's size MUST NOT change while it waits.
- **FR-008**: A button with no request behind it MUST NOT show the loader.
- **FR-009**: The loader MUST be announced to assistive technology as busy, with a translated label in German and English, and MUST NOT rotate when the user has asked for reduced motion.
- **FR-010**: When a request ends in failure the loader MUST be removed and the page's existing failure handling MUST apply unchanged; the loader changes nothing about how errors are reported.
- **FR-011**: The app MUST NOT need a new native build to ship this.
- **FR-012**: All text MUST be available in German and English.

### Key Entities

- **Loader**: the animated ring, with a size and an accessible label.
- **Page loader**: the loader centred in a page's content area, shown while the page's data is loading.
- **Busy button**: a button that is showing the loader and ignoring presses.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of console pages and app screens that fetch data show a loader while loading (no page is blank while its request is open).
- **SC-002**: 100% of buttons that send a request show the loader and send at most one request per press while waiting (0 duplicate submissions in a double-press test).
- **SC-003**: A response that arrives within 150 ms shows no loader.
- **SC-004**: A button's width and height are identical before, during and after waiting.
- **SC-005**: With reduced motion on, nothing on any screen rotates; with a screen reader on, every wait is announced once.
- **SC-006**: The loader meets the contrast needed to be seen against every background it is placed on, in both colour schemes.

## Assumptions

- "Every page in the konsole that has a fetch" means the web console routes under `/konsole` (member, staff, organisation and onboarding areas) and, for the app, the member, organisation, applicant, profiling and public screens that call the API.
- The supplied `main-loader.html` is an SVG spinner; its blue is replaced by the club navy and its size is set by the caller.
- Existing text such as "Loading …" is replaced by the loader plus an accessible label; the wording stays available to screen readers.
- The grace period before a page loader appears is 150 ms; a button shows its loader at once.
- The public landing page and other pages with no data request are not changed.

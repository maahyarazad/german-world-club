# Feature Specification: Full-width dashboard layout for the web console

**Feature Branch**: `019-console-full-width-dashboard`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "in web application - in desktop view change the UI from landing page to dashbaord and allow the UI to use the entire width view port"

> **Scope, confirmed 2026-11-12:** this changes the layout of the signed-in web console
> (`/konsole/*`) on desktop. Every page keeps its content. What changes is how the content is
> arranged: on desktop it fills the screen as a dashboard instead of sitting in a narrow column
> in the middle. The public site at `/`, the sign-in and registration cards, and the mobile app
> are out of scope. No new dashboard home page is added.

## Clarifications

### Session 2026-11-12

- Q: What does "from landing page to dashboard" mean? → A: **A full-width dashboard layout.**
  Remove the 1600 px cap on the console frame, and replace the narrow centred column many member
  pages use with multi-column layouts across the whole viewport on desktop. Content stays the
  same and mobile stays the same.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — The console uses the whole screen (Priority: P1)

A member or staff member opens the web console on a desktop or a wide monitor. The sidebar, the
top bar and the page area stretch to the edges of the window. There's no empty band on either
side, whatever the screen width.

**Why this priority**: it's the literal request. Every other story builds on this frame.

**Independent test**: open any console page in a 2560 px wide window. The top bar touches the
right edge, the sidebar touches the left edge, and the page content starts right after the
sidebar.

**Acceptance Scenarios**:

1. **Given** a desktop window wider than 1600 px, **When** any console page opens, **Then** the
   frame (sidebar, top bar, page area) fills the full width of the window.
2. **Given** a phone-sized window, **When** any console page opens, **Then** it looks and behaves
   exactly as it does today.

---

### User Story 2 — Member pages read as a dashboard on desktop (Priority: P1)

On desktop, the member pages that are a narrow column today (Threads, a single post with its
quotes and likes, Activity, my profile, another member's profile, an organisation's profile,
editing my profile, Privacy) lay their existing content out across the width:
- lists of cards (posts, activity entries, people, listings) flow into several columns;
- a profile's header and details sit in a side panel next to its content;
- a form arranges its fields in columns.

**Why this priority**: these pages are where the "landing page" look comes from. Removing only
the outer frame cap would leave them as a thin strip in a wider frame.

**Independent test**: on a 1440 px wide window, open Threads. Posts appear in at least two
columns. Open My profile: the profile card sits beside the posts.

**Acceptance Scenarios**:

1. **Given** a desktop window, **When** Threads, Activity or a profile's posts are shown,
   **Then** the cards fill the page area in two or more columns. The number of columns grows on
   wider screens.
2. **Given** a profile page on desktop, **When** it opens, **Then** the profile header and
   details sit in a side panel that stays in view while the person scrolls the posts.
3. **Given** any of these pages, **When** a keyboard or screen-reader user moves through them,
   **Then** the reading order matches the order the content had before the change.
4. **Given** a long post, **When** it's shown in a wide column, **Then** its text lines stay
   comfortably short to read (no line runs across the whole screen).

---

### User Story 3 — Lists and summaries scale with the screen (Priority: P2)

On desktop the Marketplace listing list becomes a grid of cards that fills the width. The
summary tiles at the top of a dashboard page (the admin dashboard's KPI row) fit as many tiles
per row as the width allows.

**Why this priority**: these pages already use the full width of the old frame, so they only look
sparse once the frame is wider.

**Independent test**: on a 1920 px window, open the member Marketplace. Listings show in three or
more columns. Open the admin dashboard: all KPI tiles sit in one row.

**Acceptance Scenarios**:

1. **Given** a desktop window, **When** the Marketplace shows listings, **Then** they appear in a
   grid whose number of columns grows with the window.
2. **Given** a row of summary tiles, **When** the window is wide, **Then** the tiles share one row
   instead of wrapping into rows of four.

---

### Edge Cases

- **Exactly at the desktop breakpoint (1024 px)**: the side panel and multi-column lists apply,
  and nothing overflows horizontally.
- **Very wide screens (3440 px)**: lists gain columns rather than stretching cards into wide,
  short shapes. Each card has a sensible maximum width.
- **A list with one item**: it sits at the start of the grid. It isn't stretched across the full
  width or centred like a landing page.
- **Empty states and "no access" messages**: these stay a short centred message. A sentence
  doesn't need the full screen.
- **Drawers and dialogs** (Marketplace compose, Composer, confirmations): unchanged. They're
  overlays, not page layout.
- **Sign-in, password reset, registration and onboarding**: stay as centred cards. They're forms
  before someone is inside the console, not the console itself.
- **Zoomed browsers (200%)**: the layout falls back to the single column it uses at smaller widths.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The console frame MUST fill the full width of the browser window at every desktop
  width, with no maximum-width cap and no side bands.
- **FR-002**: Below the desktop breakpoint (1024 px), every console page MUST keep today's
  layout.
- **FR-003**: No console page MUST be laid out as a single narrow centred column on desktop. Each
  page MUST use the width available beside the sidebar.
- **FR-004**: Lists of cards (posts, activity entries, people, listings) MUST flow into multiple
  columns on desktop. The number of columns MUST grow with the window width, and each card MUST
  have a maximum readable width.
- **FR-005**: Profile pages (my profile, another member's, an organisation's) MUST show the
  profile header and details in a side panel next to the main content on desktop. The panel MUST
  stay visible while the main content scrolls.
- **FR-006**: Forms on console pages (edit profile) MUST arrange their fields in columns on
  desktop rather than stretching single inputs across the screen.
- **FR-007**: Running text (post bodies, descriptions) MUST stay within a readable line length
  wherever it appears.
- **FR-008**: The order of content for keyboard and screen-reader users MUST be unchanged on every
  page.
- **FR-009**: Summary tile rows MUST fit as many tiles per row as the width allows.
- **FR-010**: Nothing in the console MUST cause horizontal scrolling of the page at any width
  from 320 px up.
- **FR-011**: Sign-in, password reset, registration, onboarding, empty states, drawers and
  dialogs MUST keep their current layout.
- **FR-012**: Every page MUST look the same in German and English. Longer German labels MUST wrap
  rather than overflow.

### Key Entities

None. This is a layout change with no data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At 1440 px, 1920 px and 2560 px window widths, the console frame spans 100% of the
  window on every console page.
- **SC-002**: At 1440 px width, the console content area beside the sidebar is used to at least
  90% of its width on every member page that was a narrow column before.
- **SC-003**: At 1920 px width, the Threads feed and Marketplace show at least three cards per
  row.
- **SC-004**: At 320 px, 768 px and 1024 px widths, no console page scrolls horizontally.
- **SC-005**: Below 1024 px, every console page is visually the same as before the change.
- **SC-006**: Post text never exceeds about 75 characters per line at any width.

## Assumptions

- **"Desktop" means 1024 px and wider**, the breakpoint where the console already shows its
  sidebar beside the content.
- **Content and behaviour don't change.** No page gains, loses or reorders information, and no
  server or API change is involved.
- **The mobile app is out of scope.** So are the public site at `/` and the server-rendered
  public pages.
- **Feature 018's two pages (Refer & earn and the staff referrals page) aren't on `main` yet.**
  They get the same treatment when 018 merges. The task list says how.
- **No new dashboard home page.** Members still land on Marketplace, and staff on the existing
  admin dashboard.

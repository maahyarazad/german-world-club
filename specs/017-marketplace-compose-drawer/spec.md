# Feature Specification: Marketplace "New listing" panel, web and mobile

**Feature Branch**: `017-marketplace-compose-drawer`
**Created**: 2026-10-09
**Status**: Draft
**Input**: "In the Marketplace.tsx in the web application move New listing to a slide menu
which is open from right to left and create a button on top right for new listing and also
implement this in the mobile application as well"

> Written alongside `/speckit-plan` because no spec existed for this request.
>
> **Scope decision (2026-10-09, asked and answered):** the mobile app has no marketplace
> screen today, only a read-only listing page reached from Activity. "Implement this in the
> mobile application as well" was therefore confirmed to mean the **full mobile marketplace**:
> a Marketplace tab with browsing and filters, and the same top-right "New listing" button
> and right-hand panel. That also delivers feature 008's unbuilt User Story 6
> (`specs/008-marketplace/spec.md`).

## User Scenarios & Testing

### User Story 1 — Browse first, compose on demand (web) (P1)

A member opens the web Marketplace and sees the listings straight away. The long compose
form no longer sits above them. A member who may post sees a **New listing** button at the
top right of the page header. Pressing it slides a panel in from the right edge, over the
page, holding the full compose form.

**Why this priority**: the compose form is the tallest thing on the page and pushes the
listings below the fold for every poster on every visit. This is the request as given.

**Independent test**: sign in on the web as a member with `marketplace_post`, open
Marketplace, and confirm the listings are visible without scrolling past a form. Then press
New listing, publish, and see the new listing in the list.

**Acceptance**:

1. **Given** a member with `marketplace_post`, **When** Marketplace opens, **Then** the page
   shows the header, the filters and the listings, plus a **New listing** button at the top
   right of the header. No compose form is shown.
2. **Given** a member **without** `marketplace_post`, **When** Marketplace opens, **Then**
   there is no New listing button at all. It is absent, not disabled, as the compose form is
   today.
3. **When** New listing is pressed, **Then** a panel slides in from the right edge with the
   compose form, the page behind is dimmed and inert, and focus moves into the panel.
4. **When** the panel is closed (close button, Escape, or a click on the dimmed page),
   **Then** it slides out to the right and focus returns to the New listing button.
5. **Given** a half-filled form, **When** the panel is closed and reopened without leaving
   the page, **Then** what was typed (and any photos chosen) is still there.
6. **Given** a successful publish with all media attached, **Then** the panel closes, the
   page confirms "Listing published", the form is cleared, and the list refreshes.
7. **Given** a publish where the listing was created but some media failed, **Then** the
   panel stays open showing which files failed and the retry action, exactly as today.
8. **Given** a narrow window (phone width), **Then** the panel covers the full width and the
   page does not scroll horizontally.

### User Story 2 — The marketplace on mobile (P1)

A member opens the app and finds **Marketplace** in the tab bar. They browse the same
listings they would see on the web, filter by category and mode, pull to refresh, and open a
listing to read it.

**Why this priority**: the New listing button needs a screen to sit on, and 008 already
promised this story. Browsing is what every member does. Posting is for the minority with
the flag.

**Independent test**: sign in on the app and on the web as the same member, apply the same
filters on both, and confirm the same listings appear in the same order.

**Acceptance**:

1. **Given** an approved, profiled member, **Then** the tab bar shows Marketplace.
2. **Given** the same member and filters on both faces, **Then** the results are identical.
3. **When** a listing is tapped, **Then** its detail opens: photos, price where the category
   has one, description and the poster's display name, read-only.
4. **Given** more listings than one page, **When** the member scrolls to the end, **Then**
   the next page loads.

### User Story 3 — New listing on mobile (P2)

A member with `marketplace_post` sees **New listing** at the top right of the Marketplace
screen. Tapping it slides the compose panel in from the right. They choose a category and
mode, fill in the title, description and the category's own fields, add photos with
descriptions, choose a contact method and an optional expiry date, accept the terms if
needed, and publish.

**Why this priority**: it completes the mobile parity, but a member who cannot post on
mobile can still post on the web, so browsing ships value first.

**Independent test**: post from the app as a flagged member, and see the listing on both
faces. Then revoke the flag, return to the Marketplace screen, and confirm the button is
gone. Calling the API directly confirms the server refuses the post.

**Acceptance**:

1. **Given** a member without `marketplace_post`, **Then** no New listing button is shown.
   If one were sent anyway, the server refuses exactly as on the web.
2. **When** New listing is tapped, **Then** the compose panel slides in from the right on both
   iOS and Android. Back (gesture, hardware back, or the header's close) slides it out.
3. The form offers the same fields, rules and media limits as the web form, for the same
   category, because both read the category definitions from the server.
4. **Given** a successful publish, **Then** the panel closes and the Marketplace list shows
   the new listing.
5. **Given** a photo without a description, **Then** publishing is refused locally with the
   same message as the web, before anything is sent.

### Edge cases

- The flag is revoked while the panel is open: the server refuses the publish. The refusal is
  logged to the console (project rule), the panel stays open, and the button is gone after
  the next visit to the screen.
- The categories or terms fail to load: the form says it could not be loaded and Publish
  stays disabled. This behaviour exists on the web today and is kept on both faces.
- Leaving the mobile panel with unsaved input discards it. The mobile panel is a screen, not
  an overlay, and keeping a draft across navigation is out of scope.
- Reduced motion: the panel appears without the slide animation where the device or browser
  asks for reduced motion.

## Requirements

### Functional requirements

- **FR-001**: The web Marketplace MUST NOT render the compose form inline. It MUST open in a
  panel that enters from the right edge.
- **FR-002**: A **New listing** button MUST sit at the top right of the Marketplace header
  on both faces, shown only when the member's capabilities include `marketplace_post`.
- **FR-003**: The web panel MUST be modal: the page behind is inert, focus is contained in
  the panel, and Escape, a close button and a click outside all close it, returning focus to
  the button.
- **FR-004**: The web panel MUST keep its form state while closed, for as long as the page
  is open.
- **FR-005**: Every existing compose behaviour (category fields, vehicle features, media
  upload/order/cover/retry, terms acceptance, expiry, publish rules) MUST be unchanged on the
  web.
- **FR-006**: The mobile app MUST add a Marketplace tab with browse, category and mode
  filters, paging, pull-to-refresh and a read-only listing detail.
- **FR-007**: The mobile compose form MUST derive its category fields from the server's
  category definitions and import every shape and limit from the shared contracts package,
  never redeclaring them.
- **FR-008**: Whether a member may post MUST remain the server's decision. Both faces use the
  capability snapshot only to decide what to show.
- **FR-009**: Every new interface string MUST exist in both German and English.
- **FR-010**: The panel MUST honour reduced-motion preferences.

### Key entities

None new. Listings, categories, terms and media are feature 008's, unchanged.

## Success criteria

- **SC-001**: For a member with `marketplace_post` on the web, the first listing is visible
  in the initial viewport at 1280×800, where today it sits below the compose form.
- **SC-002**: A member can open the panel, publish a listing with one photo and see it in the
  list on either face, without leaving the Marketplace screen.
- **SC-003**: The same member and filters return identical listings on web and mobile.
- **SC-004**: No server change is needed. The feature ships as client changes plus one shared
  constant moved into the contracts package.

## Assumptions

- "Slide menu which is open from right to left" means a panel anchored to the right edge
  that slides leftwards into view, not a right-to-left text direction. Both supported
  languages are left-to-right.
- On a phone, the panel takes the full screen width. A partial-width drawer leaves too little
  room for a form on a phone.
- Contacting a seller from mobile is out of scope: in-app messaging is not in the app yet.
  The mobile listing detail stays read-only, like today's.
- Editing, withdrawing and "my listings" management are out of scope on both faces.

# Feature Specification: Signed-in visitors see their avatar on the landing page

**Feature Branch**: `022-landing-signed-in-avatar`
**Created**: 2026-11-13
**Status**: Draft
**Input**: User description: "if the user is logged in in the landing page show the user profile Avatar instead of login `<a class="btn btn-primary" href="/konsole/anmelden">Anmelden</a>`"

## Clarifications

### Session 2026-11-13

- Q: How does the landing page know a visitor is signed in? → A: The server renders it. The page
  stays free of JavaScript. A signed-in answer is never stored by a shared cache, and anonymous
  visitors keep today's cached page.
- Q: Branch? → A: Its own feature. Feature 021 was merged (PR #18) before this was planned.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A signed-in member sees their avatar, not "Anmelden" (Priority: P1)

A member who is signed in to the console opens the landing page (`/` or `/en`). The top-right
corner shows their profile picture instead of the "Anmelden" button. Clicking it takes them
straight into their console. The "Zugang zur GWC-Konsole" section further down offers "Zur
Konsole" instead of "Anmelden" and "Passwort vergessen?".

**Why this priority**: it's the feature. Asking someone who is already signed in to sign in
reads as if their session was lost.

**Independent Test**: sign in to the console as a member with a profile picture, then open `/`.
The masthead shows the picture, links to the console, and there is no "Anmelden" link anywhere
on the page.

**Acceptance Scenarios**:

1. **Given** a signed-in member with a profile picture, **When** they open `/`, **Then** the
   masthead shows their picture with their name as its text alternative, linking to `/konsole`.
2. **Given** a signed-in member with no picture, **When** they open `/`, **Then** the masthead
   shows their initials in a circle, linking to `/konsole`.
3. **Given** a signed-in member, **When** they open `/en`, **Then** the same appears, with
   English labels.
4. **Given** a signed-in member, **When** they reach the sign-in section, **Then** it offers
   "Zur Konsole" / "Go to the console" instead of the sign-in and password links.
5. **Given** an anonymous visitor, **When** they open `/` or `/en`, **Then** the page is exactly
   as today, byte for byte.

---

### User Story 2 - Staff, merchant and partner users too (Priority: P2)

Everyone who signs in to the console uses the same sign-in button, so staff, merchant users and
partner users who are signed in also see themselves instead of "Anmelden": their initials (they
have no profile picture), linking to `/konsole`, which takes each role to its own area.

**Why this priority**: the button is shared by every role. Members are the large majority.

**Independent Test**: signed in as staff, `/` shows the staff member's initials, and the link
leads to the staff console.

**Acceptance Scenarios**:

1. **Given** a signed-in staff member, merchant user or partner user, **When** they open `/`,
   **Then** the masthead shows their initials and links to `/konsole`.

---

### User Story 3 - Nobody else ever sees a signed-in page (Priority: P1)

A signed-in page carries a person's name and picture. It must never be cached for, or shown to,
anyone else, and a session that has ended must not show as signed in.

**Why this priority**: a privacy failure here would show one member's name and picture to
strangers.

**Independent Test**: the signed-in response says it must not be stored. A signed-out, revoked
or expired session gets the anonymous page.

**Acceptance Scenarios**:

1. **Given** a signed-in visitor, **When** the page is served, **Then** the response forbids
   storing it anywhere (`private, no-store`).
2. **Given** a session that was signed out or revoked, or an expired or forged cookie, **When**
   the visitor opens `/`, **Then** they get the anonymous page, with no error.
3. **Given** a member whose account is locked, inactive or ended, or an applicant still in
   onboarding, **When** they open `/`, **Then** they get the anonymous page.
4. **Given** a display name containing HTML, **When** it is shown, **Then** it appears as text
   and is never interpreted.

### Edge Cases

- **The access cookie expired but the session is alive**: about 10 minutes after the console
  was last used, the landing page shows "Anmelden" again. Signing in, or opening the console,
  refreshes it. This is accepted with the server-rendered approach: the refresh cookie is never
  sent to `/`.
- **Search engines and preview bots** are anonymous, so what they see, the canonical URL and
  the hreflang pair are unchanged.
- **A shared cache that already holds the anonymous page** may serve it to a signed-in visitor,
  who then sees "Anmelden". That's harmless, and the reverse can't happen.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On `/` and `/en`, a visitor with a valid console session MUST see, in the
  masthead, their profile picture (members who have one) or their initials, as a link to
  `/konsole`, in place of the sign-in button.
- **FR-002**: The sign-in section MUST offer a single "Zur Konsole" / "Go to the console" link
  instead of the sign-in and password links when signed in.
- **FR-003**: "Signed in" MUST mean: a valid, unexpired access token whose session is not
  revoked, for an account that may use the console (a member who is active and whose onboarding
  is complete, or active staff, merchant or partner users). Anything else MUST be treated as
  anonymous and MUST NOT produce an error.
- **FR-004**: A signed-in response MUST be marked `private, no-store`. The anonymous response
  MUST stay exactly as today, including its caching.
- **FR-005**: Names MUST be escaped. The page MUST still run no JavaScript.
- **FR-006**: The link's accessible name MUST say where it goes and whose account it is (for
  example "Zur Konsole – Arian Geissler").
- **FR-007**: Both language pages MUST behave the same, with their own labels.

### Key Entities

- **Viewer**: who the landing page is rendered for. Their display name, initials, and their
  avatar picture if they are a member who has one. It's derived per request and never stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of signed-in visitors (valid session) see themselves, not "Anmelden", on `/`
  and `/en`.
- **SC-002**: 0 signed-in responses are cacheable by a shared cache.
- **SC-003**: The anonymous landing page is unchanged: same bytes, same headers.
- **SC-004**: An expired, forged or revoked session never produces an error page. It shows the
  anonymous page.

## Assumptions

- "User" means anyone who signs in through this button: members, staff, merchant users and
  partner users (the button's section says so).
- Only members have profile pictures, so other roles get initials.
- The access cookie lives about 10 minutes. The edge case above is accepted, as chosen.

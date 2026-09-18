# Feature Specification: Experts Circle Coming-Soon Experience

**Feature Branch**: `001-coming-soon-revamp`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "this web site is static, make it more appealing using other under development pages in real world and update the client"

## Context

`expertscircle.german-emirates-club.com` currently serves a three-band placeholder page (a direct React port of a legacy static HTML file). It shows only the bare domain name on three stacked background images, does not scroll, does not adapt to mobile, and communicates nothing about what the Experts Circle is or when it launches. Visitors who arrive — prospective members, partners, and press — leave with no information and no way to stay in touch.

This feature replaces that placeholder with a polished, responsive, single-page coming-soon experience that follows the conventions proven by real-world pre-launch pages: a strong branded hero, a plain statement of what is coming, a live countdown to launch, credibility/context about the organisation, and clear contact and social routes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitor understands what is coming (Priority: P1)

A prospective member hears about the Experts Circle, types the domain into their browser, and lands on the page. Within a few seconds they can tell whose site this is, what the Experts Circle will offer, and that it has not launched yet. They leave informed rather than confused.

**Why this priority**: This is the entire purpose of a pre-launch page and the single largest failing of the current placeholder. Delivered alone, it already replaces the existing page with something materially better.

**Independent Test**: Load the page on a desktop browser with no prior knowledge of the brand and confirm the organisation name, the value proposition, and the pre-launch status are all legible without scrolling.

**Acceptance Scenarios**:

1. **Given** a first-time visitor on a desktop browser, **When** the page finishes loading, **Then** the brand name, a one-line value proposition, and an explicit "coming soon" status are visible in the first viewport without scrolling.
2. **Given** a visitor who scrolls past the hero, **When** they reach the content sections, **Then** they can read what the Experts Circle offers and who it is for.
3. **Given** a visitor on any supported viewport, **When** the page renders, **Then** no text is clipped, overlapped, or horizontally scrollable.

---

### User Story 2 - Visitor sees the launch timing (Priority: P2)

A visitor who is interested wants to know when the site goes live. A countdown to the launch date shows them how long is left, creating a concrete expectation and a reason to return.

**Why this priority**: Launch timing is the highest-value addition after the core message, and it is the element most consistently present on effective real-world coming-soon pages. It depends on the hero existing but nothing else.

**Independent Test**: Load the page and confirm a countdown renders against the configured launch date, decrements in real time, and degrades sensibly once that date has passed.

**Acceptance Scenarios**:

1. **Given** a launch date in the future, **When** the page is open, **Then** a countdown shows remaining days, hours, minutes, and seconds and updates at least once per second.
2. **Given** the launch date has already passed, **When** the page loads, **Then** the countdown is replaced by a launch message rather than showing negative or zero-padded garbage values.
3. **Given** a visitor using a screen reader, **When** the countdown updates, **Then** the updates do not spam the accessibility tree with per-second announcements.

---

### User Story 3 - Visitor can make contact and follow the brand (Priority: P3)

A partner, journalist, or prospective member wants to reach the organisation or follow it before launch. The page gives them a working email route and links to the club's established channels.

**Why this priority**: Valuable for capturing genuine interest, but the page is already useful without it, so it lands last.

**Independent Test**: Load the page, follow each contact and social affordance, and confirm each one resolves to the correct destination.

**Acceptance Scenarios**:

1. **Given** a visitor at the foot of the page, **When** they activate the contact affordance, **Then** their mail client opens addressed to the published club address.
2. **Given** a visitor at the foot of the page, **When** they activate a social link, **Then** the corresponding channel opens in a new tab without leaking referrer credentials.
3. **Given** a keyboard-only visitor, **When** they tab through the page, **Then** every interactive element is reachable and shows a visible focus indicator.

---

### Edge Cases

- **Launch date passed**: the countdown must switch to a static launch message rather than counting negative time.
- **Reduced motion**: visitors who have requested reduced motion must get a static, non-animated presentation of the same content.
- **Slow or failed image loads**: background and hero imagery must never leave text unreadable; readable colour must be guaranteed independently of whether decorative images load.
- **Very small viewports (320 px)**: all content must remain readable and reachable with no horizontal scrolling.
- **Very large viewports (2560 px+)**: content must stay within a comfortable measure rather than stretching edge to edge.
- **JavaScript disabled**: the page is a client-rendered application; a visitor without JavaScript sees nothing. The page must at minimum ship a meaningful document title and meta description so link previews and search results remain informative.
- **Social link not yet available**: any channel the club does not actually operate must be omitted rather than rendered as a dead link.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The page MUST present the Experts Circle brand identity — name, mark, and tagline — within the first viewport on every supported screen size.
- **FR-002**: The page MUST state in plain language what the Experts Circle offers and who it is intended for.
- **FR-003**: The page MUST communicate explicitly that the site is pre-launch.
- **FR-004**: The page MUST display a live countdown to a configured launch date, updating at least once per second.
- **FR-005**: The countdown MUST degrade to a launch message when the configured date is in the past.
- **FR-006**: The launch date MUST be configurable in one place without editing component markup.
- **FR-007**: The page MUST be organised into distinct, scannable sections rather than a single undifferentiated band.
- **FR-008**: The page MUST be responsive across mobile, tablet, and desktop viewports with no horizontal overflow at any width from 320 px upward.
- **FR-009**: The page MUST provide a contact route to the club's published email address.
- **FR-010**: The page MUST link to the club's social channels, opening them in a new tab with safe rel attributes, and MUST omit any channel that does not exist.
- **FR-011**: All interactive elements MUST be keyboard reachable with a visible focus indicator.
- **FR-012**: Text MUST meet WCAG 2.1 AA contrast against its actual rendered background.
- **FR-013**: The page MUST honour the visitor's reduced-motion preference by suppressing non-essential animation.
- **FR-014**: The document MUST carry a descriptive title, meta description, and social preview metadata.
- **FR-015**: The page MUST preserve the established brand palette of the German Emirates Club rather than introducing an unrelated colour identity.
- **FR-016**: The page MUST NOT collect, transmit, or store any visitor data.

### Key Entities

- **Launch Configuration**: the single source of truth for launch timing and brand-level constants — launch date/time, brand name, tagline, contact address, social channel list. Read by the countdown and the content sections.
- **Content Section**: a titled block of the page (hero, offering, countdown, about, contact). Has an identifier, a heading, body content, and an order.
- **Social Channel**: a named external destination — label, URL, icon reference. Zero or more belong to the Launch Configuration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor can state the organisation's name, what it offers, and that it has not launched, after ten seconds on the page.
- **SC-002**: The page renders without horizontal scrolling or clipped content at every width from 320 px to 2560 px.
- **SC-003**: The page scores at least 95 on Lighthouse Performance, Accessibility, Best Practices, and SEO in a production build.
- **SC-004**: Largest Contentful Paint is under 2.0 s on a simulated 4G connection.
- **SC-005**: Zero automated accessibility violations at WCAG 2.1 AA.
- **SC-006**: The countdown shows the correct remaining time against the configured launch date and switches to the launch message once it passes.
- **SC-007**: The production bundle stays under 150 KB gzipped.
- **SC-008**: Every interactive element is operable by keyboard alone.

## Assumptions

- The site remains a purely presentational, client-side rendered single page; no backend, database, or server-side rendering is introduced.
- No visitor data is captured — email/newsletter signup is explicitly out of scope for this iteration (confirmed with the requester).
- The page is a single scrolling document; no client-side routing or additional routes are introduced.
- The existing brand palette derived from the current stylesheet — deep maroon `#750A04` and accent red `#AE2835` — is the authoritative brand identity and is carried forward.
- Copy for the value proposition and "about" sections is drafted as placeholder text during implementation and is expected to be reviewed and replaced by the club before public launch.
- The launch date is a configured value; the actual date is supplied by the club and can be changed without a code change to component markup.
- The club's real social channel URLs and contact address are supplied by the club; any not supplied are omitted rather than invented.
- Modern evergreen browsers are the support target; legacy browsers such as Internet Explorer are out of scope.
- The existing `sample-html.html` legacy file is reference material only and is not part of the deployed application.

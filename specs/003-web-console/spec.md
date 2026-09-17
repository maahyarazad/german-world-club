# Feature Specification: GWC Web Console

**Feature Branch**: `003-web-console`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "use the German_World_Club_Digital_Plattform.docx to get the color pallete and fonts and design schema, and build the web application that serves all the rbac users and allow the to use the functions, but keep the registratio process out since it is not finished"

## Context

Feature 002 delivered a Fastify API with a five-flag permission matrix across nineteen
administrative modules, member and staff authentication, media derivatives, push campaigns and
SEO administration. Nothing renders it. Staff who hold `seo.edit` have no way to edit SEO except
by issuing HTTP requests by hand; a member who signs in reaches no destination.

`German_World_Club_Digital_Plattform.docx` (12 pages, "GWC Digital Platform Mockups -
Modernisierung v4") specifies the visual and interaction design for six surfaces: the public
website, the mobile app, the Club Merchant Portal, the Corporate Club Partner Portal, the Admin
Panel and the CRM. This feature builds the **browser-based** subset of those: the logged-in member
web experience and the three organisational portals. The native mobile app is a separate
deliverable.

**Amended 2026-09-17**: the public landing page is now part of this feature too. The Experts
Circle / German Emirates Club coming-soon page that previously occupied `/` has been removed in
full, and `/` serves a GWC landing page built from this same design document, carrying the sign-in
route into the console. The deeper public site — city pages, event listings, the member directory,
expert profiles — remains a separate deliverable.

The design document is prescriptive about posture, not only pixels: *"klare Service-Struktur, viel
Weißraum, hohe Kontraste, funktionale Hierarchie. Primäre Referenz: bahn.de"*, and *"GWC-Logo
unverändert, Gold nur als gezielter Marken- und Aktionsakzent"*. It also states repeatedly that
commercial relationships must be visibly disclosed and must never purchase trust — a rule the UI
is expected to carry, not merely the server.

**Registration is out of scope** by explicit instruction: it is unfinished. Nothing in this
feature renders sign-up, application, waiting-for-approval or new-account verification. Sign-in,
refresh, password reset and sign-out for accounts that already exist are in scope, because without
them no principal can reach any surface this feature builds.

### The gap this specification must confront

The permission matrix declares nineteen modules. The API exposes routes for three of them
(`seo`, `settings`, `mass_messages`). There is no table, no route and no contract for events,
partners, merchants, offers, redemptions, committees, threads, membership orders, support tickets,
newsletters, magazine or pages. There is no merchant principal and no partner principal: the token
audiences are `member` and `admin` only.

"Serve all the RBAC users and let them use the functions" therefore requires building the missing
server surface alongside the client. This specification covers both. It is organised so that each
module is an independently shippable slice: a client that renders a module it has no API for is
not a deliverable, and an API with no client is not one either.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A staff member signs in and reaches a console scoped to their grants (Priority: P1)

A GWC staff member opens the console, signs in with the credentials they already have, and sees an
Admin Panel whose navigation contains exactly the modules their permission grants allow. A staff
member holding only `seo.read` sees SEO and nothing else. The console never shows a module it
would refuse, and never hides one it would serve.

**Why this priority**: Every other staff story depends on this shell. It is also the slice that
proves the capability contract — the server telling the client what to display — works end to end.

**Independent Test**: Sign in as accounts with three different grant sets and compare the rendered
navigation against the grants each account holds. Delivers a usable, correctly scoped console even
before any module screen exists.

**Acceptance Scenarios**:

1. **Given** a staff account with `seo.read` and `seo.edit` only, **When** they sign in, **Then**
   the navigation offers SEO and does not offer Members, Events, Billing or any other module.
2. **Given** a staff account whose `seo` grant is revoked while they are signed in, **When** they
   next navigate, **Then** SEO is no longer offered and a direct URL to it is refused by the
   server.
3. **Given** an unauthenticated visitor, **When** they request any console URL, **Then** they are
   shown the sign-in screen and no console content of any kind is rendered first.
4. **Given** a member account (not staff), **When** they sign in, **Then** they reach the member
   web experience and the Admin Panel is neither rendered nor reachable.

---

### User Story 2 - A staff member edits SEO metadata under their grants (Priority: P1)

A staff member holding `seo.edit` opens a record's SEO metadata, sees the current title,
description, slug and share image, changes them, and saves. A staff member holding only `seo.read`
sees the same values with no editable control and no save action.

**Why this priority**: This is the one administrative module with a complete API today, so it is
the shortest path to a genuinely useful console and the proving ground for the read/edit flag
distinction that all eighteen other modules will reuse.

**Independent Test**: Edit a record's SEO fields as a `seo.edit` holder and confirm the change is
reflected in the served page's metadata; repeat as a `seo.read` holder and confirm the form is
read-only and the server refuses a submitted change.

**Acceptance Scenarios**:

1. **Given** `seo.edit`, **When** the staff member saves a changed meta description, **Then** the
   public page for that record serves the new description.
2. **Given** `seo.read` only, **When** the staff member opens the same record, **Then** no field
   is editable and no save control is offered.
3. **Given** `seo.read` only, **When** a change is submitted anyway, **Then** the server refuses it
   and the console reports the refusal without losing the entered values.

---

### User Story 3 - A staff member composes and sends a push campaign (Priority: P2)

A staff member holding `mass_messages.write` composes a push campaign, previews it against the
test recipients, and sends it. Pacing, batch size and quota are decided by the server; the console
shows what the server decided rather than asserting its own limits.

**Why this priority**: The second module with a working API, and the one where the consequence of
a mistake reaches members directly — so it exercises preview, confirmation and the distinction
between a rate limit and a business quota.

**Independent Test**: Compose, preview and send a campaign to a test-recipient set, and confirm
delivery and the recorded campaign state without touching real members.

**Acceptance Scenarios**:

1. **Given** `mass_messages.write`, **When** a campaign is previewed, **Then** the console shows
   the rendered notification and the recipient count the server computed.
2. **Given** `mass_messages.read` only, **When** the staff member opens campaigns, **Then** past
   campaigns are listed and no compose or send control is offered.
3. **Given** a send that the server refuses on quota, **When** the refusal arrives, **Then** the
   console distinguishes it from a retryable rate limit and does not offer a retry that cannot
   succeed.

---

### User Story 4 - A member signs in and sees what GWC has done for them (Priority: P2)

A member signs in on the web and reaches a home surface built from the design document's member
start page: what is relevant today, their profile, and their personal value ledger. They can edit
their own profile and control field-level visibility.

**Why this priority**: The member is the centre of the product per the design document. This slice
turns an authenticated member from someone who can sign in into someone with a reason to.

**Independent Test**: Sign in as an existing member, view and edit the profile, and confirm the
changes persist and respect the visibility choices made.

**Acceptance Scenarios**:

1. **Given** an active member, **When** they sign in, **Then** they see their profile and value
   ledger and no administrative surface.
2. **Given** a member who marks a profile field private, **When** another member views them,
   **Then** that field is absent from the response, not merely hidden in the markup.
3. **Given** a member whose status is not `active`, **When** they attempt to sign in, **Then**
   access is refused with the reason the server gives.

---

### User Story 5 - A merchant manages offers through GWC approval (Priority: P3)

A Club Merchant signs in to their portal, creates a product or service, attaches a GWC benefit
with a regular price and a member price, and submits it for approval. It is not visible to members
until GWC staff approve it. The merchant sees redemptions, member feedback and aggregate
performance — never a member list.

**Why this priority**: The first slice requiring a principal kind the platform does not have, and
the first to require the publishing-approval workflow. High value, but blocked on new server
foundations.

**Independent Test**: Create an offer as a merchant, confirm it is invisible to members, approve
it as staff, and confirm it becomes visible and its redemptions accrue.

**Acceptance Scenarios**:

1. **Given** a merchant with a draft offer, **When** it is submitted, **Then** its state is
   pending approval and no member can see it.
2. **Given** staff approve it, **When** a member browses benefits, **Then** the offer appears with
   the regular price, the GWC price, validity and conditions all shown.
3. **Given** a merchant viewing analytics, **When** they open any performance screen, **Then** no
   identifiable member data is present in the response.
4. **Given** an offer whose validity window has passed, **When** a member browses benefits,
   **Then** it is absent from active surfaces.

---

### User Story 6 - A corporate partner manages employee entitlements and job posts (Priority: P3)

A Corporate Club Partner signs in to their portal, sees how many of their employees are entitled
and how many have activated, invites employees, publishes a vacancy for GWC approval, and reads
aggregate activation analytics.

**Why this priority**: The second new principal kind, and the one the design document is most
insistent about: a corporate partnership is explicitly not a membership, and the UI must not blur
the two.

**Independent Test**: Invite an employee, confirm the entitlement is created without creating a
membership, publish a vacancy through approval, and read the aggregate analytics.

**Acceptance Scenarios**:

1. **Given** a partner invites an employee, **When** the entitlement is created, **Then** the
   employee gains benefit access and does not become a GWC member of any tier.
2. **Given** a partner viewing analytics, **When** they open activation figures, **Then** the
   figures are aggregate and no employee is individually identifiable.
3. **Given** a partner publishes a vacancy, **When** it is submitted, **Then** it awaits GWC
   approval before reaching any member.

---

### User Story 7 - Staff govern the approval queues and every decision is auditable (Priority: P3)

A staff member holding the relevant module grant opens an approval queue, sees each submission
exactly as a member would see it, and approves, requests changes or rejects it. Every decision
records who, when, what changed and why.

**Why this priority**: The design document calls governance a product component, not a backoffice.
It is what prevents the platform degrading into a coupon directory. It depends on stories 5 and 6
having produced something to approve.

**Independent Test**: Submit content as a merchant and a partner, act on it in each queue as
staff, and confirm the member-facing preview matched what published and that the audit record is
complete and immutable.

**Acceptance Scenarios**:

1. **Given** a pending merchant offer, **When** staff open it for review, **Then** they see the
   member-facing preview, not a raw form.
2. **Given** staff request changes with a comment, **When** the merchant reopens it, **Then** the
   comment and the prior version are both visible.
3. **Given** any approval decision, **When** the audit log is read, **Then** the actor, timestamp,
   decision and version are present and cannot be altered or deleted.

---

### Edge Cases

- A grant is revoked between the console rendering its navigation and the member clicking an
  item. The server refuses; the console must report the refusal and re-fetch capabilities rather
  than showing a broken screen.
- A staff member holds `read` but not `edit` on a module: the console must render a genuinely
  read-only surface, not a disabled-looking one that still submits.
- A principal holds grants on zero modules. The console must render an explicit empty state, not
  an error and not a blank page.
- A member's session is terminated by a sign-in elsewhere — at most one session per account is
  active. The open console must detect this on its next request and return to sign-in without
  losing unsaved work silently.
- A refusal arrives as RFC 9457 problem+json with a `type` the console does not recognise. It must
  render the problem's title without branching on `detail`.
- A request exceeds its deadline and returns 503. The console must distinguish this from a
  validation failure and offer a retry.
- A merchant or partner account is suspended mid-session.
- The browser has JavaScript disabled. Gated surfaces may refuse to function; they are never
  indexed. No member-only content may be rendered to an unauthenticated requester for any reason.

## Requirements *(mandatory)*

### Functional Requirements

#### Identity and access

- **FR-001**: The console MUST authenticate existing accounts by sign-in, and MUST support
  password reset, session refresh and sign-out.
- **FR-002**: The console MUST NOT render any registration, application, account-creation,
  new-account verification or waiting-for-approval surface.
- **FR-003**: The console MUST obtain the set of modules and flags the signed-in principal holds
  from the server, and MUST use it only to decide what to display.
- **FR-004**: The console MUST NOT decide what is permitted. Every operation MUST be re-checked by
  the server, and a client-side capability check MUST NOT be the only barrier to any action.
- **FR-005**: A browser client MUST authenticate by cookie; the authorization outcome MUST be
  identical to the bearer path used by other clients.
- **FR-006**: The console MUST support four principal kinds — member, staff, club merchant and
  corporate club partner — and MUST NOT allow a credential for one to reach a surface for another.
- **FR-007**: When the server refuses for authorization, the console MUST NOT reveal whether the
  refused resource exists.

#### Design system

- **FR-008**: The console MUST render from a single design-token source derived from the design
  document: navy `#0A2457` as brand primary, gold `#D49626` (`#A96B08` where gold must carry text
  contrast) as accent only, ink `#171B20` for portal chrome, `#F7F8FA` page ground, `#FFFFFF`
  surfaces, `#D9DEE4`/`#E6E9ED` hairlines, and the `#FFF7E4` / `#EAF2FC` / `#EAF7EF` tints for
  gold, informational and success callouts.
- **FR-009**: Gold MUST be used only as a brand and action accent — a rule the token set MUST make
  structurally easy to honour and hard to violate.
- **FR-010**: The GWC logo MUST be used unmodified.
- **FR-011**: Every text and interactive element MUST meet WCAG 2.2 AA contrast against its actual
  background in both the light surfaces and the dark portal chrome.
- **FR-012**: The console MUST be usable at phone width with no horizontal page scroll.
- **FR-013**: Every image MUST carry explicit dimensions and MUST be served as a derivative, never
  as an uploaded original.
- **FR-014**: The interface language MUST be German, matching the design document.

#### Console shell

- **FR-015**: Each portal MUST present the sidebar-and-cards shell of the design document: dark
  sidebar, the active item marked with the gold rule, a KPI row and white cards on the page
  ground.
- **FR-016**: Navigation MUST list exactly the modules the principal's grants allow.
- **FR-017**: A module the principal holds only `read` on MUST render without any control that
  would submit a change.
- **FR-018**: The console MUST render RFC 9457 problems by `type`, never by parsing `detail`.
- **FR-019**: The console MUST distinguish a retryable rate limit from a business quota, and MUST
  NOT offer a retry for a refusal that retrying cannot satisfy.
- **FR-020**: Every destructive or outward-facing action MUST be confirmed before it is sent.

#### Administrative modules

- **FR-021**: The console MUST provide a working surface for every module in the permission matrix
  that has a server API, and MUST NOT present a module it cannot serve as though it were
  available.
- **FR-022**: The system MUST provide server endpoints for the modules the portals require that do
  not yet have them, each declaring its access posture and its response shape.
- **FR-023**: Staff MUST be able to review, approve, request changes on, or reject merchant offers,
  partner content and vacancies, seeing the member-facing preview before deciding.
- **FR-024**: Every approval decision MUST be recorded append-only with actor, timestamp, decision,
  comment and the content version decided on.
- **FR-025**: Content whose validity window has passed MUST disappear from active surfaces without
  staff action.

#### Merchant and partner portals

- **FR-026**: A merchant MUST be able to manage their profile, locations, products, services,
  offers, messages, leads, analytics, team and billing.
- **FR-027**: A merchant MUST NOT be able to reach member lists or contact any member who has not
  contacted them first.
- **FR-028**: Every offer MUST show regular price, GWC price or benefit, availability, locations,
  validity and conditions.
- **FR-029**: A corporate partner MUST be able to manage their company profile, employee
  entitlements, vacancies, editorial content, events, analytics and billing.
- **FR-030**: An employee entitlement MUST NOT create a membership of any tier.
- **FR-031**: Merchant and partner analytics MUST be aggregate. No identifiable member data may
  appear in any response to either principal.
- **FR-032**: Partner- and merchant-originated communication MUST be visibly labelled as such
  wherever a member sees it.

#### Member web

- **FR-033**: A member MUST be able to view and edit their own profile, including the "Ich kann
  helfen bei" and "Ich suche" fields.
- **FR-034**: A member MUST control, field by field, which profile information is visible to
  others, and a field marked private MUST be absent from the response rather than hidden in
  markup.
- **FR-035**: A member MUST see their personal value ledger: savings, resolved cases,
  introductions and events.
- **FR-036**: Member-to-member contact MUST require consent — a connection request or double
  opt-in introduction — before any direct message is possible.

#### Public landing page (added 2026-09-17)

- **FR-040**: The public landing page MUST deliver its meaningful content in the initial HTML
  response with no JavaScript executed, because link-preview bots and most non-Google crawlers run
  none.
- **FR-041**: The landing page MUST carry no trace of the Experts Circle or German Emirates Club
  brand, and MUST present the German World Club instead.
- **FR-042**: The landing page MUST offer a route into the console for every principal kind, and
  MUST state that one sign-in serves all of them.
- **FR-043**: The landing page MUST NOT offer any account-creation affordance, consistent with
  FR-002.
- **FR-044**: The landing page's colours MUST be the same values as the console's design tokens,
  and drift between the two MUST fail the build.

#### Out of scope

- **FR-037**: Registration, application and approval-of-new-accounts flows are out of scope.
- **FR-038**: ~~The public marketing website and the native mobile app are out of scope.~~
  **Amended 2026-09-17 on explicit instruction.** The native mobile app remains out of scope. The
  public landing page is now **in** scope and delivered: the previous Experts Circle / German
  Emirates Club coming-soon page is removed in full, and `/` now serves a GWC landing page built
  from `German_World_Club_Digital_Plattform.docx`, carrying a sign-in section that routes all four
  principal kinds into the console. The deeper public site of mockup pages 2-3 — city pages, event
  listings, the member directory, expert profiles — remains out of scope.
- **FR-039**: The CRM surface is out of scope for this feature.

### Key Entities

- **Principal**: A signed-in actor of one of four kinds — member, staff, club merchant, corporate
  club partner. Carries an identity and, for staff, a grant set.
- **Grant**: A staff account's flags (`read`, `write`, `edit`, `delete`, `status`) on one of the
  nineteen modules. Absence is denial.
- **Capability set**: What the server tells a client the current principal may see. Display input
  only; never an authorization decision.
- **Organisation**: A club merchant or corporate club partner, with a contract, fee tier, team of
  users and billing relationship. Distinct from a member.
- **Offer**: A merchant's benefit to members — regular price, GWC price, validity, locations,
  conditions — which passes through approval before publication and accrues redemptions and
  feedback.
- **Entitlement**: A corporate partner's grant of benefit access to a named employee. Not a
  membership.
- **Submission**: Any content awaiting a staff decision, carrying versions, comments and its
  decision history.
- **Audit record**: An append-only record of who decided what, when, and on which version.
- **Value ledger**: A member's accumulated savings, resolved cases, introductions and event
  participation.
- **Design token**: A named colour, type step, spacing step or radius, defined once and consumed
  by every surface.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every one of the nineteen permission modules either has a working console surface or
  is explicitly and visibly marked as not yet available; no module silently absent.
- **SC-002**: For every module-flag pair, an automated check proves the console renders the
  surface for a principal holding it and does not render it for a principal who does not.
- **SC-003**: No console surface performs an action the server would refuse; an automated check
  drives the UI with under-privileged principals and proves every refusal is surfaced as a
  refusal, never as a broken screen.
- **SC-004**: An automated check proves no registration, application or approval-of-new-account
  surface is reachable from any route the console serves.
- **SC-005**: Every design token in use traces to a value present in the design document; an
  automated check fails the build on a hard-coded colour outside the token set.
- **SC-006**: Every screen passes automated WCAG 2.2 AA checks with zero violations in both light
  surfaces and dark portal chrome.
- **SC-007**: A staff member holding a single module's grants can complete that module's primary
  task without reading documentation.
- **SC-008**: An automated check proves no response to a merchant or partner principal contains
  identifiable member data.
- **SC-009**: Every approval decision is retrievable from the audit log with actor, timestamp,
  decision and version; an automated check proves the record cannot be altered or deleted.
- **SC-010**: Gated console surfaces are excluded from indexing, and an automated check proves no
  member-only content is served to an unauthenticated requester.
- **SC-011**: The console is usable at 320px width with no horizontal page scroll on every screen.
- **SC-012**: Every new server endpoint declares its access posture and response shape, and
  startup fails if one does not.

## Assumptions

- The four staff/member/merchant/partner principal kinds all authenticate through the existing
  session and refresh machinery; merchant and partner are new audiences over the same mechanism
  rather than a parallel auth system.
- Accounts already exist. This feature never creates one. Seed and migration tooling provides the
  accounts needed to exercise it.
- The interface is German, per the design document. No localisation framework is assumed beyond
  keeping strings out of components.
- The design document's font is not named anywhere in the file; a system-stack neutral grotesk is
  assumed until the brand font is supplied.
- Membership tiers, merchant fee tiers and partner fee tiers are exactly as stated in the design
  document. This feature introduces no new pricing or product logic.
- Gated console surfaces may be client-rendered; only public pages require meaningful content
  without JavaScript, and none of those are in this feature.
- The existing `client/` workspace, currently a coming-soon page from feature 001, is the host for
  this work; its existing content remains served until the public site is rebuilt separately.

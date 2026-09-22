# Feature Specification: Member Marketplace (Classifieds)

**Feature Branch**: `008-marketplace`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "implement the market place"

## Context

BUSINESS_DESCRIPTION.md §7 specifies member-posted classifieds in three structured
categories — vehicles, real estate, jobs — each an *offer* or a *request*, with
multiple photos, a configurable contact method, a per-member posting permission
and acceptance of terms.

The platform is already scaffolded for this and has been since feature 002. What
exists today:

| Already in place | Where |
|---|---|
| `marketplace_post` per-member permission flag | `members.permissions` jsonb (`005_members.sql`), `MEMBER_PERMISSIONS` |
| `marketplace_moderation` staff module, five flags | `MODULES` in `@gwc/contracts/permissions` |
| Crawl posture: gated, never indexed | `seo/surfaces.ts` — `/marketplace`, "Member-only classifieds" |
| Ownership guard for own listing vs. staff grant | `authz/object-guards.ts` → `guardOwnedContent` |
| Media pipeline: derivatives, magic-byte validation, stored-byte quota | `modules/media/`, `db/counters.ts` |
| Audit log, append-only | `002_audit_log.sql`, `app.audit` |

What does **not** exist: any table, route, contract type or console screen. There
is no `marketplace` migration — the schema stops at `017_timescale.sql`.

**Not this feature.** `src/seed/offers.ts` and `015_merchant_domain.sql` are
*merchant* offers under §5 — a commercial counterparty publishing discounts to
the whole club. Member classifieds are §7 and share nothing with them but the
word "offer". Conflating the two is the most likely way this feature goes wrong.

## Clarifications

### Session 2026-09-21

- **Q**: Does the marketplace need a public/indexed surface? → **A**: No.
  `seo/surfaces.ts` already declares `/marketplace` gated and never-indexed with
  the reason "Member-only classifieds", and §12 rule 10 lists marketplace among
  the surfaces that are never indexed. This feature adds no public surface and
  changes no crawl posture.
- **Q**: Is there money in it? → **A**: No. §7 describes classifieds with a
  contact method, not a transaction. No payment, no escrow, no order. A listing
  ends in two members talking to each other.
- **Q**: ~40 vehicle feature checkboxes — one column each? → **A**: No, see
  research.md R3.

### Session 2026-09-22

The three items `plan.md` carried as NEEDS CLARIFICATION, now answered.

- **Q**: Where does the member-facing marketplace live? → **A**: In the web
  application as an additional tab, **and** in the mobile application. Both
  consume **one shared member-audience API** — cookies for the browser, bearer
  tokens for mobile, which Principle I explicitly permits while requiring the
  authorization *outcome* to be identical.

  "Public endpoint" here means *one API serving both faces*, **not** readable
  while signed out. Listings stay member-only and never-indexed, so
  `seo/surfaces.ts` is unchanged and no constitutional amendment is required.
  This was confirmed explicitly, because the alternative reading would have
  contradicted §12 rule 10, the §11 surface table (`Marketplace listings | No |
  Never`) and Principle VI's prohibition on exposing member content — even
  partially — for search visibility.

- **Q**: What is the contact method, given messaging does not exist? → **A**:
  Build it. In-platform messaging is the contact method, and this feature builds
  the **persistence and the inquiry flow**. Real-time WebSocket transport,
  typing indicators and read receipts are a later feature.

  The split follows the Technology & Security Baseline, which already frames it:
  *"Real-time transport is additive — a message MUST be persisted before it is
  delivered, so a dropped connection never loses data."* Persistence first is
  therefore not a shortcut; it is the stated order.

- **Q**: Listing quota and expiry window? → **A**: Expiry is **optional and
  member-settable, including unlimited**. A listing with no expiry never
  expires. The quota remains configurable with a default.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A member posts a listing (Priority: P1)

A member with the `marketplace_post` flag writes a classified: picks a category,
says whether they are offering or looking, fills the fields that category asks
for, attaches photos, chooses how they want to be contacted, accepts the terms,
and publishes. A member without the flag never sees the compose control at all.

**Why this priority**: Without posting there is no marketplace. It is also where
every rule in the feature is enforced — the permission flag, the terms
acceptance, the category-specific fields, the photo pipeline and the quota.

**Independent Test**: Grant one member the flag and not another. The first can
create a listing that appears in the index; the second gets no control and is
refused by the API if they call it directly.

**Acceptance Scenarios**:

1. **Given** a member with `marketplace_post`, **When** they submit a complete
   vehicle listing, **Then** it is stored and visible to other members.
2. **Given** a member **without** `marketplace_post`, **When** they call the
   create endpoint directly, **Then** the server refuses. The absent UI control
   is a courtesy; the server is the control.
3. **Given** a member who has not accepted the current terms, **When** they
   submit, **Then** the server refuses and names the terms as the reason.
4. **Given** a submission whose category is `vehicle`, **When** it omits a field
   that category requires, **Then** it is refused naming the field — and the
   same submission under `job` is accepted, because the required set differs per
   category.
5. **Given** a member at their listing quota, **When** they submit another,
   **Then** they are refused with a quota problem (422), not a rate limit (429).

---

### User Story 2 - A member browses and filters listings (Priority: P1)

A member opens the marketplace, sees current listings newest-first, narrows by
category, by offer-versus-request, and by the filters that category supports —
price range and make for vehicles, rooms and size for real estate, location and
seniority for jobs. They open one and see the photos and how to make contact.

**Why this priority**: A marketplace only one person can see is not one. This is
also where the never-indexed posture has to hold under a real listing corpus.

**Independent Test**: Seed listings across all three categories and both modes,
then filter to each combination and confirm the result set matches — and that
an unauthenticated request for the same URLs is refused and carries `noindex`.

**Acceptance Scenarios**:

1. **Given** listings in all three categories, **When** a member filters to
   `vehicle` + `request`, **Then** only vehicle requests are returned.
2. **Given** a listing with photos, **When** a member opens it, **Then** the
   served images are derivatives at declared breakpoints, never the original.
3. **Given** any marketplace URL, **When** an unauthenticated client requests it,
   **Then** it is refused and the response carries `X-Robots-Tag: noindex`.
4. **Given** a paginated index, **When** a client asks for an absurd page size,
   **Then** the server bounds it rather than serving it.
5. **Given** an expired or withdrawn listing, **When** a member browses, **Then**
   it does not appear — and requesting it directly returns not-found or gone,
   never a success carrying fallback content (§12 rule 13).

---

### User Story 3 - A member manages their own listings (Priority: P2)

A member edits a listing they posted, marks it sold or filled, or withdraws it.
They cannot touch anyone else's. Editing does not re-open moderation from
scratch for a trivial change, but does for a material one.

**Why this priority**: Without it every mistake is permanent and every sold item
stays up, which is how a classifieds section becomes untrustworthy.

**Independent Test**: Two members, one listing each. Each can edit their own and
is refused on the other's — and the refusal does not reveal whether the other
listing exists.

**Acceptance Scenarios**:

1. **Given** a member's own listing, **When** they edit it, **Then** it is saved
   and the change is audited.
2. **Given** another member's listing, **When** they attempt to edit it, **Then**
   they are refused — and per the `guardOrganisationScope` precedent the refusal
   does not confirm the listing exists to someone guessing ids.
3. **Given** a listing marked sold, **When** members browse, **Then** it is no
   longer in the index but the owner can still see it in their own listings.

---

### User Story 4 - Staff moderate the marketplace (Priority: P2)

A staff member with `marketplace_moderation` reviews reported listings, hides or
removes one, and the action is auditable. Their five flags mean what they mean
everywhere else: `read` to review, `status` to change a listing's state,
`delete` to remove.

**Why this priority**: §8 makes moderation a platform-wide obligation, and a
member-posted surface without it is the one that produces the complaint.

**Independent Test**: Staff with `marketplace_moderation:status` can hide a
listing; staff with only `read` cannot; the audit log records who did what.

**Acceptance Scenarios**:

1. **Given** staff holding `marketplace_moderation:status`, **When** they hide a
   listing, **Then** it leaves the member index and the audit log records it.
2. **Given** staff holding only `marketplace_moderation:read`, **When** they
   attempt to hide one, **Then** they are refused.
3. **Given** a member reports a listing, **When** staff open the queue, **Then**
   the report is there with its reason.
4. **Given** a hidden listing, **When** its owner views their own listings,
   **Then** they can see it is hidden rather than finding it silently gone.

---

### User Story 5 - A member contacts a seller (Priority: P1)

A member finds a listing and makes an inquiry. The seller receives it, both can
reply, and the conversation persists whether or not either is online. Neither
sees the other's email address or phone number unless their privacy settings
allow it — the inquiry rides the platform, not the member's contact details.

**Why this priority**: A classified with no way to respond to it is a notice
board nobody can answer. This is also §7's "configurable contact method" made
concrete, and it is the reason messaging enters this feature at all.

**Independent Test**: Two members, one listing. The first inquires, the second
sees it and replies, and the exchange survives both of them signing out and back
in. Neither response body contains the other's email or phone.

**Acceptance Scenarios**:

1. **Given** a listing, **When** a member inquires, **Then** a conversation
   exists linked to that listing and the owner can read it.
2. **Given** an inquiry, **When** the owner replies, **Then** the inquirer reads
   it on their next request — delivery does not require either to be online.
3. **Given** a message is accepted, **Then** it is persisted **before** any
   delivery or notification is attempted, per the Technology Baseline.
4. **Given** any inquiry or reply, **When** the response is inspected, **Then**
   it carries no email address or phone number for either party.
5. **Given** a listing that is withdrawn or hidden, **When** a member attempts a
   new inquiry, **Then** it is refused — but existing conversations remain
   readable to both parties.

---

### User Story 6 - The marketplace works on mobile (Priority: P2)

A member opens the mobile app, finds the marketplace in the tab bar, browses the
same listings they see on the web, and inquires. The listings, the filters and
the permission rules are identical because the two faces call one API.

**Why this priority**: §1 names the mobile app as one of the three faces, and
Principle I exists so the second face costs no second rule set. It is P2 rather
than P1 because it has prerequisites the web face does not — see the
prerequisite note below, which is the honest reason this story is larger than it
looks.

**Independent Test**: Sign in on mobile with a bearer token, list and filter, and
confirm the results match the web face for the same member. Then revoke the
member's `marketplace_post` flag and confirm both faces refuse to post.

**Acceptance Scenarios**:

1. **Given** the same member on both faces, **When** they list with the same
   filters, **Then** the results are identical.
2. **Given** a member without `marketplace_post`, **When** they attempt to post
   from mobile, **Then** they are refused exactly as on the web.
3. **Given** the mobile client, **When** it names a request or response shape,
   **Then** it imports it from `@gwc/contracts` rather than redeclaring it.

> **Prerequisite, not incidental.** `expo-client/german-world-club` is a scaffold
> today: two placeholder tabs, **no API client, no authentication, and it is
> outside the npm workspaces with no `@gwc/contracts` dependency**. Before a
> marketplace tab can exist, the app needs to join the workspace so it can import
> the shared package (Principle I), and needs bearer-token authentication against
> the existing `/auth` routes. That work is a precondition of US6 and is sized in
> `plan.md`, not hidden inside "add a tab".

---

### Edge Cases

- **A member loses `marketplace_post` while holding live listings.** Their
  listings stay; they cannot create more. Revocation governs future posts, not
  retroactive deletion — and authorization is resolved per request, so it takes
  effect on the next one.
- **A member's status changes to `locked`, `inactive` or `ended`.** Their
  listings must stop being reachable by other members. This is the same question
  §3.2 answers for sign-in and it needs an answer here, stated once.
- **Photos.** A listing's photos are assets. Deleting a listing must not delete
  bytes another listing shares by checksum — the rule `media/routes` already
  owns. The per-member stored-byte quota already exists and applies.
- **Contact method.** §7 says configurable. Whatever it offers, a listing must
  not become a way to extract a member's email or phone against their privacy
  settings (§7 privacy controls).
- **Free-text partner names** are auto-hyperlinked to partner pages in threads,
  marketplace and magazine (§2). Whether that lands in this feature or later,
  the text must be stored so it remains possible.
- **Category-specific fields when a listing changes category.** Fields that no
  longer apply must not linger and re-appear.

## Requirements *(mandatory)*

### Functional Requirements

**Posting and ownership**

- **FR-001**: Creating a listing MUST require the `marketplace_post` per-member
  flag, resolved from server-held state at request time.
- **FR-002**: Creating a listing MUST require acceptance of the current terms,
  recorded with the acceptance.
- **FR-003**: A member MUST be able to edit, mark sold/filled, and withdraw only
  their own listings, enforced against the loaded row inside the transaction.
- **FR-004**: A refusal on someone else's listing MUST NOT reveal whether it
  exists, following `guardOrganisationScope`'s 404-not-403 precedent.
- **FR-005**: Listings MUST NOT be hard-deleted by members. Withdrawal is a
  state transition, consistent with the platform's treatment of member data.

**Categories**

- **FR-006**: Three categories MUST be supported — vehicle, real estate, job —
  each with its own required and optional fields.
- **FR-007**: Every listing MUST be either an offer or a request.
- **FR-008**: Vehicle listings MUST support the ~40 feature checkboxes of §7.
- **FR-009**: Category-specific validation MUST be server-side. A client may
  shape its form from the same definition but MUST NOT be the enforcement point.

**Browsing**

- **FR-010**: Members MUST be able to list with filters for category, mode, and
  each category's own filterable fields, with bounded pagination.
- **FR-011**: Only listings in a publicly-visible state, from members in good
  standing, MUST appear in the member index.
- **FR-012**: A withdrawn, sold, expired or hidden listing MUST return not-found
  or gone when requested directly — never a success carrying fallback content.

**Photos**

- **FR-013**: Photos MUST go through the existing media pipeline: content
  inspection, derivatives at declared breakpoints, metadata stripped.
- **FR-014**: Originals MUST NOT be served.
- **FR-015**: Stored bytes MUST count against the member's existing quota, under
  a row lock.

**Moderation**

- **FR-016**: Staff holding `marketplace_moderation` MUST be able to review,
  hide and remove listings, gated per flag.
- **FR-017**: Members MUST be able to report a listing with a reason.
- **FR-018**: Every moderation action MUST be written to the append-only audit
  log with actor, target and reason.

**Posture**

- **FR-019**: Every marketplace route MUST declare `config.auth` — the boot gate
  requires it.
- **FR-020**: No marketplace surface may be public or indexed. The existing
  `seo/surfaces.ts` declaration MUST continue to hold, with a test.
- **FR-021**: Quotas MUST be enforced in PostgreSQL under a row lock via
  `db/counters.ts`, never in the rate limiter — a 422, not a 429.

**Contact and messaging**

- **FR-023**: A member MUST be able to inquire about a listing, creating a
  conversation linked to it.
- **FR-024**: Both parties MUST be able to reply, and the exchange MUST persist
  independently of either being connected.
- **FR-025**: A message MUST be persisted **before** delivery or notification is
  attempted. Real-time transport is additive (Technology Baseline).
- **FR-026**: No inquiry or reply response may carry either party's email address
  or phone number. The listing stores a contact *preference*, never a value.
- **FR-027**: An inquiry on a withdrawn, sold, expired or hidden listing MUST be
  refused, while existing conversations remain readable to both parties.

**Expiry**

- **FR-028**: Expiry MUST be optional and member-settable. A listing with no
  expiry set never expires, and this is a first-class choice rather than a
  missing value.
- **FR-029**: When an expiry is set, a scheduled job MUST transition the listing
  to `expired`. The job MUST be individually enableable and MUST record its
  start, end and outcome.
- **FR-030**: A member MUST be able to change or remove an expiry on their own
  listing, including setting it back to unlimited.

**Three faces, one rule set**

- **FR-031**: The web and mobile faces MUST consume one member-audience API.
  Authentication *mechanism* may differ — cookies for the browser, bearer tokens
  for mobile — but the authorization *outcome* MUST NOT.
- **FR-032**: The mobile client MUST import request and response types from
  `@gwc/contracts`, which requires it to join the npm workspace.
- **FR-033**: No marketplace surface may be readable while signed out, on either
  face. "One shared API" does not mean an unauthenticated one.

**Contracts**

- **FR-022**: Request and response types MUST live in `@gwc/contracts`, imported
  by the server and every client.

### Key Entities

- **Listing**: one classified. Category, mode (offer/request), title, body,
  state, owner, timestamps, terms acceptance. The category-specific fields hang
  off it — see data-model.md §2 for how, which is the central design decision.
- **Listing photo**: a listing's ordered link to a media asset. Not a copy of
  the bytes.
- **Vehicle / real-estate / job attributes**: the per-category field sets.
- **Report**: a member's complaint about a listing, with reason and state.
- **Terms acceptance**: which version of the marketplace terms a member accepted
  and when.
- **Conversation**: a persisted exchange between two members, linked to the
  listing that started it.
- **Message**: one utterance in a conversation, persisted before delivery.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member with the flag can post in each of the three categories;
  one without it is refused by the API, not merely missing a button.
- **SC-002**: Filtering returns exactly the matching set for every category and
  mode combination, proven against a seeded corpus spanning all of them.
- **SC-003**: No marketplace response is reachable unauthenticated, and every
  one carries `noindex`. `verify:seo` continues to exit 0.
- **SC-004**: No response references an original upload; every image URL is a
  declared derivative.
- **SC-005**: Exceeding the listing quota returns 422, and concurrent submissions
  at the boundary never exceed it — asserted under real concurrency, not
  sequentially.
- **SC-006**: A member cannot read, edit or delete another member's listing, and
  the refusal is indistinguishable from the listing not existing.
- **SC-007**: Every moderation action appears in the audit log with actor,
  target and reason.
- **SC-008**: Every route declares its posture; the server refuses to boot
  otherwise. This is free — the gate already exists — and is listed so it is
  tested rather than assumed.
- **SC-009**: `seed:demo` produces a marketplace corpus spanning all categories,
  both modes and every state, per the feature-005 rule that spread is the point.
- **SC-010**: An inquiry and its reply survive both parties signing out and back
  in, and no response body carries either party's email or phone.
- **SC-011**: A message is written to the database before any delivery or
  notification is attempted — asserted by failing the notification path and
  confirming the message is still there.
- **SC-012**: A listing with no expiry is still active after the expiry job runs;
  one with an expiry in the past is `expired`. Unlimited is a choice the job
  honours, not a null it trips over.
- **SC-013**: The same member, same filters, gets identical results on the web
  and mobile faces.
- **SC-014**: No marketplace response is reachable signed out on **either** face,
  and `verify:seo` continues to exit 0 with no marketplace URL in the sitemap.

## Assumptions

- No public or indexed marketplace surface. `/marketplace` stays gated and
  never-indexed as `seo/surfaces.ts` already declares. One shared API for both
  faces is not the same thing as an unauthenticated one.
- No money. §7 describes a contact method, not a transaction.
- The contact method is in-platform messaging, and this feature builds its
  persistence and the inquiry flow. Real-time WebSocket delivery, typing
  indicators and read receipts are a later feature — the Technology Baseline
  already calls real-time transport additive and requires persistence first.
- Expiry is optional and may be unlimited; the quota default remains a product
  decision.
- Partner auto-hyperlinking (§2) is out of scope, but listing text is stored so
  it stays possible.
- The staff console screens for moderation are in scope as API plus the console
  route that exists as "not built yet" today (`marketplace_moderation` is already
  a sidebar entry).
- The member web surface is a new tab in the web application, under the member
  area `HOME_FOR_KIND` already points at.
- The mobile surface is a new tab in `expo-client/german-world-club`, which first
  has to join the workspace and gain bearer-token authentication. That is
  prerequisite work, not part of "add a tab".
- Vehicle/real-estate/job field sets follow §7's shape. Their exact enumerations
  are a content decision; the schema must not require a migration per checkbox.

# Feature Specification: Demo Seed — Every Identity, With Credentials

**Feature Branch**: `005-demo-seed`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "use https://fakerjs.dev/ to fill the database - add users - different roles - add partners - members - merchant and all the identities that we have and I need the passwords for each role"

## Context

The console can be signed into, but there is almost nothing behind the sign-in. `seed:dev` creates
six fixed accounts — five staff grant shapes and one member — which exist to make the quickstart
scenarios and the DB-backed suites runnable. They are deliberately minimal: a sidebar with two
entries and one member is enough to prove a posture, and nothing more.

That is not enough to *look at*. A list with one row does not show whether a list works. A member
table where every member is active does not exercise the status vocabulary the product is built
around. And a demo to anyone outside the team needs names, cities and dates that read like a club
rather than like `member-3f9a@test.invalid`.

**Two of the four identity kinds do not exist yet.** The schema has `members` and `admin_users`.
`organisations`, `organisation_users`, and the merchant and partner token audiences are fully
specified in feature 003's `data-model.md` §1, but T068, T070 and T101 are open: `AUDIENCES` is
still `['public','member','staff']` and there is no merchant or partner principal anywhere in the
codebase. Seeding all four therefore means building two of them first, and this feature does that —
which also unblocks feature 003's US5 and US6.

**Everything here is development-only.** It creates accounts with published passwords. The existing
`seed:dev` already refuses to run outside `NODE_ENV=development` and this must too, for the same
reason: "we would never run it in production" is not a control.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Someone signs in as any role and sees a populated console (Priority: P1)

A developer or a reviewer runs one command, reads a printed table of credentials, signs in as any
of the four identity kinds, and finds screens with enough data on them to judge whether they work.

**Why this priority**: It is the whole request. Everything else in this feature exists to make this
one thing true.

**Independent Test**: Run the command, pick any row from the credentials table, sign in, and reach
a console with more than a handful of rows in it.

**Acceptance Scenarios**:

1. **Given** a migrated database, **When** the seed command runs, **Then** it prints one credential
   row per role: the identity kind, what that role can do, an email address and a password.
2. **Given** those credentials, **When** any of them is used at the sign-in screen, **Then** it
   authenticates and lands in the console area for that identity kind.
3. **Given** a staff account from the table, **When** the console loads, **Then** the sidebar shows
   exactly the modules that account's grants allow — more than one, and fewer than all.
4. **Given** a member list, **When** it is opened, **Then** it holds enough rows to be worth
   paginating and the names read like people rather than like identifiers.
5. **Given** the command is run twice, **When** the second run finishes, **Then** nothing is
   duplicated and the credentials are unchanged.

---

### Story 2 - The data exercises the states the product actually has (Priority: P1)

The seeded population is not uniform. Members are spread across every status, some with unconfirmed
email, some with verified mobiles, some suppressed after bounces, some carrying a legacy credential
that forces a reset. Staff hold varied, partial permission matrices rather than all-or-nothing.

**Why this priority**: Uniform data hides exactly the defects a demo is meant to surface. A member
table where every row is `active` proves nothing about how the other three statuses render, and an
all-superadmin staff list proves nothing about the permission matrix the platform is built on.

**Independent Test**: Query the seeded population and confirm every status, every credential state
and a spread of permission shapes are represented.

**Acceptance Scenarios**:

1. **Given** the seeded members, **When** they are grouped by status, **Then** every value of the
   status vocabulary has at least one member.
2. **Given** the seeded members, **When** their credential state is examined, **Then** at least one
   carries a legacy hash that forces a password reset on sign-in.
3. **Given** the seeded members, **When** their contact state is examined, **Then** there are
   members with unconfirmed email, with verified and unverified mobiles, and with email suppressed
   after bounces.
4. **Given** the seeded staff, **When** their grants are compared, **Then** no two share the same
   matrix, at least one holds a single module, and at least one is superadmin.
5. **Given** any two seeded accounts, **When** their emails are compared, **Then** they differ —
   the generator does not collide with itself.

---

### Story 3 - The same command gives the same database (Priority: P2)

Running the seed twice, on two machines, produces the same names, the same emails and the same
states. A defect found against seeded data can be reproduced by someone else.

**Why this priority**: It is what separates a seeder from a random data generator. Without it, a
screenshot goes stale, a bug report cannot be reproduced, and the credential table changes under
the person reading it.

**Independent Test**: Seed two empty databases and compare their contents.

**Acceptance Scenarios**:

1. **Given** two freshly migrated databases, **When** each is seeded, **Then** the generated
   identities are identical in both.
2. **Given** a seeded database, **When** the seed is run again, **Then** the identities are
   unchanged.
3. **Given** the seed is run with an explicit randomisation flag, **When** it completes, **Then**
   the data differs from the deterministic run — and says so.

---

### Story 4 - Merchant and partner principals exist (Priority: P1)

An organisation — a Club Merchant or a Corporate Club Partner — has a record, has people who sign
in on its behalf, and those people reach their own portal rather than a member's or a staff
member's.

**Why this priority**: Two of the four identity kinds the request names do not exist. Without this,
half the credential table cannot be produced.

**Independent Test**: Sign in with a merchant credential and a partner credential; confirm each
reaches its own area and neither can reach the other's or the admin console.

**Acceptance Scenarios**:

1. **Given** a merchant credential, **When** it is used, **Then** it authenticates as a merchant
   principal and reaches the merchant area.
2. **Given** a merchant credential, **When** it is presented to a staff-only or member-only route,
   **Then** it is refused — a credential for one audience never satisfies another.
3. **Given** an organisation, **When** its people are listed, **Then** each carries a role within
   that organisation and at least one is an owner.
4. **Given** a merchant principal, **When** it queries anything, **Then** it sees only its own
   organisation's data.

---

### Story 5 - The console has content to show, not just accounts (Priority: P2)

A reviewer opens the merchant portal and sees offers at every stage of their life, with redemptions
and feedback behind the analytics. They open events and see a full one, an open one, and past ones
with attendees.

**Why this priority**: Accounts alone prove sign-in works. Content is what makes the screens worth
reviewing — a merchant portal with no offers demonstrates nothing about the merchant portal.

**Independent Test**: Sign in as a merchant and as staff; confirm the offer and event lists hold a
spread of states rather than one repeated row.

**Acceptance Scenarios**:

1. **Given** the seeded offers, **When** they are grouped by state, **Then** draft, published and
   expired are all present, and at least one belongs to a suspended organisation.
2. **Given** any seeded offer with both prices, **When** they are compared, **Then** the member
   price is lower — and the database refuses the alternative.
3. **Given** the seeded events, **When** they are grouped by state, **Then** not-opened, open,
   closed and past are all present.
4. **Given** the seeded events, **When** their registrations are counted, **Then** at least one is
   at capacity and no member appears twice on the same event.
5. **Given** a published offer, **When** its redemptions are read, **Then** some carry member
   feedback, so the analytics screens compute something other than zero.

---

### Edge Cases

- The seed runs against a database that already holds the six fixed `seed:dev` accounts. It must
  not touch, duplicate or shadow them.
- The seed runs twice concurrently.
- A generated email collides with a fixed account's email.
- A generated address would be routable — a real domain, or a phone number that could reach a real
  handset.
- The database is not migrated, or is migrated to an older version.
- `NODE_ENV` is anything other than development.
- The generator library is upgraded and its output for a given seed changes.

## Requirements *(mandatory)*

### Functional Requirements

#### Safety

- **FR-001**: The seed MUST refuse to run unless `NODE_ENV` is exactly `development`, and MUST say
  why when it refuses.
- **FR-002**: Every generated email address MUST be non-routable, so that no message this platform
  might ever send can reach a real person.
- **FR-003**: Every generated phone number MUST be non-routable for the same reason.
- **FR-004**: No generated record may be mistakable for real member data in an audit or an export.
- **FR-005**: The seed MUST NOT delete or modify any account it did not create, including the six
  fixed `seed:dev` accounts.

#### Identities

- **FR-006**: The system MUST support four principal kinds — member, staff, club merchant and
  corporate club partner — and a credential for one MUST NOT satisfy a route for another.
- **FR-007**: The seed MUST create members spanning every status in the status vocabulary.
- **FR-008**: The seed MUST create members spanning every credential state, including at least one
  whose stored credential forces a password reset.
- **FR-009**: The seed MUST create members with and without confirmed email, with and without
  verified mobile, and with email suppressed after bounces.
- **FR-010**: The seed MUST create staff accounts with varied partial permission matrices,
  including at least one single-module account and at least one superadmin.
- **FR-011**: The seed MUST create organisations of both kinds, each with at least one person who
  can sign in on its behalf, and at least one of those an owner.
- **FR-012**: Every organisation principal's reach MUST be limited to its own organisation.

#### Credentials

- **FR-013**: The seed MUST print a credentials table listing, for every role it created, the
  identity kind, a one-line description of what that role can do, an email and a password.
- **FR-014**: Passwords MUST be stated per role, so that signing in as a particular role requires
  no guessing.
- **FR-015**: The credentials table MUST be reproducible — running the seed again MUST print the
  same table.
- **FR-016**: Passwords MUST be stored using the same hashing the platform uses for real
  credentials. No shortcut, no plaintext column, no weaker algorithm for speed.

#### Determinism

- **FR-017**: With no flags, two runs against two freshly migrated databases MUST produce identical
  generated identities.
- **FR-018**: The seed MUST offer an explicit way to generate varying data instead, and MUST state
  clearly when it has done so.
- **FR-019**: Re-running the seed MUST NOT duplicate identities.

#### Usability

- **FR-020**: The seed MUST be a separate command from `seed:dev`, which MUST continue to behave
  exactly as it does today.
- **FR-021**: The volume of generated data MUST be adjustable without editing code.
- **FR-022**: The seed MUST report what it created, in enough detail to tell a successful run from
  one that silently did nothing.
- **FR-023**: Generated names, cities and organisations SHOULD read as German and European, matching
  the club the platform serves.

#### Content and activity (added 2026-09-17, on explicit instruction)

- **FR-024**: ~~No offers, redemptions, entitlements, events or approval submissions are seeded.~~
  **Amended.** The seed MUST populate merchant offers and club events, which means building those
  tables. Both are specified in `BUSINESS_DESCRIPTION.md` — events in §4, offers and redemption in
  §5 — so neither schema is invented for the seeder's convenience.
- **FR-026**: The seed MUST create offers spanning their whole lifecycle: draft, published, expired,
  and at least one whose organisation is suspended — so an offer's visibility can be seen to depend
  on more than its own state.
- **FR-027**: Every offer MUST show a real advantage. Where both prices are present the member price
  MUST be below the regular price, enforced by the database rather than by the generator.
- **FR-028**: The seed MUST create redemptions against published offers, with member feedback on
  some of them, so the merchant analytics screens have something to compute.
- **FR-029**: The seed MUST create events spanning their state machine — not opened, open, closed,
  and past — with registrations against the open and past ones.
- **FR-030**: At least one event MUST be at capacity, so the full-event path is visible.
- **FR-031**: Event registrations MUST respect the once-per-member rule and the capacity limit,
  enforced by the database.

#### Which tables are seeded

- **FR-032**: The seed MUST populate every table that holds configuration or domain state.
- **FR-033**: The seed MUST populate history tables — the audit log, job runs, campaign delivery —
  **only with entries that correspond to a seeded fact**. A locked member gets the audit entry that
  locked them, at the timestamp their status changed. No invented history.
- **FR-034**: The seed MUST NOT write to `sessions`, `refresh_tokens`, `otp_challenges` or
  `password_reset_tokens`. Those hold live credentials, created by signing in; a seeded session is a
  valid credential nobody authenticated for.
- **FR-035**: The seed MUST report which tables it populated and which it deliberately did not, so
  "all the tables" is a checkable claim rather than an assumption.

#### Out of scope

- **FR-025**: No production or staging database is addressed by this feature in any way.
- **FR-036**: No approval-submission machinery is seeded. `submissions` does not exist and is
  feature 003's US7; offers carry their own published state, which is enough to see them.

### Key Entities

- **Identity kind**: One of member, staff, club merchant, corporate club partner.
- **Role**: A named, credentialed example of an identity kind — "staff with SEO only", "suspended
  merchant owner". A role is what a credentials-table row describes.
- **Organisation**: A club merchant or corporate club partner, with a contract, a status and people.
- **Organisation person**: Someone who signs in on an organisation's behalf, holding a role within
  it.
- **Credential set**: The table of role → email → password the seed prints.
- **Generation seed**: The constant that makes the generated data reproducible.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every role in the printed credentials table signs in successfully; an automated check
  proves it for all of them.
- **SC-002**: Every member status and every credential state is present in the seeded population,
  proven by an automated check rather than by inspection.
- **SC-003**: Two seed runs against fresh databases produce identical identities, proven by
  comparing them.
- **SC-004**: Re-running the seed changes no row count and no credential.
- **SC-005**: An automated check proves no generated email or phone number is routable.
- **SC-006**: An automated check proves the seed refuses to run outside development.
- **SC-007**: An automated check proves the six fixed `seed:dev` accounts are unchanged after a
  demo seed, and that `seed:dev` still works.
- **SC-008**: A credential for one identity kind is refused by every route belonging to another,
  proven across all four kinds.
- **SC-009**: An organisation principal cannot read another organisation's data.
- **SC-010**: The seed completes in a time that makes it usable as part of a normal setup, and the
  time is reported.
- **SC-011**: Every offer state and every event state is present in the seeded data, proven by an
  automated check.
- **SC-012**: An automated check proves no seeded offer has a member price at or above its regular
  price, and that the database refuses one that does.
- **SC-013**: An automated check proves no member is registered twice for the same event, and that
  the database refuses a duplicate.
- **SC-014**: An automated check enumerates every table in the schema and asserts each is either
  populated or on the named do-not-seed list — so "all the tables" cannot quietly become "most".
- **SC-015**: An automated check proves `sessions`, `refresh_tokens`, `otp_challenges` and
  `password_reset_tokens` are untouched by the seed.

## Assumptions

- Development machines only. There is no scenario in which this runs anywhere shared.
- The generated population is for looking at and clicking through, not for load testing. Hundreds
  of rows, not millions.
- German and European names suit the club; a mixture including international members matches the
  product description better than an exclusively German one.
- The organisation tables this feature adds follow feature 003's `data-model.md` §1 as specified,
  so that 003's US5 and US6 can build on them rather than around them.
- The six fixed `seed:dev` accounts remain the accounts the automated suites and quickstart
  scenarios use. This feature's data is additive and no test depends on it.
- Passwords are chosen for memorability rather than strength, since publishing them is the point.

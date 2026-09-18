---

description: "Task list for 003-web-console"
---

# Tasks: GWC Web Console

**Input**: Design documents from `/specs/003-web-console/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Included. The specification requires them — SC-002 through SC-012 are each stated as an
automated check — and the constitution's Development Workflow section makes "every principle is
verifiable" a gate rather than a preference. Per the repository's existing convention, a test that
would pass against a console that rendered everything to everyone is not a test: each gate task
below names its counter-assertion.

**Organization**: Grouped by user story. Phases 3-6 and 8-10 are the story phases; phase 7 is an
explicit shared prerequisite for the three P3 stories, called out rather than hidden inside US5.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US7)
- Exact file paths are given in every task

## Path Conventions

Three existing npm workspaces, per plan.md: `server/`, `client/`, `packages/contracts/`. No new
workspace is created.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The design system and the request/refusal layer every surface depends on.

- [X] T001 Add `react-router` (data router) to `client/package.json` dependencies and run install from repo root
- [X] T002 [P] Create `client/src/styles/theme.css` with the `@theme` token block exactly as specified in `specs/003-web-console/contracts/design-tokens.md` (colour, `--font-sans`, spacing, radius)
- [X] T003 [P] Extract the GWC logo from `German_World_Club_Digital_Plattform.docx` (`word/media/image1.png`, 844×578) to `client/public/gwc-logo.png`, unmodified per FR-010
- [X] T004 [P] Create `packages/contracts/src/capabilities.js` with the Zod schema for the capability response defined in `contracts/capability-api.md`, and export it from `packages/contracts/package.json`
- [X] T005 [P] Create `client/src/lib/problems.js` mapping RFC 9457 `type` values from `@gwc/contracts/errors` to German user-facing copy, branching on `type` only and never on `detail` (FR-018)
- [X] T006 Create `client/src/lib/api.js`: a fetch wrapper sending cookies, parsing `application/problem+json`, distinguishing 429 (retryable) from a quota problem (not retryable) and 503 deadline (retryable) per FR-019
- [X] T007 [P] Create `client/scripts/check-tokens.mjs` scanning `client/src/**` for hex literals and Tailwind arbitrary colour values (`bg-[#…]`, `text-[#…]`) not present in `theme.css`, and wire it as `test:tokens` in `client/package.json`
- [X] T008 [P] Create `client/tests/tokens.test.js` asserting `check-tokens.mjs` passes on the tree — counter-assertion: a fixture containing a hard-coded `#123456` must fail it (SC-005)
- [X] T009 [P] Create `client/src/i18n/de.js` holding all German UI copy as a flat keyed module, and `client/src/lib/format.js` wrapping `Intl` for `de-DE` dates, numbers and currency (FR-014)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The server-side route posture and the component vocabulary from the mockups.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T010 Add a `/konsole/*` SPA fallback scope in `server/src/app.js` registering an encapsulated scope with a scope-level `onRoute` hook declaring `{ auth: { audience: 'public' }, budget: 'public-page', produces: 'text/html' }`, serving only the built client shell — leaving `@fastify/static`'s `wildcard: false` untouched (research R9)
- [X] T011 Declare the `/konsole` prefix as gated and never-indexed in `server/src/seo/surfaces.js` so `X-Robots-Tag: noindex, nofollow` and the `robots.txt` disallow both follow from one declaration (Principle II)
- [X] T012 Create `server/tests/console/spa-fallback.test.js`: `/konsole/admin/beliebig` serves the shell with `noindex`; counter-assertion — `/gibt-es-nicht` and `/events/gibt-es-nicht` still return a real 404, and the shell response body contains no member content of any kind
- [X] T013 [P] Create `client/src/components/ui/Card.jsx` — white surface, hairline border, 8px radius, no shadow, optional `card-title` (per `contracts/design-tokens.md`)
- [X] T014 [P] Create `client/src/components/ui/KpiTile.jsx` — `--color-ground` fill, hairline border, navy 28px numeral over an 11px muted caption
- [X] T015 [P] Create `client/src/components/ui/StatusPill.jsx` — tint background with a matching darker label; the label text is required, never colour alone
- [X] T016 [P] Create `client/src/components/ui/Callout.jsx` — tinted background with a 4px left rule, variants gold / neutral / emphatic (ink)
- [X] T017 [P] Create `client/src/components/ui/Button.jsx` — primary (navy fill, white label), accent (gold fill, ink label), secondary (white fill, hairline border)
- [X] T018 [P] Create `client/src/components/ui/DataTable.jsx` — `--color-ground` header row, 11px uppercase headers, hairline row rules, no zebra
- [X] T019 [P] Create `client/src/components/ui/PageHeader.jsx` — title, subtitle, and the 3px `--color-accent` rule beneath the header
- [X] T020 Create `client/tests/a11y/components.test.jsx` running `axe-core` over every component from T013-T019 against both `#FFFFFF` and `#171B20` backgrounds, asserting zero violations (SC-006)
- [X] T021 Set `<html lang="de">` and mount the router for the console — **done in `client/konsole.html` + `client/src/konsole.jsx`, a second Vite entry, NOT in `index.html`/`main.jsx` as originally written.** `index.html` is the public Experts Circle coming-soon page: English, indexed, a different brand palette. Setting `lang="de"` on it would have mislabelled that page's language for every screen reader and crawler, and mounting the console there would have made the public page carry the console bundle.

**Checkpoint**: Tokens, components and the server route posture are in place; no console screen exists yet.

---

## Phase 3: User Story 1 - Capability-scoped console (Priority: P1) 🎯 MVP

**Goal**: A staff member signs in and reaches an Admin Panel whose navigation contains exactly the
modules their grants allow.

**Independent Test**: Sign in as accounts with three different grant sets and compare the rendered
navigation against the grants each holds; sign in as an account with no grants at all.

### Tests for User Story 1

- [X] T022 [P] [US1] Create `server/tests/authz/any-staff-posture.test.js`: a route declaring `{ audience: 'staff', anyStaff: true }` boots; counter-assertions — a staff route declaring neither module nor `anyStaff` still fails startup, and `anyStaff` together with a module or flag is itself a declaration error
- [X] T023 [P] [US1] Create `server/tests/auth/session-capabilities.test.js`: `GET /auth/session` answers a staff principal holding only `seo.read`; counter-assertions — an anonymous request is refused, a member token is refused as wrong-audience, and the response omits modules where every flag is false
- [X] T024 [P] [US1] Create `client/tests/capability-matrix.test.jsx` walking every module/flag pair: the surface renders for a holder **and does not render for a non-holder** (SC-002)
- [X] T025 [P] [US1] Create `client/tests/refusals.test.jsx`: a 403 on navigation re-fetches capabilities and renders the refusal; a `SESSION_REVOKED` returns to sign-in preserving unsaved input; an unknown problem `type` renders its `title` (SC-003)
- [X] T026 [P] [US1] Create `client/tests/no-registration.test.jsx` asserting no route, link or form in the console reaches sign-up, application, account creation or waiting-for-approval (SC-004, FR-002)

### Implementation for User Story 1

- [X] T027 [US1] Extend `validateAuthConfig` in `server/src/plugins/11-rbac.js` to accept a staff route omitting module and flag **only** when it declares `anyStaff: true`, and to reject `anyStaff` alongside a module or flag — silence still fails (research R3)
- [X] T028 [US1] Add `GET /auth/session` to `server/src/auth/routes.js` declared `{ audience: 'staff', anyStaff: true, budget: 'member-read' }`, resolving the snapshot through `app.permissions.resolve()` at request time, responding `no-store`, with the response schema from `@gwc/contracts/capabilities`
- [X] T029 [US1] Add the `available` module list to the `/auth/session` response in `server/src/auth/routes.js`, derived from the routes the server actually registers rather than a hard-coded array, so the client cannot drift from the server (SC-001)
- [X] T030 [P] [US1] Create `client/src/auth/SignIn.jsx` — one sign-in screen for all principal kinds; the server answers with the principal kind and the client routes on it, so the user is never asked to pick a portal
- [X] T031 [P] [US1] Create `client/src/auth/PasswordReset.jsx` covering request and confirm against the existing `/auth/password-reset/*` routes — and nothing else (FR-001, FR-002)
- [X] T032 [US1] Create `client/src/lib/capabilities.js`: fetch `/auth/session`, expose the snapshot, re-fetch after any 403, clear on sign-out, and render an error state rather than a hard-coded default when the fetch fails
- [X] T033 [US1] Create `client/src/console/ConsoleShell.jsx` — dark `--color-ink` sidebar, page header, KPI row and card grid, per the page-10 mockup
- [X] T034 [US1] Create `client/src/console/Sidebar.jsx` deriving items from the capability snapshot on every render, marking the active item with `--color-navy` and the 4px gold left rule, and rendering "noch nicht verfügbar" for a held module absent from `available`
- [X] T035 [US1] Create `client/src/console/RequireGrant.jsx` — named and commented as a **display** gate, not an authorization gate; the server re-checks every operation (FR-004)
- [X] T036 [US1] Create `client/src/console/EmptyState.jsx` and wire it for a principal holding no grants — an explicit empty state, not an error and not a blank page
- [X] T037 [US1] Create `client/src/console/admin/AdminLayout.jsx` with the page-10 sidebar list, each entry gated by `RequireGrant` per `contracts/console-surfaces.md`
- [X] T038 [US1] Add `/konsole` routes in `client/src/main.jsx` for sign-in, password reset, and the four portal layouts, redirecting on principal kind

**Checkpoint**: A correctly scoped console with honest empty states. This is the MVP.

---

## Phase 4: User Story 2 - SEO editing under read vs. edit (Priority: P1)

**Goal**: A `seo.edit` holder edits a record's SEO metadata; a `seo.read` holder sees the same
values with no editable control.

**Independent Test**: Edit as an `edit` holder and confirm the public page serves the change;
repeat as a `read` holder and confirm the form is read-only and a submitted change is refused.

### Tests for User Story 2

- [ ] T039 [P] [US2] Create `client/tests/console/seo-editor.test.jsx`: the form saves for `seo.edit`; counter-assertion — for `seo.read` the save control is **absent, not disabled** (FR-017)
- [ ] T040 [P] [US2] Extend `server/tests/authz/matrix.test.js` coverage assertions to confirm `PATCH /admin/seo/:recordType/:recordId` is refused for a `seo.read`-only principal

### Implementation for User Story 2

- [ ] T041 [US2] Create `client/src/console/admin/seo/SeoList.jsx` listing records with SEO metadata, using `DataTable`
- [ ] T042 [US2] Create `client/src/console/admin/seo/SeoEditor.jsx` reading `GET /admin/seo/:recordType/:recordId` and writing `PATCH`, with title, description, slug and share image
- [ ] T043 [US2] Render `client/src/console/admin/seo/SeoEditor.jsx` read-only when the capability snapshot lacks `seo.edit`, omitting every submitting control rather than disabling it
- [ ] T044 [US2] Surface the `PATCH` refusal in `SeoEditor` without discarding entered values, using `client/src/lib/problems.js`

**Checkpoint**: US1 and US2 both work independently. The console is now genuinely useful to SEO staff.

---

## Phase 5: User Story 3 - Push campaigns (Priority: P2)

**Goal**: A `mass_messages.write` holder composes, previews and sends a push campaign.

**Independent Test**: Compose, preview and send to the seeded test-recipient set without touching
real members.

### Tests for User Story 3

- [ ] T045 [P] [US3] Create `client/tests/console/push-campaign.test.jsx`: preview shows the server-computed recipient count; counter-assertion — for `mass_messages.read` only, no compose or send control renders
- [ ] T046 [P] [US3] Create `client/tests/console/quota-vs-ratelimit.test.jsx`: a 429 offers a retry with a time; a quota refusal offers **no retry** (FR-019)

### Implementation for User Story 3

- [ ] T047 [P] [US3] Create `client/src/console/admin/push/CampaignList.jsx` against `GET /push/campaigns`
- [ ] T048 [US3] Create `client/src/console/admin/push/CampaignCompose.jsx` against `POST /push/campaigns/preview` and `POST /push/campaigns`, showing the recipient count the server returned
- [ ] T049 [US3] Add a confirmation step before send in `CampaignCompose.jsx` — an outward-facing action (FR-020)
- [ ] T050 [P] [US3] Create `client/src/console/admin/push/TestRecipients.jsx` against the `/push/test-recipients` routes, gated on `mass_messages.edit`

**Checkpoint**: Three of the nineteen modules are live — every module with a server API today.

---

## Phase 6: User Story 4 - Member profile and field visibility (Priority: P2)

**Goal**: A member views and edits their profile and controls, field by field, what others see.

**Independent Test**: Sign in as a member, edit the profile, mark a field private, and fetch that
profile as a second member **over the API** — the field must be absent from the JSON.

### Tests for User Story 4

- [ ] T051 [P] [US4] Create `server/tests/members/field-visibility.test.js`: a field marked private is **absent from the response body**; counter-assertion — the same field is present when marked visible, so the test cannot pass against a serializer that omits everything (FR-034)
- [ ] T052 [P] [US4] Create `server/tests/members/connections.test.js`: a direct message is refused without an `accepted` connection; counter-assertion — it succeeds once accepted (FR-036)
- [ ] T053 [P] [US4] Create `client/tests/console/member-profile.test.jsx` covering profile edit and visibility controls

### Implementation for User Story 4

- [ ] T054 [US4] Create `server/migrations/017_member_profiles.sql` with `member_profiles`, `member_field_visibility`, `connections` and `value_ledger_entries` per `data-model.md` §5, including the unordered-pair unique index and the `requester_id <> addressee_id` constraint
- [ ] T055 [P] [US4] Create `packages/contracts/src/members.js` with profile, visibility, connection and ledger schemas
- [ ] T056 [US4] Create `server/src/members/routes.js` with `GET`/`PATCH /members/me/profile` and `GET`/`PUT /members/me/visibility`, declared `{ audience: 'member' }` with budgets and response schemas
- [ ] T057 [US4] Implement visibility-driven omission in the response schemas in `packages/contracts/src/members.js` and their use in `server/src/members/routes.js`, so a private field is structurally absent rather than filtered late (Principle VI)
- [ ] T058 [US4] Add `GET /members/:id` to `server/src/members/routes.js` applying the viewer's relationship to the subject when resolving field visibility
- [ ] T059 [US4] Add connection request, accept, decline and block endpoints to `server/src/members/routes.js`, enforced against the loaded target inside the transaction
- [ ] T060 [US4] Add `GET /members/me/value-ledger` to `server/src/members/routes.js` computing the aggregate from `value_ledger_entries` — never a stored total
- [ ] T061 [P] [US4] Create `client/src/console/member/MemberLayout.jsx` and `Home.jsx` per the page-5 mockup
- [ ] T062 [P] [US4] Create `client/src/console/member/Profile.jsx` including the "Ich kann helfen bei" and "Ich suche" fields
- [ ] T063 [P] [US4] Create `client/src/console/member/Visibility.jsx` for per-field visibility
- [ ] T064 [P] [US4] Create `client/src/console/member/ValueLedger.jsx` showing savings, resolved cases, introductions and events

**Checkpoint**: Members have a reason to sign in. US1-US4 each work independently.

---

## Phase 7: Shared Prerequisites for US5-US7

**Purpose**: The organisation principals and the approval mechanism. US5, US6 and US7 all depend on
this phase; it is stated separately rather than buried in US5 so the dependency is visible.

**⚠️ BLOCKS**: User Stories 5, 6 and 7.

**Status: unblocked.** Feature 005 (`005-demo-seed`) built the organisation principals to seed them
— migrations 013–016, the `merchant`/`partner` audiences, sign-in over the existing session
machinery, `guardOrganisationScope`, and the merchant/partner domain tables (`merchant_locations`,
`offers`, `redemptions`, `redemption_feedback`, `events`, `event_registrations`). US5 and US6 now
build portals over tables that exist and hold data, rather than starting from an empty schema.
What remains from this phase is the approval mechanism and the three partner tables in T101.

### Tests

- [ ] T065 [P] Create `server/tests/authz/organisation-scoping.test.js`: a merchant principal reaches only their own organisation's rows; counter-assertion — a request for another organisation's row is refused identically to a request for a row that does not exist (FR-007)
- [ ] T066 [P] Create `server/tests/submissions/approval-flow.test.js` walking draft → pending → changes_requested → pending → approved, asserting a decision references the version it was made on
- [ ] T067 [P] Create `server/tests/submissions/audit-immutability.test.js`: `UPDATE` and `DELETE` on `submission_decisions` are refused by revoked grants, not by application code (SC-009)

### Implementation

- [X] T068 Add `merchant` and `partner` to `AUDIENCES` and `TOKEN_AUDIENCES` in `packages/contracts/src/permissions.js` — **delivered by feature 005** (005/T019, T020). Also in `10-auth.js`'s `TOKEN_AUDIENCE` map, so the isolation is the existing mechanism extended rather than a parallel one
- [ ] T069 Add `merchant` and `partner` to the `TOKEN_AUDIENCE` map in `server/src/plugins/10-auth.js` so a credential for one kind can never satisfy a route for another
- [X] T070 Create `server/migrations/013_organisations.sql` with `organisations` and `organisation_users` per `data-model.md` §1, including the kind/count constraints, the `(id, kind)` unique index for composite foreign keys, the last-active-owner trigger and the refuse-delete trigger — **delivered by feature 005** as `014_organisations.sql`, because `013` had to be the enum-only migration: a new `account_kind` value cannot be used in the transaction that adds it. Constraints proved by violation in `server/tests/seed/organisation-constraints.test.js`
- [ ] T071 [P] Create `packages/contracts/src/organisations.js` with organisation, organisation-user and entitlement schemas
- [ ] T072 Add an organisation-scoping object guard to `server/src/authz/object-guards.js` enforcing `organisation_id` against the loaded target inside the transaction
- [ ] T073 Extend `GET /auth/session` in `server/src/auth/routes.js` to answer merchant and partner principals with `organisationId`, `role` and organisation status, branching on the verified token audience only
- [ ] T074 Extend sign-in in `server/src/auth/routes.js` to authenticate `organisation_users` over the existing session and refresh machinery, with the same one-active-session rule
- [ ] T075 Create `server/migrations/014_submissions.sql` with `submissions`, `submission_versions` and `submission_decisions` per `data-model.md` §2, including the unique open submission per subject, the `(submission_id, version)` foreign key, the comment-required constraint and revoked `UPDATE`/`DELETE` grants
- [ ] T076 [P] Create `packages/contracts/src/submissions.js` with submission, version and decision schemas
- [ ] T077 Create `server/src/submissions/routes.js` with submit, withdraw and decide endpoints, each declaring the module from the submission's `required_module`, writing to `audit_log` on every transition
- [ ] T078 [P] Create `client/src/console/shared/SubmissionQueue.jsx` rendering a queue with the member-facing preview and the approve / request-changes / reject decisions
- [ ] T079 [P] Create `client/src/console/shared/SubmissionHistory.jsx` showing prior versions and decision comments

**Checkpoint**: Merchant and partner principals exist and can be scoped; the approval mechanism is shared.

---

## Phase 8: User Story 5 - Merchant offers through approval (Priority: P3)

**Goal**: A merchant creates an offer, submits it, and it reaches members only after staff approval.

**Independent Test**: Create an offer, confirm it is invisible to members, approve it as staff,
confirm it becomes visible and its redemptions accrue.

### Tests for User Story 5

- [ ] T080 [P] [US5] Create `server/tests/merchant/offer-constraints.test.js`: a member price at or above the regular price is refused **by the database**; counter-assertion — a valid pair is accepted (the design document's merchant rule 1)
- [ ] T081 [P] [US5] Create `server/tests/merchant/offer-visibility.test.js`: an unapproved offer is invisible to members; an approved offer outside its validity window is also invisible, with no job having run (FR-025)
- [ ] T082 [P] [US5] Create `server/tests/privacy/no-member-leakage.test.js` scanning every response to a merchant or partner principal for identifiable member data (SC-008) — counter-assertion: a deliberately leaky fixture route must fail it
- [ ] T083 [P] [US5] Create `client/tests/console/merchant-portal.test.jsx` covering offer creation, submission and the absence of any member-list surface (FR-027)

### Implementation for User Story 5

- [ ] T084 [US5] Create `server/migrations/015_merchant_domain.sql` with `merchant_locations`, `offers`, `redemptions` and `redemption_feedback` per `data-model.md` §3, including the price, percentage and validity-window constraints and the unique redemption `reference`
- [ ] T085 [P] [US5] Create `packages/contracts/src/offers.js` with offer, redemption and feedback schemas
- [ ] T086 [US5] Create `server/src/merchant/routes.js` with profile, locations and products endpoints, declared `{ audience: 'merchant' }` and scoped by the T072 guard
- [ ] T087 [US5] Add offer create, update and submit endpoints to `server/src/merchant/routes.js`, routing submission through `server/src/submissions/routes.js`
- [ ] T088 [US5] Add the member-facing benefits endpoints to `server/src/members/routes.js`, with visibility as a query predicate over `published_at`, organisation status and the validity window
- [ ] T089 [US5] Add redemption and feedback endpoints to `server/src/merchant/routes.js`, using the deterministic `reference` so a retry cannot duplicate the effect, and appending a `saving` row to `value_ledger_entries`
- [ ] T090 [US5] Add aggregate merchant analytics endpoints to `server/src/merchant/routes.js`, shaped so no member identity can be present
- [ ] T091 [P] [US5] Create `client/src/console/merchant/MerchantLayout.jsx` with the page-8 sidebar
- [ ] T092 [P] [US5] Create `client/src/console/merchant/Dashboard.jsx` — Einlösungen, Mitgliederwert, bestätigter Vorteil, Qualität
- [ ] T093 [US5] Create `client/src/console/merchant/OfferForm.jsx` making regular price, GWC price, availability, locations, validity and conditions required rather than optional (FR-028)
- [ ] T094 [P] [US5] Create `client/src/console/merchant/Offers.jsx` with the Freigabestatus table
- [ ] T095 [P] [US5] Create `client/src/console/merchant/Analytics.jsx` and `Leads.jsx`, aggregate only
- [ ] T096 [P] [US5] Create `client/src/console/member/Benefits.jsx` showing each offer's regular price, GWC price, validity, locations and conditions
- [ ] T097 [US5] Add the `marketplace_moderation` queue to `client/src/console/admin/` using `SubmissionQueue`, rendering the member-facing preview rather than a raw form

**Checkpoint**: The merchant loop works end to end — create, approve, redeem, feed back.

---

## Phase 9: User Story 6 - Partner entitlements and recruiting (Priority: P3)

**Goal**: A corporate partner manages employee entitlements and publishes vacancies through approval.

**Independent Test**: Invite an employee, confirm no membership was created, publish a vacancy
through approval, and read aggregate activation analytics.

### Tests for User Story 6

- [ ] T098 [P] [US6] Create `server/tests/partner/entitlement-is-not-membership.test.js` asserting that creating and activating an entitlement inserts **no row into `members`**; counter-assertion — a genuine member signup fixture does insert one (FR-030)
- [ ] T099 [P] [US6] Create `server/tests/partner/entitlement-quota.test.js`: activation past the contracted `employee_count` is refused as a quota under concurrent requests, not as a rate limit
- [ ] T100 [P] [US6] Create `client/tests/console/partner-portal.test.jsx` asserting no membership vocabulary is used for an employee anywhere in the portal

### Implementation for User Story 6

- [X] T101 [US6] Create `server/migrations/016_partner_domain.sql` with `employee_entitlements`, `vacancies` and `partner_articles` per `data-model.md` §§1,4, including the composite foreign key onto `(organisations.id, kind)` that makes attaching an entitlement to a merchant impossible — **partially delivered by feature 005**: the `UNIQUE (organisations.id, kind)` index the composite key depends on exists and is asserted (005/T018). The three partner tables themselves are still to build; the index is what they were blocked on
- [ ] T102 [US6] Create `server/src/partner/routes.js` with profile and entitlement endpoints, declared `{ audience: 'partner' }` and scoped by the T072 guard
- [ ] T103 [US6] Enforce the entitlement count against the contracted `employee_count` through `server/src/db/counters.js` under a row lock — exact under concurrency, surviving a Redis flush
- [ ] T104 [US6] Add vacancy and article endpoints to `server/src/partner/routes.js`, routing publication through `server/src/submissions/routes.js`
- [ ] T105 [US6] Add aggregate partner analytics endpoints to `server/src/partner/routes.js`, shaped so no employee is individually identifiable
- [ ] T106 [P] [US6] Create `client/src/console/partner/PartnerLayout.jsx` with the page-9 sidebar
- [ ] T107 [P] [US6] Create `client/src/console/partner/Overview.jsx` with the four KPI tiles and the "Keine Mitgliedschaft" ink callout from the mockup — part of the screen, not decoration
- [ ] T108 [P] [US6] Create `client/src/console/partner/EmployeeAccess.jsx` for invite, revoke and the count against contract
- [ ] T109 [P] [US6] Create `client/src/console/partner/Recruiting.jsx` and `NewsPr.jsx` submitting through approval
- [ ] T110 [P] [US6] Create `client/src/console/partner/Analytics.jsx`, aggregate only
- [ ] T111 [US6] Add the `partners` queue to `client/src/console/admin/` using `SubmissionQueue`

**Checkpoint**: Both organisational portals work, and neither can reach member identity.

---

## Phase 10: User Story 7 - Governance and audit (Priority: P3)

**Goal**: Staff act on every approval queue, and every decision is recorded immutably.

**Independent Test**: Submit content as merchant and partner, act on it in each queue, and confirm
the audit record is complete and cannot be altered.

### Tests for User Story 7

- [ ] T112 [P] [US7] Create `server/tests/submissions/decision-audit.test.js` asserting actor, timestamp, decision and the **version decided on** are all retrievable; counter-assertion — a decision cannot reference a version that never existed
- [ ] T113 [P] [US7] Create `client/tests/console/approval-preview.test.jsx` asserting the reviewer sees the member-facing preview rather than a raw form (FR-023)

### Implementation for User Story 7

- [ ] T114 [US7] Create `client/src/console/admin/Dashboard.jsx` composing the four KPI tiles and the three queue cards of the page-10 mockup from live counts
- [ ] T115 [US7] Add `GET /admin/audit` to `server/src/ops/` declared `{ audience: 'staff', module: 'settings', flag: 'read' }` with filtering by actor, subject and date
- [ ] T116 [P] [US7] Create `client/src/console/admin/AuditLog.jsx` against `GET /admin/audit`
- [ ] T117 [US7] Add a confirmation step to every decision control in `SubmissionQueue.jsx` (FR-020)
- [ ] T118 [P] [US7] Create `client/src/console/admin/TrustSafety.jsx` surfacing moderation, complaints, consent and rate-limit state as read-only views over existing data

**Checkpoint**: All seven user stories are independently functional.

---

## Phase 11: Remaining Modules

**Purpose**: The modules from `contracts/console-surfaces.md` still marked "Missing", so SC-001's
"working or visibly marked unavailable" resolves toward working.

- [ ] T119 [P] Add `server/src/members/admin-routes.js` with member administration endpoints under the `members` module, honouring the existing refuse-delete rule
- [ ] T120 [P] Create `client/src/console/admin/members/` screens against T119
- [ ] T121 [P] Add roles and permissions endpoints under the `admins` module in `server/src/`, preserving the last-active-superadmin guard
- [ ] T122 [P] Create `client/src/console/admin/roles/PermissionEditor.jsx` rendering its matrix from `@gwc/contracts/permissions` so a module cannot exist in the UI but not the server
- [ ] T123 [P] Add `server/migrations/018_events.sql` and `server/src/events/routes.js` under the `events` and `event_registrations` modules, with capacity enforced by constraint
- [ ] T124 [P] Create `client/src/console/admin/events/` screens against T123
- [ ] T125 [P] Add a jobs read/status surface in `server/src/ops/jobs-routes.js` over the existing `job_definitions` and `job_runs` tables under the `jobs` module
- [ ] T126 [P] Create `client/src/console/admin/Jobs.jsx` against T125

---

## Phase 3b: Public Landing Page (added 2026-09-17, on explicit instruction)

**Purpose**: Remove the Experts Circle / German Emirates Club brand entirely and replace `/` with a
GWC landing page carrying the route into the console.

**Scope change**: FR-038 previously placed the public website out of scope. The user amended that
directly. The deeper public site — city pages, event listings, member directory, expert profiles —
is still out of scope; only the landing page is in.

**Independent Test**: Fetch `/` with JavaScript disabled and confirm the whole page is there, that
it names the German World Club and nothing else, and that its sign-in link reaches the console.

- [X] T135 Delete every Experts Circle source file: `client/src/components/{About,Contact,Countdown,Hero,Offering,BrandMark,VisuallyHidden}.jsx`, `client/src/config/`, `client/src/hooks/`, `client/src/lib/countdown.js`, `client/src/App.jsx`, `client/src/main.jsx`, `client/src/index.css`, `client/sample-html.html`, `client/public/og-image.png`
- [X] T136 Delete the matching suites: `client/tests/{components,config,hooks,lib}/` and `client/tests/a11y/page.test.jsx`
- [X] T137 Rewrite `client/index.html` as a static GWC landing page — content from `German_World_Club_Digital_Plattform.docx` pages 1-2, styling inline, no script tag, so it renders with no JavaScript (Constitution "Public rendering")
- [X] T138 Add the sign-in section to `client/index.html` at `#anmeldung`, routing every principal kind to `/konsole/anmelden` with no account-creation affordance (FR-002, FR-042, FR-043)
- [X] T139 Remove the `async-css` plugin from `client/vite.config.js` — it existed only for the old React boot shell, and the landing page now needs no external stylesheet
- [X] T140 Extend `client/scripts/check-tokens.mjs` to compare `index.html`'s inline `:root` palette against `src/styles/theme.css` value by value, so the deliberate duplication cannot drift (FR-044)
- [X] T141 Rename the RFC 9457 problem namespace in `packages/contracts/src/errors.js` from `german-emirates-club.com` to `german-world-club.com`, and update `client/tests/helpers/console.jsx` to match
- [X] T142 Create `client/tests/landing.test.js`: no script tag, no stylesheet, real content in the raw file, the five masterplan tiers, the console route, and no trace of the old brand — with the counter-assertion that the file is not simply empty
- [X] T143 Extend `client/tests/no-registration.test.jsx` to scan `index.html` and `konsole.html`, since the landing page is where a "Mitglied werden" button would most naturally be added
- [X] T144 Replace the Experts Circle string in `server/tests/seo/soft-404.test.js` with a phrase only the new landing page carries, so the soft-404 check keeps working
- [X] T145 Record the scope change in `specs/003-web-console/spec.md` (FR-038 amended, FR-040 to FR-044 added) and resolve `PROJECT_NAME_CONFLICT` in `.specify/memory/constitution.md` as a PATCH to 1.0.1

**Checkpoint**: `/` is the GWC landing page, rendering without JavaScript, and the console is one click away.

---

## Phase 3c: Sign-in and Password Reset, Completed (added 2026-09-17)

**Purpose**: Make the two unauthenticated screens actually work, and supply the server endpoints
they turned out to need.

**What this phase found**: the endpoints mostly existed, but three defects made the console
unusable over real HTTP, and none of them could be seen from `app.inject`.

**Independent Test**: Run the server, `npm run -w server seed:dev`, and sign in at
`/konsole/anmelden` as each seeded account; complete a password reset end to end.

- [X] T146 Create `server/tests/auth/console-sign-in.test.js` pinning all five `POST /auth/sign-in` outcomes, the sign-out posture and the reset flow, with counter-assertions that a 200 carrying no session is not a session
- [X] T147 Fix `POST /auth/staff/sign-out` in `server/src/auth/routes.js`: it required `settings.read`, so a staff member holding only `seo.read` could sign in and then be refused when trying to leave. Now `anyStaff` — ending your own session cannot depend on a grant somebody else controls
- [X] T148 Update `server/tests/authz/matrix.test.js` for the new posture and widen the exemption assertion to exactly two routes, both about the caller's own session
- [X] T149 **Fix the deadline signal in `server/src/plugins/12-deadline.js`.** It composed `AbortSignal.any([timeout, request.signal])`; Fastify's `request.signal` aborts when the request body finishes being read, which is *before* the handler runs — so over real HTTP every POST with a JSON body answered 503. Now composed from the timeout plus a controller aborted only by `onRequestAbort`
- [X] T150 Create `server/tests/ops/deadline-over-http.test.js`, which listens on a real port, because `app.inject` never emits the event that hid T149. Includes the counter-assertion that a genuinely slow handler is still cut off
- [X] T151 Add `GET /auth/csrf` in `server/src/auth/routes.js`. CSRF double-submit was configured but nothing ever called `reply.generateCsrf()`, so every cookie-borne write was refused with "Missing csrf secret" — the check working correctly against a client with no way to satisfy it
- [X] T152 Add `PROBLEMS.CSRF_TOKEN_INVALID` in `packages/contracts/src/errors.js` and map `FST_CSRF_*` onto it in `server/src/plugins/14-error-handler.js`, so a client can tell "fetch a fresh token and retry" from "you lack the grant" without branching on `detail`
- [X] T153 Add `PROBLEMS.INVALID_RESET_TOKEN` and use it in the reset-confirm handler. It shared `INVALID_REFRESH_TOKEN`, whose remedy is a sign-in — the one place that cannot help someone who has forgotten their password
- [X] T154 Teach `client/src/lib/api.js` to fetch, attach, cache and refresh the CSRF token, retrying exactly once on a stale one and failing soft if `/auth/csrf` is unreachable
- [X] T155 Rewrite `client/src/auth/SignIn.jsx` to switch on the outcome rather than on the status code, with a one-click remedy for `password_reset_required`
- [X] T156 Rewrite `client/src/auth/PasswordReset.jsx` as request and confirm steps, with confirmation matching, the documented minimum length, and an explicit branch for a link that carries no token
- [X] T157 [P] Add `client/src/components/ui/Field.jsx` (label, `aria-describedby`, `aria-invalid`) and `client/src/auth/AuthCard.jsx`, shared by both screens
- [X] T158 [P] Create `client/tests/console/auth-screens.test.jsx` covering every outcome, and extend `client/tests/refusals.test.jsx` with the CSRF cases
- [X] T159 Seed sign-in accounts in `server/src/scripts/seed-dev.js` (this is T127, pulled forward), with a guard that refuses to run outside `NODE_ENV=development`

**Checkpoint**: A seeded account can sign in through the browser, reach a capability-scoped console, sign out, and reset its password.

---

## Phase 3d: The Dev Server Reaches the Console (added 2026-09-17)

**Purpose**: Make the console reachable from the landing page when running `npm run dev`.

**What was wrong**: `client/vite.config.js` had no dev-server configuration at all, so Vite's
default `appType: 'spa'` answered every unmatched path with `/index.html`. `/konsole/anmelden`
returned **200 with the landing page** — clicking "Anmelden" reloaded the page you were already on
— and `/auth/*` fell through the same way, answering HTML to a JSON client. Production was
unaffected; this was development-only, which is why nothing caught it.

**Independent Test**: Run `npm run -w client dev`, open the Vite origin, and follow the landing
page's "Anmelden" link to the sign-in screen.

- [X] T160 Create `client/dev-server.js` with `consoleFallback()` and `apiProxy()` — the dev-time equivalents of the Fastify SPA fallback and same-origin API, exported separately so they can be asserted on
- [X] T161 Register both in `client/vite.config.js`. The middleware is added in `configureServer`'s **body**, not in a returned function: returning one defers registration until after Vite's own middlewares, by which point the SPA fallback has already rewritten the URL — which is exactly how the first attempt at this fix still failed
- [X] T162 Create `client/tests/dev-server.test.js`: unit assertions on the path logic, plus a **real Vite server** that follows every `/konsole` link on the landing page. A unit test could not have caught a middleware-ordering defect
- [X] T163 Update the Run section of `specs/003-web-console/quickstart.md` to say which origin to open, and to state the two jobs both origins must do and why same-origin matters for a cookie session

**Checkpoint**: `npm run dev` + `npm run -w server dev` gives a landing page whose sign-in link works, with the API on the same origin.

---

## Phase 12: Polish & Cross-Cutting Concerns

- [X] T127 [P] Add the seed accounts of `quickstart.md` to `server/src/scripts/seed-dev.js`, including `nogrants@test.invalid` — the counter-assertion account for the whole capability mechanism
- [ ] T128 [P] Create `client/tests/responsive.test.jsx` asserting no horizontal page scroll at 320px on every console screen (SC-011)
- [ ] T129 [P] Extend `client/tests/a11y/` to cover every completed screen, not only the components (SC-006)
- [ ] T130 Extend `server/src/scripts/verify-seo.js` to assert `/konsole/*` is `noindex` and that no member content reaches an anonymous requester (SC-010)
- [ ] T131 [P] Add the console to `server/src/plugins/15-openapi.js` tag list so new endpoints are documented by posture, not by a second set of annotations
- [ ] T132 [P] Update `CLAUDE.md` with the `anyStaff` posture, the `/konsole` SPA fallback and the organisation-scoping guard — the three things a future reader will otherwise get wrong
- [ ] T133 Run every scenario in `specs/003-web-console/quickstart.md` end to end and record the outcome
- [ ] T134 Resolve the open questions in `plan.md`: brand typeface (swap `--font-sans` in `client/src/styles/theme.css`) and the `/konsole` route prefix

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **blocks all user stories**
- **US1 (Phase 3)**: Depends on Phase 2. Blocks nothing structurally, but every other story's UI is unreachable without its shell and sign-in
- **US2 (Phase 4)**, **US3 (Phase 5)**, **US4 (Phase 6)**: Depend on Phase 2; each independently testable once US1's shell exists
- **Phase 7 (Shared prerequisites)**: Depends on Phase 2 — **blocks US5, US6, US7**
- **US5 (Phase 8)**: Depends on Phase 7
- **US6 (Phase 9)**: Depends on Phase 7
- **US7 (Phase 10)**: Depends on Phase 7; its queues need US5 and US6 to have produced something to approve
- **Phase 11, 12**: Depend on the stories they extend

### User Story Dependencies

- **US1 (P1)**: After Phase 2. No story dependencies.
- **US2 (P1)**: After Phase 2 + US1 shell. Independent of US3-US7.
- **US3 (P2)**: After Phase 2 + US1 shell. Independent of US2, US4-US7.
- **US4 (P2)**: After Phase 2 + US1 shell. Independent of US2, US3, US5-US7.
- **US5 (P3)**: After Phase 7. Independent of US6.
- **US6 (P3)**: After Phase 7. Independent of US5.
- **US7 (P3)**: After Phase 7. Exercisable only once US5 or US6 has produced a submission.

### Within Each User Story

- Tests are written first and must fail before the implementation task that satisfies them
- Migrations before contracts schemas before routes before screens
- A screen is never built before the endpoint it calls exists (plan.md: a screen without an API is not a deliverable)

### Parallel Opportunities

- T002-T005, T007-T009 in Phase 1
- T013-T019 in Phase 2 — seven independent component files
- T022-T026 in Phase 3 — all five test files
- T061-T064 in Phase 6 — four independent member screens
- T091-T096 in Phase 8 and T106-T110 in Phase 9
- T119-T126 in Phase 11 — four independent module pairs
- With capacity: US2, US3 and US4 can run concurrently after US1; US5 and US6 can run concurrently after Phase 7

---

## Parallel Example: User Story 1

```bash
# All five test files first — they must fail before T027-T038:
Task: "server/tests/authz/any-staff-posture.test.js"
Task: "server/tests/auth/session-capabilities.test.js"
Task: "client/tests/capability-matrix.test.jsx"
Task: "client/tests/refusals.test.jsx"
Task: "client/tests/no-registration.test.jsx"

# Then the two independent auth screens:
Task: "client/src/auth/SignIn.jsx"
Task: "client/src/auth/PasswordReset.jsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup
2. Phase 2: Foundational — blocks everything
3. Phase 3: US1
4. **STOP and VALIDATE**: run quickstart Scenario 1, including the `nogrants@test.invalid` account
5. Deploy — a correctly scoped console with honest empty states is a real deliverable

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. + US1 → **MVP**: capability-scoped console
3. + US2 → SEO staff can do their job without curl
4. + US3 → push campaigns; three of nineteen modules live
5. + US4 → members have a reason to sign in
6. + Phase 7 → organisation principals and the approval mechanism exist
7. + US5 → merchant loop end to end
8. + US6 → partner portal
9. + US7 → governance and audit across both
10. + Phases 11-12 → the remaining modules and the cross-cutting gates

### Parallel Team Strategy

1. Everyone: Phases 1-2, then US1
2. Then split — Dev A: US2 + US3. Dev B: US4. Dev C: Phase 7
3. Once Phase 7 lands — Dev A: US5. Dev B: US6. Dev C: US7 scaffolding

---

## Notes

- `[P]` means a different file with no dependency on an incomplete task
- Every task names an exact path; no task says "wire it up"
- Each gate task names its counter-assertion, per the repository's convention: a test that would
  pass against a console rendering everything to everyone is not a test
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
- Registration stays out throughout (FR-002, FR-037). T026 is the standing check that it stays out.

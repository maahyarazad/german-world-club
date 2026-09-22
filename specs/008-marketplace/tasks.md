---

description: "Task list for 008 — member marketplace, messaging persistence, three faces"
---

# Tasks: Member Marketplace (Classifieds)

**Input**: Design documents from `/specs/008-marketplace/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. Every one of SC-001…SC-014 names an automated check, each of the four contracts ends in an Assertions list, and CLAUDE.md requires a counter-assertion wherever a test would otherwise pass against a server that did nothing.

**Organization**: Grouped by user story. US1 → US2 → US5 is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US6 from spec.md
- Exact file paths in every task

## Path Conventions

Three npm workspaces — `server/`, `client/`, `packages/contracts/` — plus `expo-client/german-world-club`, which **is not in the workspace yet** and whose admission is T004.

## Five tasks that fail silently in production

These do not announce themselves. Each has its own task and its own test rather than being folded into the endpoint it belongs to:

| Task | Failure it prevents |
|---|---|
| **T042 / T045** | `limit` reaching SQL as `"50"`, as `undefined`, or unbounded |
| **T054 / T055** | a 403 where a 404 belongs, turning id-guessing into enumeration |
| **T033 / T034** | a quota without a row lock — passes every sequential test |
| **T068 / T069** | notification inside the transaction, losing messages only when pushes fail |
| **T077 / T078** | an expiry job missing its null check, silently expiring every unlimited listing |
| **T101** | a public page that interpolates real listings — scanned against a seeded corpus, not against the template |

---

## Phase 1: Setup

**Purpose**: Toolchain, workspace and the config the routes cannot register without

- [ ] T001 Capture the baseline: run `npm test` with `DATABASE_URL` and `REDIS_URL` set, and `npm run -w server verify:seo`, saving output to `/tmp/mkt-baseline.txt`. Confirm the SQL suites actually ran — the `⚠ No usable PostgreSQL` banner means a green run tested nothing (quickstart.md Scenario 0).
- [ ] T002 Add the `marketplace` and `messaging` route classes to `ROUTE_BUDGETS` in `server/src/config/budgets.ts`. The startup gate asserts Σ(outbound budgets) < deadline, so these must exist before any route registers or the server refuses to boot.
- [ ] T003 [P] Add `SCOPE.MARKETPLACE_LISTINGS = 'marketplace.listings'` to `server/src/db/counters.ts` alongside the existing `STORED_BYTES`.
- [ ] T004 Add `expo-client/german-world-club` to `workspaces` in the root `package.json` and add `@gwc/contracts` to its dependencies. **This single line is what makes Principle I satisfiable on the mobile face** (research.md R14) — without it the Expo app must redeclare shapes, which is the divergence the shared package exists to prevent. Run `npm install` and confirm the symlink resolves.
- [ ] T005 [P] Create `packages/contracts/src/marketplace.ts` and `packages/contracts/src/messaging.ts` as empty modules, and register both in the `exports` map of `packages/contracts/package.json` pointing at `.ts` files.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema and shared types. **⚠️ No user story can start until this phase completes.**

- [ ] T006 Write `server/migrations/018_messaging.sql`: `conversations` (with `subject_type`/`subject_id` and the denormalised `last_message_at` ordering key), `conversation_participants` (composite PK, `last_read_at`), `messages`. Index `(conversation_id, created_at DESC, id DESC)` for keyset paging. **No `delivered_at`/`read_at`** — delivery is on read here, and a column nothing writes is a promise the schema cannot keep (data-model.md §7b).
- [ ] T007 Write `server/migrations/019_marketplace.sql` part 1 — the five enums (`marketplace_category`, `marketplace_mode`, `marketplace_state`, `marketplace_contact`, `report_state`) in a guarded `DO $$` block, following `016_events.sql`.
- [ ] T008 Add `marketplace_listings` to `server/migrations/019_marketplace.sql` per data-model.md §2, including the `CHECK (state <> 'active' OR published_at IS NOT NULL)` and `CHECK (expires_at IS NULL OR expires_at > published_at)` constraints, and title/body length bounds. **The length bounds are business rules deliberately living in the database**: after feature 007 Phase 6 removes the Zod schema, the constraint is what is left.
- [ ] T009 [P] Add the **four** detail tables to `server/migrations/019_marketplace.sql` — `marketplace_vehicle_details`, `marketplace_property_details`, `marketplace_job_details`, `marketplace_general_details` — each PK **and** FK `listing_id` with `ON DELETE CASCADE`. Money is integer minor units plus a currency, never a float. `general` is deliberately the loosest: price, currency, condition and `kind` (product | service), so an arbitrary product or service has somewhere to go (data-model.md §3d).
- [ ] T010 [P] Add `vehicle_features` (with `retired_at` for soft-retire, never delete) and `marketplace_vehicle_features` to `server/migrations/019_marketplace.sql`. **No label column** — labels are client-side i18n keyed by `key`, because the server emits no localised text.
- [ ] T011 [P] Add `marketplace_listing_media` to `server/migrations/019_marketplace.sql` with `asset_id` → `assets(id)` **`ON DELETE RESTRICT`, not CASCADE**: deleting a listing removes links, never bytes, because another listing may share the checksum (research.md R6). **Media, not photos** — a listing may carry one photo, several photos or a video (FR-039), and the pipeline already handles both kinds.
- [ ] T012 [P] Add `marketplace_reports` and `marketplace_terms_acceptances` to `server/migrations/019_marketplace.sql`. Reports are unique on `(listing_id, reporter_id) WHERE state = 'open'` so one complainant cannot flood the queue; acceptances are append-only and keyed `(member_id, version)`.
- [ ] T013 Add the indexes to `server/migrations/019_marketplace.sql`: the partial `(state, created_at DESC, id DESC) WHERE state = 'active'`, `(owner_id, state_changed_at DESC)`, `(category, state, created_at DESC) WHERE state = 'active'`, and one per filterable detail field including `general` on `(kind, price_minor)` (data-model.md §3).
- [ ] T014 Run `npm run -w server migrate` and confirm both migrations apply cleanly against a scratch database, then that `migrate:down` reverses them.
- [ ] T015 Define the category field sets in `packages/contracts/src/marketplace.ts` per `contracts/listing-categories.md` — `FieldDef`, `CategoryDef`, and the **four** category definitions with `filterable` flags. This is the one definition the console form and the server validation both read (Principle I).
- [ ] T016 [P] Define the listing, photo, report and terms types in `packages/contracts/src/marketplace.ts`.
- [ ] T017 [P] Define conversation and message types in `packages/contracts/src/messaging.ts`.
- [ ] T018 Write a test in `server/tests/marketplace/definitions.test.ts` asserting every `filterable: true` field has a backing index in `019_marketplace.sql`. A filter with no index is a sequential scan that looks fine until the corpus grows.

**Checkpoint**: Schema applies, types exist, no route yet.

---

## Phase 3: User Story 1 - A member posts a listing (P1) 🎯 MVP

**Goal**: A member with `marketplace_post` and accepted terms can create a listing in any of the four categories.

**Independent Test**: Grant one member the flag and not another. The first creates a listing; the second is refused **by the API**, not merely missing a button.

### Tests for User Story 1

- [ ] T019 [P] [US1] Write `server/tests/marketplace/posting.test.ts` — the permission pair: a member with `marketplace_post` creates successfully, one without gets 403 `PERMISSION_REQUIRED` calling the endpoint directly. **The second half is the test**; the absent UI control is a courtesy and the server is the control.
- [ ] T020 [P] [US1] Add terms cases to `server/tests/marketplace/posting.test.ts`: a member who has not accepted the current version is refused naming the terms, and one who accepted an older version is also refused.
- [ ] T021 [P] [US1] Add the category-required-field pair to `server/tests/marketplace/posting.test.ts`: a `vehicle` submission missing a vehicle-required field is refused naming the field, and **the same payload submitted as `job` is accepted** — the required set differs per category (spec US1.4).

### Implementation for User Story 1

- [ ] T022 [US1] Create `server/src/modules/marketplace/categories.ts` — server-side validation reading the definitions from `@gwc/contracts/marketplace`. A client may shape its form from the same source but is never the enforcement point (FR-009).
- [ ] T023 [US1] Create `server/src/modules/marketplace/application/create.ts`: check the `marketplace_post` flag from server-held state, check the current terms acceptance, validate category fields, insert the listing and its detail row in one transaction.
- [ ] T024 [US1] Create `server/src/modules/marketplace/controller.ts` with the create handler, shaping request to `application/create.ts` and the result onto reply.
- [ ] T025 [US1] Create `server/src/modules/marketplace/routes.ts` with `POST /marketplace/listings`, declaring `config: { auth: { audience: 'member' }, budget: 'marketplace' }` and its Zod `schema.body`/`schema.response`.
- [ ] T026 [US1] Register the marketplace module in `server/src/app.ts` after the plugin chain, and confirm the server boots — the `config.auth` gate refuses otherwise.
- [ ] T027 [US1] Add `GET /marketplace/terms` and `POST /marketplace/terms/accept` to `server/src/modules/marketplace/routes.ts`, writing to `marketplace_terms_acceptances`. Append-only: accepting v2 keeps the v1 row, which is the record of what was agreed when earlier listings were posted.
- [ ] T028 [US1] Add `GET /marketplace/categories` to `server/src/modules/marketplace/routes.ts`, serving the field definitions plus the live `vehicle_features` catalogue (excluding retired). This is the client's only source for the ~40 features — hard-coding them in the console would be a second home for a rule.
- [ ] T029 [US1] Seed the `vehicle_features` catalogue in `server/src/seed/` with the §7 feature set, grouped and positioned.
- [ ] T030 [P] [US1] Add the German and English labels for every vehicle-feature `key` to **both** `client/src/i18n/de.ts` and `client/src/i18n/en.ts`. `npm run -w client test:i18n` fails when the catalogues disagree in either direction.
- [ ] T031 [US1] Write `server/tests/marketplace/no-server-localisation.test.ts` confirming no marketplace response body varies with `Accept-Language`, extending the existing `tests/ops/no-server-localisation.test.ts` guarantee to this module.

### The quota — its own task because it fails silently

- [ ] T032 [US1] Write `server/tests/marketplace/audience.test.ts`: creating a listing as a **merchant**, **partner** or **staff** principal is refused (FR-038, SC-016). The route's audience is `member` and `marketplace_post` is a member-only flag; organisations sell through `offers` (§5) and staff do not sell. Counter-assertion: a member with the flag succeeds, or the suite would pass against a route that refused everyone.
- [ ] T033 [US1] Enforce the listing quota in `server/src/modules/marketplace/application/create.ts` via `reserve()` from `server/src/db/counters.ts` under the row lock, returning **422 `QUOTA_EXCEEDED`, never 429**. A 429 means "retry and it will work"; a quota means retrying changes nothing until state does, so a client shown 429 retries forever.
- [ ] T034 [US1] Write the concurrency assertion in `server/tests/marketplace/quota.test.ts`: fire N+1 creates **simultaneously** against a member at cap N and confirm exactly the remaining allowance succeed and the counter matches the rows created. **A sequential test passes against a quota with no lock at all** — that is why this one is concurrent.

**Checkpoint**: A member can post. Nothing can read it back yet.

---

## Phase 4: User Story 2 - A member browses and filters (P1) 🎯 MVP

**Goal**: Members see listings newest-first, filtered by category, mode and per-category fields.

**Independent Test**: Seed listings across all categories and modes, filter to each combination, confirm the result set matches — and that unauthenticated requests are refused and carry `noindex`.

### Tests for User Story 2

- [ ] T035 [P] [US2] Write `server/tests/marketplace/browse.test.ts` covering every category × mode combination against a seeded corpus.
- [ ] T036 [P] [US2] Add per-category filter cases to `server/tests/marketplace/browse.test.ts` — price range and make for vehicles, rooms and deal for property, city and seniority for jobs.
- [ ] T037 [P] [US2] Write `server/tests/marketplace/visibility.test.ts`: a listing whose owner is `locked`, `inactive` or `ended` is absent from the member index, and returns to it when the member is reinstated.
- [ ] T038 [P] [US2] Add gone-state cases to `server/tests/marketplace/visibility.test.ts`: withdrawn, sold, expired and hidden listings return not-found or gone when requested directly — **never a success carrying fallback content** (§12 rule 13).

### Implementation for User Story 2

- [ ] T039 [US2] Create `server/src/modules/marketplace/application/browse.ts` with the keyset index query, joining the owner's status live rather than reading a denormalised flag — a cached copy of live state is what Principle III forbids (research.md R7).
- [ ] T040 [US2] Add per-category filter predicates to `server/src/modules/marketplace/application/browse.ts`, joining exactly one detail table when a category filter is present and none when it is not.
- [ ] T041 [US2] Add `GET /marketplace/listings` and `GET /marketplace/listings/:id` to `server/src/modules/marketplace/routes.ts` with member posture.

### `limit` — its own task because it fails silently

- [ ] T042 [US2] Coerce, default and bound `limit` **in `server/src/modules/marketplace/controller.ts`**, not only in the Zod schema: `Number()` it, default 20 when absent, cap at 50. Feature 007 Phase 6 will delete the schema; the handler is what survives.
- [ ] T043 [US2] Implement the opaque keyset cursor encoding `(created_at, id)` in `server/src/modules/marketplace/controller.ts`. An unparseable cursor is a 400, not a silent reset to page one — silently restarting is how a client loops forever without noticing.
- [ ] T044 [US2] Ensure every query in `server/src/modules/marketplace/application/browse.ts` names its columns explicitly. With response schemas removed by constitution 2.0.0, this is the **only** thing preventing a new `members` column from reaching a listing response.
- [ ] T045 [US2] Write `server/tests/marketplace/limit.test.ts` asserting all three: `?limit=1000000` returns at most 50, absent `limit` returns 20 and does not error, and `limit` reaches the application layer as a **number** rather than the string `"50"`. `specs/007-typescript-migration/data-model.md` §4b traced exactly these three regressions on the existing `campaignQuery.limit`.
- [ ] T046 [US2] Write `server/tests/marketplace/no-select-star.test.ts` asserting `SELECT *` appears nowhere under `server/src/modules/marketplace/`.

### Media

- [ ] T047 [P] [US2] Create `server/src/modules/marketplace/application/media.ts` linking uploaded assets to a listing with explicit `position`, reusing `modules/media` unchanged. Accepts **images and video** — `ASSET_KINDS` already covers both.
- [ ] T048 [US2] Add `POST /marketplace/listings/:id/media` and `DELETE /marketplace/listings/:id/media/:assetId` to `server/src/modules/marketplace/routes.ts`. Detaching removes the link row and **never** the bytes. Enforce the media-count bound and require at least one item (FR-039).
- [ ] T049 [P] [US2] Write `server/tests/marketplace/media.test.ts` covering all three shapes (FR-039, SC-017): **one photo**, **several photos**, **one video**. In each case responses reference derivatives only and never the original; two listings sharing a checksum both keep rendering after one is deleted; and stored bytes count against the existing quota. **Video is why the quota assertion matters** — one video can exceed a member's whole image allowance.
- [ ] T050 [P] [US2] Assert in `server/tests/marketplace/media.test.ts` that a video listing serves its `poster` variant in the index (FR-040), so a browse page never autoplays and never waits on a transcode.

### Never public, never indexed

- [ ] T051 [US2] Write `server/tests/marketplace/posture.test.ts`: every marketplace route is refused unauthenticated, every response carries `X-Robots-Tag: noindex`, and `seo/surfaces.ts` still declares `/marketplace` gated. Counter-assertion — removing `config.auth` from one route refuses to boot.
- [ ] T052 [US2] Run `npm run -w server verify:seo` and confirm exit 0 with no marketplace URL in the sitemap.

**Checkpoint**: Post and browse work. This is a shippable marketplace with no way to respond to a listing.

---

## Phase 5: User Story 5 - A member contacts a seller (P1) 🎯 completes MVP

**Goal**: Messaging persistence and the inquiry flow — §7's contact method, made real.

**Independent Test**: Two members, one listing. The first inquires, the second replies, and the exchange survives both signing out and back in. Neither response carries the other's email or phone.

**Depends on**: US1 (a listing must exist to inquire about).

### Tests for User Story 5

- [ ] T053 [P] [US5] Write `server/tests/messaging/inquiry.test.ts`: an inquiry creates a conversation linked to the listing, the owner reads it, replies, and the inquirer reads the reply — with neither online simultaneously.
- [ ] T054 [P] [US5] Write `server/tests/messaging/privacy.test.ts` asserting **no messaging or marketplace response carries an email address or phone number** for either party (FR-026). A conversation payload already carries two members' data; this is where forgetting the explicit-columns rule is worst.
- [ ] T055 [P] [US5] Add the non-participant case to `server/tests/messaging/privacy.test.ts`: a member who is not in a conversation gets **404**, byte-identical to a conversation that does not exist. A 403 would confirm it exists and reveal who is talking to whom.

### Implementation for User Story 5

- [ ] T056 [US5] Create `server/src/modules/messaging/application/converse.ts` — start a conversation, append a message, read a conversation keyset-paged.
- [ ] T057 [US5] Create `server/src/modules/messaging/application/inquire.ts` — the marketplace entry point, refusing when the listing is not inquirable and when a member inquires on their own listing.
- [ ] T058 [US5] Create `server/src/modules/messaging/controller.ts` and `server/src/modules/messaging/routes.ts` with `GET /messages/conversations`, `GET /messages/conversations/:id`, `POST /messages/conversations/:id/messages`, all `budget: 'messaging'`.
- [ ] T059 [US5] Add `POST /marketplace/listings/:id/inquire` to `server/src/modules/marketplace/routes.ts`, delegating to `messaging/application/inquire.ts`. It lives under `/marketplace` because that is the resource it acts on and the guard it needs.
- [ ] T060 [US5] Register the messaging module in `server/src/app.ts`.
- [ ] T061 [US5] Maintain `conversations.last_message_at` on every append in `server/src/modules/messaging/application/converse.ts` — it is the inbox ordering key, and the alternative is a correlated subquery per row.
- [ ] T062 [US5] Bound and coerce the conversation page size in `server/src/modules/messaging/controller.ts`, the same three ways as T042. It is the second such parameter in this feature.
- [ ] T063 [US5] Ensure every query in `server/src/modules/messaging/application/` names its columns, and write `server/tests/messaging/no-select-star.test.ts`.
- [ ] T064 [US5] Add message-volume rate limiting to `server/src/modules/messaging/routes.ts` via `app.bucket`, returning **429** — a transport limit where waiting works, unlike the listing quota's 422.
- [ ] T065 [US5] Write `server/tests/messaging/limits.test.ts` asserting message volume is 429 **and** the listing quota is 422. Both live in this feature and flattening them together is the easy mistake.
- [ ] T066 [US5] Implement `marketplace_contact` preference resolution in `server/src/modules/marketplace/controller.ts`, resolving against the owner's privacy settings at render time and omitting what they do not permit. The listing stores a preference, **never a value** (research.md R9).
- [ ] T067 [US5] Add the conversations-outlive-their-listing rule to `server/src/modules/messaging/application/inquire.ts`: a withdrawn, sold or hidden listing refuses **new** inquiries while existing conversations stay readable (FR-027).

### Persist before notify — its own task because it fails silently

- [ ] T068 [US5] In `server/src/modules/messaging/application/converse.ts`, commit the message **before** attempting any notification. Notification is a step after commit, never inside the transaction — a transaction rolling back on a failed push loses a message the sender was told was accepted. The Technology Baseline states this ordering.
- [ ] T069 [US5] Write `server/tests/messaging/persist-before-notify.test.ts`: **deliberately fail the notification path** and confirm the message is still in the database and readable by the recipient. A happy-path test passes against an implementation that notifies inside the transaction.

**Checkpoint**: Post, browse, and respond. This is the MVP.

---

## Phase 6: User Story 3 - A member manages their own listings (P2)

**Goal**: Edit, mark sold/filled, withdraw, and set or clear an expiry — own listings only.

**Independent Test**: Two members, one listing each. Each can edit their own and is refused on the other's, and the refusal does not reveal whether it exists.

### Tests for User Story 3

- [ ] T070 [P] [US3] Write `server/tests/marketplace/ownership.test.ts`: the owner edits successfully; another member gets **404** on edit and on GET; a genuinely absent id also gets 404. **Assert the three are indistinguishable** — status, body and headers compared (SC-006).
- [ ] T071 [P] [US3] Write `server/tests/marketplace/expiry.test.ts` covering all three cases: expiry in the past → `expired`, in the future → still active, and **NULL (unlimited) → still active**.

### Implementation for User Story 3

- [ ] T072 [US3] Create `server/src/modules/marketplace/application/manage.ts` — edit, state transitions, expiry changes, all enforced against the loaded row inside the transaction.
- [ ] T073 [US3] Add `PATCH /marketplace/listings/:id`, `POST /marketplace/listings/:id/state` and `GET /marketplace/mine` to `server/src/modules/marketplace/routes.ts`. `/mine` includes hidden and withdrawn listings — the owner must see them.
- [ ] T074 [US3] Handle category change in `server/src/modules/marketplace/application/manage.ts` by deleting the old detail row and inserting the new one, so fields that no longer apply cannot linger.
- [ ] T075 [US3] Implement optional expiry in `server/src/modules/marketplace/application/manage.ts`: null means unlimited and is a first-class choice, and a member may clear an expiry back to unlimited at any time (FR-028, FR-030).
- [ ] T076 [US3] Write `server/tests/marketplace/ownership.test.ts` counter-assertion: the owner **can** do each of the actions another member is refused, or the suite would pass against an endpoint that refused everyone.

### The expiry job — its own task because it fails silently

- [ ] T077 [US3] Register a `marketplace-expiry` job in `server/src/ops/jobs.ts` whose predicate is **`expires_at IS NOT NULL AND expires_at <= now()`** — both halves. Individually enableable, recording start, end and outcome, as the Workflow section requires of every job.
- [ ] T078 [US3] Write the negative assertion in `server/tests/marketplace/expiry.test.ts`: after the job runs, a listing with **no** expiry is **still active**. A job that forgot the null check would silently expire every unlimited listing and a happy-path test would not notice.

**Checkpoint**: Members fully own their listings.

---

## Phase 7: User Story 4 - Staff moderate (P2)

**Goal**: Reports, hide/restore/remove, all audited, gated per flag.

**Independent Test**: `marketplace_moderation:status` can hide; `read` alone cannot; the audit log records who did what.

### Tests for User Story 4

- [ ] T079 [P] [US4] Write `server/tests/marketplace/moderation.test.ts`: `status` can hide, `read` alone is refused, and a hide with **no reason** is refused.
- [ ] T080 [P] [US4] Add the audit assertion to `server/tests/marketplace/moderation.test.ts`: every action appears in the append-only log with actor, target and reason.
- [ ] T081 [P] [US4] Add the owner-visibility case to `server/tests/marketplace/moderation.test.ts`: a hidden listing is absent from the member index and **present, marked hidden**, in the owner's `/marketplace/mine`. A member who cannot tell "hidden by staff" from "I deleted it by accident" files a ticket.

### Implementation for User Story 4

- [ ] T082 [US4] Create `server/src/modules/marketplace/application/moderate.ts` — hide, restore, remove, resolve a report, each writing to `app.audit` with a required reason.
- [ ] T083 [US4] Add `POST /marketplace/listings/:id/report` to `server/src/modules/marketplace/routes.ts`, enforcing one open report per member per listing.
- [ ] T084 [US4] Create `server/src/modules/marketplace/staff-routes.ts` with the six `/admin/marketplace/*` endpoints, each declaring `auth: { audience: 'staff', module: 'marketplace_moderation', flag: … }` per `contracts/moderation-api.md`.
- [ ] T085 [US4] Write `server/tests/marketplace/moderation.test.ts` counter-assertion: staff **cannot** edit a member's listing body through any endpoint. `write` and `edit` are deliberately unused on this module — moderating a classified must not become rewriting what a member said.
- [ ] T086 [US4] Replace `NotBuilt` with a moderation screen at `client/src/console/admin/Marketplace.tsx`, wired into `client/src/console/routes.tsx` at `/konsole/admin/angebote`.
- [ ] T087 [P] [US4] Add moderation strings to **both** `client/src/i18n/de.ts` and `client/src/i18n/en.ts`.
- [ ] T088 [P] [US4] Write `client/tests/console/marketplace-moderation.test.tsx` asserting the screen renders for a holder of `marketplace_moderation` and not for a non-holder — the capability pair every console screen needs.

**Checkpoint**: The marketplace is moderated.

---

## Phase 8: User Story 6 - The marketplace works on mobile (P2)

**Goal**: A member tab in the web app and a member tab in the Expo app, over the same API.

**Independent Test**: The same member with the same filters gets identical results on both faces.

**Depends on**: T004 (workspace membership) and US2.

### Web member surface

- [ ] T089 [US6] Create `client/src/member/MemberLayout.tsx` — the member area tab bar, at the `/konsole/mitglied` path `HOME_FOR_KIND` already maps members to.
- [ ] T090 [US6] Create `client/src/member/Marketplace.tsx` — browse, filter and compose, building the compose form from `GET /marketplace/categories` with **no hard-coded field list** (Principle I).
- [ ] T091 [US6] Add the member routes to `client/src/console/routes.tsx` under an `Authenticated` gate, with a nested `*` rendering `NotBuilt` so an unbuilt member area does not bounce to sign-in — the defect fixed in `f8bba29`.
- [ ] T092 [P] [US6] Add marketplace strings to **both** `client/src/i18n/de.ts` and `client/src/i18n/en.ts`, and run `npm run -w client test:i18n`.
- [ ] T093 [P] [US6] Write `client/tests/member/marketplace.test.tsx` asserting the compose control is absent without `marketplace_post` and present with it.

### Mobile surface

- [ ] T094 [US6] Create `expo-client/german-world-club/src/lib/api.ts` — a bearer-token API client against the existing `/auth` routes. The server already mints mobile bearer tokens and already treats `deviceId` as marking the mobile face, so this wires an existing capability rather than designing an auth flow (research.md R14).
- [ ] T095 [US6] Create `expo-client/german-world-club/src/app/marketplace.tsx` — the mobile marketplace screen, importing its types from `@gwc/contracts/marketplace`.
- [ ] T096 [US6] Add a third `NativeTabs.Trigger` to `expo-client/german-world-club/src/components/app-tabs.tsx` and its `.web.tsx` counterpart, with a tab icon asset.
- [ ] T097 [US6] Write `server/tests/marketplace/parity.test.ts`: the same member, same filters, via cookie auth and via bearer auth, returns identical result sets — and a member without `marketplace_post` is refused on both (FR-031).
- [ ] T098 [US6] Assert no redeclared shapes in `expo-client/german-world-club/src/`: grep for a locally-declared listing type and confirm it imports from `@gwc/contracts/marketplace` instead. After feature 007 Phase 6 removes the runtime schemas, nothing would catch this drift at runtime either.

**Checkpoint**: Three faces, one rule set.

---

## Phase 9: User Story 7 - Public discovery page (P3)

**Goal**: A public page describing the marketplace with aggregate counts and **no listings**.

**Independent Test**: Fetch it signed out and scan for any seeded listing's title, photo URL or price. Finding none, while the page still describes the marketplace, is the test.

**Depends on**: US2 only for the counts to be non-zero. Ships independently of everything else.

- [ ] T099 [US7] Declare the new surface in `server/src/modules/seo/surfaces.ts`: `/marktplatz` **public and indexed**, with its reason. `/marketplace` keeps its existing gated, never-indexed entry — **two surfaces, two declarations** (FR-034, FR-037). Adding a public one must not relax the member-only one.
- [ ] T100 [US7] Add an aggregate-counts endpoint in `server/src/modules/marketplace/routes.ts` with `config: { auth: { audience: 'public' } }`, returning per-category counts over published state only. Counts are club facts, not member data — no id, title, photo, price or owner may appear in the response (FR-035).
- [ ] T101 [US7] Create `client/marktplatz.html` as a fourth Vite entry in `client/vite.config.ts`, alongside `index.html`, `en.html` and `konsole.html`. **Content and styles inline, no bundle** — crawlers and link-preview bots execute no JavaScript, and a discovery page needing a bundle is invisible to the clients it exists for (FR-036).
- [ ] T102 [US7] Write `server/tests/seo/marketplace-public.test.ts`: fetch the public page against a **seeded corpus** and assert no seeded listing's id, title, photo URL, price or owner appears anywhere in the response (SC-015). Scan the rendered output, not the template — a template test passes against a page that interpolates rows at runtime. Counter-assertion: the page **does** contain the category names and a non-zero count, or the suite would pass against an empty page.

**Checkpoint**: The marketplace is discoverable without being exposed.

---

## Phase 10: Polish & Cross-Cutting

- [ ] T103 [P] Extend `server/src/seed/` with a marketplace corpus spanning **all four** categories, **both** modes and **every** state, plus some listings with an expiry and some unlimited, and at least one conversation so the demo inbox is not empty (SC-009).
- [ ] T104 Apply the consistent-history rule in `server/src/seed/marketplace.ts`: a `sold` listing gets the entry that sold it, stamped its own `state_changed_at`, with its own value. Nothing gets invented history.
- [ ] T105 [P] Confirm `server/tests/seed/no-live-credentials.test.ts` still passes. Terms acceptances are records, not credentials, and are seedable — they do **not** join the never-seeded list in `server/src/seed/tables.ts`.
- [ ] T106 Add the marketplace's business rules to the preserved-rules list in `specs/007-typescript-migration/data-model.md` §4 — category-required fields, title/body bounds, photo counts, price bounds, message length. **These must survive Phase 6's Zod removal**, and this feature is what knows about them. Leaving them for Phase 6 to rediscover is how they get dropped.
- [ ] T107 [P] Measure the `server/src/modules/marketplace/application/browse.ts` index query against the `marketplace` budget in `server/src/config/budgets.ts`, with a realistic corpus. R7's owner-status join is on the hot path and the partial index must cover it.
- [ ] T108 [P] Run `npm run -w client build` and confirm all three entries still emit, and that the two landing pages still render with JavaScript disabled.
- [ ] T109 Update `CLAUDE.md` with the marketplace module, the messaging module and the note that real-time transport is a later feature.
- [ ] T110 Execute `specs/008-marketplace/quickstart.md` end to end, all 14 scenarios, recording the result against its definition-of-done table.
- [ ] T111 Run `npm test` and diff against the T001 baseline: the server count is the baseline plus the marketplace and messaging suites, and nothing else moved. Note that `npm run typecheck` still fails on feature 007's outstanding errors — the meaningful check is that these files add **no new** ones.

---

## Dependencies & Execution Order

### Phase Dependencies

```
Setup → Foundational ─┬─→ US1 (post) ─┬─→ US2 (browse) ──┐
                      │               │                  ├─→ US6 (three faces) → Polish
                      │               └─→ US5 (contact) ──┤
                      │                                   │
                      └─→ (T004 workspace) ───────────────┘
                                      US3 (manage) ← US1
                                      US4 (moderate) ← US1, US2
                                      US7 (public page) ← US2 (counts only)
```

- **US1** blocks everything else — there is nothing to browse, contact, manage or moderate without a listing.
- **US2** and **US5** are independent of each other and both depend on US1.
- **US6** needs US2 (something to show) and T004 (workspace membership).
- **US7** needs US2 only for the counts to be non-zero, and ships independently
  of every other story. It is the one phase that can be done at any point after
  Phase 4 without blocking or being blocked.
- **US3** and **US4** depend on US1 and can run in parallel with each other.

### Within Each Story

- Migration before types before application before routes before registration
- Test helpers before the suites that use them
- `application/` before `controller.ts` before `routes.ts` — framework-free first, per feature 006

### Parallel Opportunities

| Phase | Parallel | Notes |
|---|---|---|
| 2 | T009–T012 | four independent table groups in one migration file — coordinate the final assembly |
| 3 | T019–T021 | three test files |
| 4 | T035–T038 | four test files |
| 5 | T053–T055 | three messaging tests |
| 7 | T079–T081, T087–T088 | moderation tests and client strings |
| 8 | T092–T093 | client strings and tests |
| 9 | T099, T101 | surface declaration and the public page are different files |
| 10 | T103, T105, T107, T108 | independent verification runs |

**Not parallelizable**: T006–T013 all write to two migration files; T022–T028 build one module in sequence; T042/T043 share `controller.ts`.

---

## Parallel Example: User Story 2

```bash
# The four browse test files, before the implementation they describe:
Task: "Every category × mode combination (T035)"
Task: "Per-category filter predicates (T036)"
Task: "Owner-status visibility cascade (T037)"
Task: "Gone-state direct requests (T038)"
```

---

## Implementation Strategy

### MVP — US1 + US2 + US5

1. Phase 1 Setup → Phase 2 Foundational
2. Phase 3 (US1) — a member can post
3. Phase 4 (US2) — members can find it
4. Phase 5 (US5) — members can respond to it
5. **STOP and VALIDATE**: quickstart scenarios 1–9b

That is a working marketplace: post, browse, contact. US3, US4 and US6 each add a dimension without which it still functions — management, moderation, and the second face.

US5 is inside the MVP rather than after it because a classified with no way to answer it is a notice board nobody can reply to. Its cost is bounded by R13's split: persistence and the inquiry flow only.

### Incremental Delivery

1. Setup + Foundational → schema and types
2. + US1 → posting → **ship internally**
3. + US2 → browsing → **ship**
4. + US5 → contact → **ship (MVP)**
5. + US3 → management
6. + US4 → moderation
7. + US6 → mobile parity
8. + US7 → public discovery page
9. + Polish

### Parallel Team Strategy

- **Developer A**: US1, then US3 — the same module, and ownership rules read best written by whoever wrote creation
- **Developer B**: US2, then US4 — browse and moderate share the visibility predicates
- **Developer C**: T004 then US5 — messaging is its own module, and the workspace change unblocks US6
- **Developer C then A**: US6, once US2 exists

---

## Notes

- **[P] = different files, no dependencies.** Two tasks touching `routes.ts` are never parallel.
- Commit after each task. Migrations and the code that reads them go together.
- **T004 is one line and unblocks an entire user story.** Adding the Expo app to `workspaces` is what makes Principle I satisfiable on the mobile face; until it lands, FR-032 is unachievable rather than merely unimplemented.
- **T106 is the easiest task to skip and the most expensive to skip.** The marketplace's business rules must join 007's preserved-rules list or Phase 6 removes them silently, exactly as the `campaignQuery.limit` analysis predicted for the existing ones.
- **Task count: 111**, T001–T111, 35 marked [P].

| Phase | Tasks | |
|---|---|---|
| 1. Setup | 5 | T001–T005 |
| 2. Foundational | 13 | T006–T018 |
| 3. US1 — post | 16 | T019–T034 (MVP) |
| 4. US2 — browse | 18 | T035–T052 (MVP) |
| 5. US5 — contact | 17 | T053–T069 (MVP) |
| 6. US3 — manage | 9 | T070–T078 |
| 7. US4 — moderate | 10 | T079–T088 |
| 8. US6 — mobile | 10 | T089–T098 |
| 9. US7 — public page | 4 | T099–T102 |
| 10. Polish | 9 | T103–T111 |

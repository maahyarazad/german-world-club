# Research: Onboarding Phase 2 — Profiling Workflow

All items below were resolved from the existing codebase (feature 009's onboarding gate, its
contracts, and its client patterns) plus two decisions confirmed with the user during `/speckit-plan`
(recorded here as R1 and R4, since they determine scope). No `[NEEDS CLARIFICATION]` markers remain.

## R1: Does profiling gate member access?

- **Decision**: Yes. Mandatory, cannot be skipped or deferred, for every member type. Mirrors the
  Phase 1 approval gate exactly.
- **Rationale**: Confirmed by the user directly ("Profiling is mandatory for all the member user
  types and cannot be skipped"). This is also the only interpretation consistent with the existing
  `country_of_residence` column comment in `server/migrations/020_onboarding.sql:17`: *"Phase 2
  profiling branches on it"* — written when Phase 1 shipped, in anticipation of this feature.
- **Alternatives considered**: Optional/deferred profiling (rejected — explicitly against the
  user's answer); soft-gating only specific features (rejected — same reason, and it would need a
  second, weaker enforcement path alongside the existing one for no stated benefit).

## R2: Gate mechanism

- **Decision**: A new `config.auth.profiling: true` route-declaration flag, structurally identical
  to the existing `config.auth.onboarding: true` flag, plus one new check in `applyMemberGates`
  (`server/src/plugins/10-auth.ts`).
- **Current gate chain** (`applyMemberGates`, ~lines 219–276): loads the member with a `LEFT JOIN
  membership_applications`; `auth.onboarding === true` short-circuits and returns immediately;
  otherwise the chain checks `application_state === 'denied'` → `APPLICATION_DENIED`,
  `email_confirmed_at IS NULL` → `PROFILE_INCOMPLETE`, `application_state === 'pending'` →
  `APPROVAL_PENDING`, then device approval → `APPROVAL_PENDING`.
- **New check**, inserted immediately after the device-approval check and before permissions are
  resolved:
  ```ts
  if (auth.profiling === true) {
    request.permissions = { kind: 'member', flags: {}, displayName: member.display_name }
    return
  }
  if (member.application_state === 'approved' && member.profiling_completed_at === null) {
    throw forbidden(PROBLEMS.PROFILING_INCOMPLETE, 'Complete your profile to continue.')
  }
  ```
  The `application_state === 'approved'` guard is load-bearing: a member with no
  `membership_applications` row (invited or legacy — `application_state` is `null`) is untouched,
  exactly like the existing pending/denied checks already skip them. Profiling only ever applies to
  someone who came through the Phase 1 approval gate.
- `loadMember` (~lines 73–88) gains one more explicit column,
  `member_profiling.completed_at AS profiling_completed_at`, via an additional `LEFT JOIN
  member_profiling ON member_profiling.member_id = members.id` — named explicitly per the
  project's no-`SELECT *`-on-a-response-path convention, not because a response schema still checks
  it (Constitution VI, amended).
- `server/src/plugins/11-rbac.ts` (~lines 79–84) gains a matching validation stanza for
  `profiling`, identical in shape to the existing `onboarding` one: `profiling` may only be `true`
  and only on an `audience: 'member'` route.
- New problem type `PROFILING_INCOMPLETE` (`packages/contracts/src/errors.ts`, "Account state"
  section, next to `PROFILE_INCOMPLETE`/`APPROVAL_PENDING`), status 403.
- **Alternatives considered**: A generic "extra onboarding gates" list on the route config
  (rejected — one boolean flag per gate is exactly the pattern `onboarding` already established,
  and a list adds indirection for a gate count of two); computing profiling completeness from the
  member row directly with a boolean column on `members` instead of a join (rejected — see R3).

## R3: Data shape for profiling answers

- **Decision**: One new sidecar table, `member_profiling`, one row per member, created lazily on
  first answer (not at approval time) — following the `member_avatars` /
  `organisation_profiles` "sidecar keyed on the owning id" pattern
  (`server/migrations/026_profiles.sql`) rather than the `member_designations` audited-history
  pattern or a `(member_id, key)` generic key-value table.
- **Rationale**: The question set is fixed and known at build time (five German questions; three
  city slots for everyone else) — not a dynamic or staff-defined set — so a flat table with typed,
  constrained columns is simpler than an EAV table and lets Postgres enforce each answer's allowed
  values directly (matching how `members.gender`/`members.country_of_residence` already use
  `CHECK` constraints next to a shared TS enum, rather than trusting the application layer alone).
- Both branches' columns live on the same row (nullable until answered) rather than two tables,
  because a member is in exactly one branch for the lifetime of the row — `branch` is captured once
  from `country_of_residence` at the member's first answer and never recomputed, so a
  `country_of_residence` correction after profiling starts cannot retroactively flip which
  questions were "supposed to" apply.
- Completion and post-completion immutability (spec FR-017) are enforced by a trigger, mirroring
  `membership_applications_decision_is_final` (`020_onboarding.sql`): once `completed_at` is set,
  any further `UPDATE` from a member-facing route is refused. This is a `BEFORE UPDATE` trigger,
  not an application-level check, per Constitution IV (integrity lives in the database).
- **Alternatives considered**: A `(member_id, question_key, answer)` EAV table (rejected — no
  dynamic question set exists yet to justify the indirection, and it would make the `CHECK`
  constraints per answer impossible to express in SQL); two separate tables per branch (rejected —
  a member is provably in one branch only, so a nullable shared row costs nothing extra and avoids
  a `UNION`/coalesce at every read site).

## R4: How "GWC city" matching is determined

- **Decision**: A new reference table, `gwc_cities` (country + city pairs), seeded/maintained
  independently of any submission, checked against each of a member's up-to-three submitted
  locations by exact `(country, city)` match.
- **Rationale**: Confirmed by the user ("New reference list (Recommended)"). No existing table in
  the codebase represents a "GWC city" concept — `organisations` is contract/merchant data with no
  member-facing city designation, and events have locations but no "is this a GWC city" flag.
  Introducing new, narrowly-scoped reference data is simpler than overloading an unrelated table.
- A minimal table (`id`, `country`, `city`, `created_at`, `UNIQUE (country, city)`) is sufficient
  for this feature's scope; a dedicated staff CRUD UI for managing it is out of scope per the
  spec's Assumptions and can be added later without a data model change.
- **Alternatives considered**: Deriving the list from `organisations`/event locations (rejected by
  the user — no such concept exists there today, and forcing one in would conflate "has an
  organisation" with "is a designated city"); skipping real matching and always returning
  "no match" (rejected by the user — it would make Story 3's placeholder path unreachable and
  therefore untestable).

## R5: API shape for the questionnaire

- **Decision**: Two routes — `GET /profiling/status` (branch, progress, completion, outcome) and
  `PATCH /profiling` (submit one or more answers for the caller's branch) — rather than one route
  per question.
- **Rationale**: `PATCH /profiling` accepting partial fields naturally supports resuming mid-flow
  (spec FR-015): the client reads `GET /profiling/status` to see which fields are already filled
  and asks only the next question, and the server (not the client) decides when a branch's full
  required set is present and marks `completed_at` — consistent with "business rules are computed
  server-side, never re-implemented in a client" (Constitution I). It also means declaring exactly
  one access posture for the write path instead of five-plus, and it matches the smallest-surface
  precedent already in the codebase (`PUT /onboarding/email` is a single partial-update route, not
  one route per onboarding field).
- Both routes declare `config.auth = { audience: 'member', profiling: true }`, following the
  `/onboarding/status` template exactly (`server/src/modules/onboarding/routes.ts:71-78`).
  `GET /profiling/status` uses `budget: 'member-read'`; `PATCH /profiling` uses `budget:
  'member-write'` (`server/src/config/budgets.ts:53` — the existing write-class budget for a
  member-scoped mutation with no outbound dependency this feature needs).
- **Alternatives considered**: One POST route per question (rejected — five-plus near-identical
  route declarations for no behavioural difference, and resumability would need to be reconstructed
  client-side instead of read once from `GET /profiling/status`); a single `POST /profiling/complete`
  that accepts the whole branch's answers at once (rejected — it cannot express "resume where I left
  off" for the five-question German flow, which the spec requires to be sequential and resumable
  per question).

## R6: Shared reference data (languages, fixed choice lists)

- **Decision**: Fixed choice lists (qualification level, occupation, desired work type, settling
  status) and the language list live in `packages/contracts/src/profiling.ts`, following the
  `permissions.ts` `Object.freeze([...] as const)` pattern for plain enums and `countries.ts`'s
  `{ code, en, de }` shape for the language list, so both server `CHECK` constraints and client UI
  (web console + Expo app) derive from one definition (Constitution I).
- The German-residence constant already exists: `GERMANY = 'DE'` in
  `packages/contracts/src/onboarding.ts:37`, explicitly commented as the value Phase 2 branches on.
  This feature imports it rather than redeclaring it.
- **Alternatives considered**: Hard-coding the choice lists separately in the server and each
  client (rejected outright — exactly the divergence Constitution I exists to prevent).

## R7: Client-side gating (both faces)

- **Decision**: Extend the existing post-approval branch point on both faces, rather than adding a
  new top-level screen the member could navigate to directly.
  - **Web console** (`client/src/onboarding/Application.tsx:43`): `if (next.step === 'approved')
    await enter()` becomes a check of `GET /profiling/status` first; if incomplete, render a new
    `Profiling` component in place of calling `enter()`.
  - **Expo app** (`expo-client/german-world-club/src/session/session.tsx:76-79`): the
    `onboarding.step === 'approved' ? member : applicant` branch gains a third outcome. A new
    `SessionState` member, `{ status: 'profiling'; principal: Principal; profiling: ProfilingStatus
    }`, is set when approved but not yet profiled; a new route group,
    `app/(profiling)/`, mirrors `(applicant)`'s `Stack.Protected` guard pattern
    (`app/(applicant)/_layout.tsx`) and the root `_layout.tsx` gains one more
    `Stack.Protected guard={state.status === 'profiling'}` branch alongside `applicant`/`member`/
    `organisation`.
- **Rationale**: This is the same mechanism Phase 1 already uses to keep an unapproved applicant
  out of the console/app shell without a redirect race — the gate is resolved once, from server
  state, at the one point session status is decided, not scattered across every screen. The server
  enforces the real boundary (R2) regardless of what either client does; this is client UX, not the
  security boundary.
- **Alternatives considered**: A router-level guard checked on every navigation (rejected — more
  code than reusing the existing single decision point, for the same outcome); relying only on the
  server 403 and showing a generic error screen (rejected — every other post-approval, pre-member
  state in this codebase gets its own screen, and profiling is mandatory so it needs one too).

## R8: Q5 conditional follow-ups (added after the business description grew)

- **Decision**: Model the Q5 (`desiredWorkType`) follow-up as five new nullable `member_profiling`
  columns (`future_work_sector`, `future_work_ready`, `future_work_offering`, `future_work_idea`,
  `future_work_priorities`), one `CHECK` constraint restricting which of the five may be non-null
  per `desired_work_type` value, and an application-layer rule that clears the previous value's
  follow-up columns whenever `desiredWorkType` changes before completion (FR-022).
- **Rationale**: Matches the mutual-exclusion pattern already used for germany-vs-elsewhere columns
  in the same table (research R3) rather than introducing a second table or a JSON blob for "the
  rest of the answer" — the shape is fully known at build time (four fixed branches), so there is no
  case here for the flexibility a JSON column would trade correctness for. The clear-on-change rule
  exists because the `CHECK` constraint alone would otherwise let a client submit a new
  `desiredWorkType` while old follow-up data for the previous choice is still sitting in the row,
  which the constraint would then correctly refuse — so the constraint is the backstop and the
  application code is what makes that refusal never actually fire in normal use.
- **Alternatives considered**: A single `desired_work_detail_1`/`desired_work_detail_2` pair of
  generic columns reused across all three non-`not_sure` branches (rejected — Employee's second
  question is a boolean, "ready to work," while Freelance/own-business's second question is free
  text; forcing both into one typed column loses the boolean, and the columns' names would no
  longer describe what they hold); a separate `member_profiling_future_work` child table keyed on
  `member_id` (rejected — one row per member with a handful of nullable columns is exactly the
  sidecar shape research R3 already chose for this table, and a child table buys nothing when at
  most one of the four branches is ever populated per member).

## R9: Nearest-city dropdown for designated countries (post-completion addendum)

- **Decision**: Once `gwc_cities` was reduced from a broad seed to just the UAE emirates, the
  nearest-city step on the Expo app was changed to show a dropdown of `gwc_cities` rows for whichever
  country the member picked, falling back to the existing free-text field for every other country. A
  new read-only route, `GET /profiling/gwc-cities`, exposes the list (`profiling: true` posture,
  `member-read` budget — same shape as `GET /profiling/status`).
- **Rationale**: Confirmed directly with the user rather than assumed, because the alternatives
  differ enormously in scope: this codebase has no comprehensive per-country city dataset and no
  city-search/geocoding-autocomplete integration to reuse (`server/src/integrations/geocoding.ts` is
  a *forward* address→coordinates client for outlet pins, not a city list), so a dropdown covering
  every country a member might live in would mean adding a large new dataset or a brand-new external
  service with its own budget, breaker and declared fallback (Constitution V) — well beyond what a
  short, already-maintained reference list justifies.
- **Alternatives considered**: A comprehensive world-city list or a live places-autocomplete API
  (rejected by the user as out of scope — no such data source exists in this codebase yet); a
  dropdown that only ever shows `gwc_cities` regardless of country, leaving it empty for anyone
  outside the UAE (rejected — makes the field unusable for the large majority of non-German
  members, whose whole point in this branch is usually *not* to match a GWC city).

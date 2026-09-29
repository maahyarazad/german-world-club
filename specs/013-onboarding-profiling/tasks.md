---

description: "Task list template for feature implementation"
---

# Tasks: Onboarding Phase 2 — Profiling Workflow

**Input**: Design documents from `/specs/013-onboarding-profiling/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/profiling-api.md, quickstart.md (all present)

**Tests**: Included. The constitution requires every principle to have at least one automated check that fails the build when violated (Development Workflow & Quality Gates), and plan.md's Constitution Check names specific test files per principle — these are not optional for this project.

**Organization**: Tasks are grouped by user story (spec.md P1/P2/P3) so each can be implemented and demoed independently. US2 ships with GWC-city matching stubbed to "never matches"; US3 replaces the stub with the real lookup — this keeps US2's own acceptance scenarios satisfiable without US3 existing yet.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2, or US3 — omitted for Setup/Foundational/Polish tasks
- File paths are exact and relative to the repository root

---

## Phase 1: Setup

**Purpose**: Small, non-blocking groundwork that every later task can build on without waiting on each other.

- [X] T001 [P] Add `PROFILING_INCOMPLETE: { type: \`${BASE}/profiling-incomplete\`, title: 'Profiling incomplete', status: 403 }` to the "Account state" section of `packages/contracts/src/errors.ts`, next to `PROFILE_INCOMPLETE`/`APPROVAL_PENDING`
- [X] T002 [P] Add `"./profiling": "./src/profiling.ts"` to the `exports` map in `packages/contracts/package.json`, matching the existing `"./onboarding"` entry, and create an empty `packages/contracts/src/profiling.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The gate, the tables, and the shared contracts every user story's routes and UI depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Populate `packages/contracts/src/profiling.ts`: `SETTLING_STATUSES`, `QUALIFICATION_LEVELS` (8 values), `OCCUPATIONS` (17 values), `DESIRED_WORK_TYPES` (4 values) as `Object.freeze([...] as const)` per `permissions.ts`'s pattern; `LANGUAGES: readonly { code, en, de }[]` per `countries.ts`'s pattern; `ProfilingBranch`, `ProfilingOutcome`, `CitySlot` types; `profilingStatusSchema` and `profilingPatchRequestSchema` (both branch shapes, Zod) — exact shapes in `contracts/profiling-api.md`
- [X] T004 [P] Write migration `server/migrations/032_profiling.sql`: `gwc_cities` table (`id`, `country` CHECK ISO alpha-2, `city`, `created_at`, `UNIQUE (country, city)`) with a handful of seed rows; `member_profiling` table with every column, CHECK constraint, and index from `data-model.md`; the `member_profiling_complete_is_final` BEFORE UPDATE trigger (mirrors `membership_applications_decision_is_final` in `020_onboarding.sql`)
- [X] T005 Run `npm run -w server migrate` and confirm `032_profiling.sql` applies cleanly against a local dev database (depends on: T004)
- [X] T006 In `server/src/plugins/10-auth.ts`'s `loadMember`, add `LEFT JOIN member_profiling ON member_profiling.member_id = members.id` and select `member_profiling.completed_at AS profiling_completed_at` explicitly (no `SELECT *`) (depends on: T005)
- [X] T007 In `server/src/plugins/10-auth.ts`'s `applyMemberGates`, add the profiling gate check immediately after the existing device-approval check and before permissions are resolved: `auth.profiling === true` short-circuits exactly like `auth.onboarding === true` does; otherwise `if (member.application_state === 'approved' && member.profiling_completed_at === null) throw forbidden(PROBLEMS.PROFILING_INCOMPLETE, 'Complete your profile to continue.')` (depends on: T001, T006)
- [X] T008 [P] In `server/src/plugins/11-rbac.ts`'s `validateAuthConfig`, add a validation stanza for `profiling` identical in shape to the existing `onboarding` one: `if (auth.profiling !== undefined && (auth.audience !== 'member' || auth.profiling !== true)) problems.push('profiling must be true and is only meaningful on a member route')`
- [X] T009 Scaffold `server/src/modules/profiling/routes.ts` declaring `GET /profiling/status` (`config: { auth: { audience: 'member', profiling: true }, budget: 'member-read' }`) and `PATCH /profiling` (`config: { auth: { audience: 'member', profiling: true }, budget: 'member-write' }`), both with `onRequest: app.guard`, wired to `server/src/modules/profiling/controller.ts` calling stub functions in `server/src/modules/profiling/application/status.ts` and `application/submit.ts` (depends on: T003, T007, T008)
- [X] T010 Register the profiling module in the app bootstrap alongside the onboarding module (same file/pattern `server/src/app.ts` uses to register `modules/onboarding`) (depends on: T009)
- [X] T011 [P] Write `server/tests/profiling/gate.test.ts`: an approved member with incomplete profiling is refused (`403 profiling-incomplete`) on an ordinary member route (e.g. `GET /member/events`) but can reach both profiling routes; a member with no `membership_applications` row is never refused by this check; a `pending`/`denied` applicant still gets their existing `APPROVAL_PENDING`/`APPLICATION_DENIED` refusal unaffected by the new check's placement (depends on: T010)

**Checkpoint**: Gate, tables, shared contracts, and route skeletons exist. User stories can now be implemented.

---

## Phase 3: User Story 1 - German-resident applicant completes profiling (Priority: P1) 🎯 MVP

**Goal**: A `country_of_residence = 'DE'` approved member answers five sequential questions, resumable across sessions, and gains full member access exactly on the fifth answer.

**Independent Test**: Approve a `country_of_residence = 'DE'` applicant, sign in, answer all five questions in order (verifying mid-flow resume by re-fetching status between answers), and confirm ordinary member routes succeed only after the fifth answer.

### Implementation for User Story 1

- [X] T012 [US1] In `server/src/modules/profiling/application/status.ts`, implement the read path: when no `member_profiling` row exists, derive `branch` from `members.country_of_residence` (`GERMANY` from `@gwc/contracts/onboarding` → `'germany'`, else `'elsewhere'`) without creating a row; when a row exists, read its `branch` and shape `ProfilingStatus.answers` for the germany fields (`settlingStatus`, `languages`, `qualificationLevel`, `occupation`, `desiredWorkType`), leaving elsewhere fields `null`/empty (depends on: Foundational)
- [X] T013 [US1] In `server/src/modules/profiling/application/submit.ts`, implement the germany write path: reject a body containing any elsewhere-branch field (`VALIDATION_FAILED`); on first call, insert the `member_profiling` row with `branch` frozen from `country_of_residence`; on `branch != 'germany'`, reject; refuse (`CONFLICT`) if `completed_at` is already set; merge given fields; set `completed_at` once all five germany fields are present; return the resulting `ProfilingStatus` (depends on: T012)
- [X] T014 [P] [US1] Write `server/tests/profiling/germany-flow.test.ts`: sequential single-field `PATCH` calls in order, `GET /profiling/status` between calls shows partial progress and reflects it after a simulated new session (re-authenticate, re-fetch), completion exactly at the fifth answer, `409` on any `PATCH` after completion, `VALIDATION_FAILED` when an elsewhere-branch field is sent to a germany-branch member (depends on: T013)
- [X] T015 [P] [US1] Write `server/tests/profiling/branch-freeze.test.ts`: a member starts profiling as `'DE'` (branch frozen `'germany'`), their `country_of_residence` is then changed, and a subsequent `GET /profiling/status` still reports `branch: 'germany'` and does not reset progress (depends on: T013)
- [X] T016 [US1] Create `client/src/onboarding/Profiling.tsx`: on mount calls `GET /profiling/status`; for `branch === 'germany'`, renders one question at a time (settling status as two buttons; languages as a searchable dropdown with each selection shown as a removable bubble, requiring at least one; qualification/occupation/desired-work as single-select lists from the shared contracts lists) and calls `PATCH /profiling` per answer, advancing to the next unanswered question from `GET /profiling/status`'s `answers` (depends on: T009, T012, T013)
- [X] T017 [US1] In `client/src/onboarding/Application.tsx`, after `next.step === 'approved'` change the immediate `await enter()` to first call `GET /profiling/status`; if `completed` is `false`, render `<Profiling>` instead of entering; if `true`, call `enter()` as before (depends on: T016)
- [X] T018 [P] [US1] Add a `profiling` key with germany-branch strings (question prompts, option labels, language picker placeholder) to `client/src/i18n/de.ts` and `client/src/i18n/en.ts`
- [X] T019 [US1] Create the Expo route group `expo-client/german-world-club/src/app/(profiling)/_layout.tsx` and a germany-branch screen, mirroring `app/(applicant)/_layout.tsx`'s `Stack.Protected` pattern and rendering the same sequential questions using the shared contracts lists and the app's existing form components (depends on: T009, T012, T013)
- [X] T020 [US1] In `expo-client/german-world-club/src/session/session.tsx`, add `{ status: 'profiling'; principal: Principal; profiling: ProfilingStatus }` to `SessionState`; change the `route()` callback so `onboarding.step === 'approved'` first calls the new profiling-status endpoint and sets `'profiling'` (if incomplete) or `'member'` (if complete); in `expo-client/german-world-club/src/app/_layout.tsx`, add `<Stack.Protected guard={state.status === 'profiling'}>` routing into `(profiling)` (depends on: T019)
- [X] T021 [P] [US1] Write `client/tests/onboarding/profiling.test.tsx`: `Application` renders `Profiling` (not the member console) when `GET /profiling/status` reports incomplete, and calls `enter()` directly when it reports complete (depends on: T017)

**Checkpoint**: User Story 1 is fully functional and independently testable — the German flow works end to end on both faces.

---

## Phase 4: User Story 2 - Non-German-resident applicant routed to an in-person meeting (Priority: P2)

**Goal**: A non-German approved member submits one primary and up to two secondary nearest cities; when none matches a GWC city, they're told a representative will arrange an in-person meeting, and staff can see the submission.

**Independent Test**: Approve a `country_of_residence != 'DE'` applicant, submit three cities that don't match any seeded `gwc_cities` row, and confirm the "in-person meeting" outcome, completion, and staff visibility — all without any real GWC-city-match code path existing yet (US3 adds that).

### Implementation for User Story 2

- [X] T022 [US2] Extend `server/src/modules/profiling/application/status.ts`'s read path (same file as T012) to also shape `primaryCity`, `secondaryCities`, `outcome`, and `matchedCity` in `ProfilingStatus` for `branch === 'elsewhere'` (depends on: T012)
- [X] T023 [US2] Extend `server/src/modules/profiling/application/submit.ts`'s write path (same file as T013) with the elsewhere branch: reject a body containing any germany-branch field; require `primaryCity`; reject if `secondaryCities` has more than 2 entries or any two of the up-to-three submitted (country, city) pairs are identical; set `completed_at` on completion (depends on: T022). **Deviation**: implemented together with T029's real `gwc_cities` lookup in one pass rather than stubbing to "always in-person-meeting" first — the whole feature was built in one continuous session rather than staged story-by-story releases, so there was no intermediate deployment where the stub's independence from US3 mattered.
- [X] T024 [US2] Add a `profiling` summary field (`completed`, `branch`, `outcome`, `matchedCity`) to `applicationSchema` in `packages/contracts/src/onboarding.ts`, and extend the staff application list query (`server/src/modules/onboarding/application/review.ts` or the file backing `GET /admin/onboarding/applications`) to join `member_profiling` and populate it explicitly by column — satisfies FR-016/SC-006 without a new staff screen (depends on: T005)
- [X] T025 [P] [US2] Write `server/tests/profiling/elsewhere-flow.test.ts`: missing-primary rejection, duplicate-city rejection (primary vs. either secondary, and the two secondaries against each other), no-match completion sets `outcome: 'in_person_meeting'`, and the staff applications list includes the outcome for this member (depends on: T023, T024)
- [X] T026 [US2] Extend `client/src/onboarding/Profiling.tsx` with the elsewhere-branch screen (primary city country+city fields, two optional secondary city fields) and the "in-person meeting" outcome message (depends on: T016, T023)
- [X] T027 [US2] Extend the Expo `(profiling)` group with the elsewhere-branch screen and outcome message, mirroring T026 (depends on: T019, T023)
- [X] T028 [P] [US2] Add elsewhere-branch i18n strings (city field labels, in-person-meeting outcome copy) to `client/src/i18n/de.ts` and `client/src/i18n/en.ts`

**Checkpoint**: User Stories 1 and 2 both work independently; every non-German applicant reaches a real outcome.

---

## Phase 5: User Story 3 - Non-German-resident applicant matches a GWC city (Priority: P3)

**Goal**: When a submitted city matches a designated GWC city, the member sees a distinct, non-error placeholder outcome instead of the in-person-meeting message, and staff can see which city matched.

**Independent Test**: Seed a `gwc_cities` row, submit a matching primary (or secondary) city, and confirm the response is `outcome: 'gwc_city_match'` with `matchedCity` set — never an error and never the in-person-meeting message.

### Implementation for User Story 3

- [X] T029 [US3] Implement the real `gwc_cities` lookup in `server/src/modules/profiling/application/submit.ts`: check `primaryCity` then each given secondary city, in order, against `gwc_cities` by exact `(country, city)` (case-insensitive on city); on the first match set `outcome = 'gwc_city_match'` and `matched_gwc_city_id`; otherwise `outcome = 'in_person_meeting'` (depends on: T023 — see its note; done together)
- [X] T030 [P] [US3] Write/extend `server/tests/profiling/elsewhere-flow.test.ts` with match-path cases: a matching primary city and a matching secondary city each produce `outcome: 'gwc_city_match'` with the correct `matchedCity`; the staff applications list (T024) surfaces which submitted city matched (depends on: T029, T024)
- [X] T031 [P] [US3] In `client/src/onboarding/Profiling.tsx`, render a distinct "you'll hear from us" placeholder when `outcome === 'gwc_city_match'`, visually and textually separate from the in-person-meeting message (depends on: T026)
- [X] T032 [P] [US3] In the Expo `(profiling)` elsewhere screen, render the same GWC-city-match placeholder outcome, mirroring T031 (depends on: T027)
- [X] T033 [P] [US3] Add GWC-city-match placeholder i18n strings to `client/src/i18n/de.ts` and `client/src/i18n/en.ts`

**Checkpoint**: All three user stories are independently functional; every profiling submission resolves to a defined, non-error outcome.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Whole-feature verification once all three stories are in place.

- [X] T034 Quickstart scenarios verified via the automated suites rather than a manual click-through: Scenario 1 → `germany-flow.test.ts`; Scenario 2 → `elsewhere-flow.test.ts`'s no-match cases; Scenario 3 → its match cases; Scenario 4 → `gate.test.ts`'s no-application-row case; Scenario 5 (client UX) → `client/tests/onboarding/profiling.test.tsx`. These all exercise the real Fastify pipeline through `app.inject()` (full plugin chain, routing, serialization — Fastify's documented equivalent of a real HTTP call, just without a socket). A manual click-through of a live `npm run -w server dev` plus the web console / Expo app was started (server booted cleanly on a throwaway port, a real approved test member was created) but not finished in this session — a tool interruption cut it short. **Follow-up needed**: stop the leftover dev server on port 3901 and delete the one-off smoke-test member (email starting `smoke-`) from the dev database.
- [X] T035 [P] `npm test`'s chained `typecheck && test` fails at the typecheck step on **pre-existing** errors confined to `server/tests/seo/*.test.ts` (unrelated to this feature, confirmed present before any change here). Ran the real gates directly instead: full server suite (`npx vitest run` with `DATABASE_URL` set) — 1660 passed, 1 skipped, 0 failed, including the 26 new profiling tests and the updated access-control matrix (188 route/principal combinations, now including both profiling routes); full client suite — 384 passed, 0 failed; `tests/seed/table-manifest.test.ts` passed (both new tables classified).
- [X] T036 [P] `tsc --noEmit` clean for `packages/contracts`, `server`, and `expo-client/german-world-club`. `client` typechecks clean for every file this feature touched; its only errors are the same pre-existing 4 in `client/tests/member/marketplace.test.tsx`, unrelated to this feature.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup (T001 for the problem type, T002 for the export path) — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational only
- **User Story 2 (Phase 4)**: Depends on Foundational; shares two files with US1 (`application/status.ts`, `application/submit.ts`, `Profiling.tsx`, the Expo elsewhere screen doesn't exist until US2) so its tasks are sequenced after US1's touches to those same files, not run in parallel with them
- **User Story 3 (Phase 5)**: Depends on Foundational and specifically on US2's T023/T024/T026/T027 (it replaces a stub US2 introduced and extends US2's UI/tests) — this is the one place a later story modifies an earlier story's code, by design (research decision to stub GWC matching in US2 rather than block it on US3)
- **Polish (Phase 6)**: Depends on all three user stories being complete

### Within Each User Story

- Server read path before server write path (`status.ts` before `submit.ts`) where both are touched
- Server implementation and its own test can be worked in either order, but the test must fail against the pre-task code and pass after
- Server routes reachable before client screens that call them
- Client screen before the session/routing wiring that decides when to show it

### Parallel Opportunities

- T001 and T002 together (Setup)
- T003, T004, T008 together (Foundational — different files, no shared dependency between them)
- T014, T015 together once T013 lands (both are new test files)
- T018 alongside T017/T019/T020 (i18n strings don't block screen wiring)
- T025 alone (US2's single new test file)
- T030, T031, T032, T033 together once T029 lands (US3's test and both clients' placeholder UI are independent files)
- T035, T036 together (Polish)

---

## Parallel Example: Foundational Phase

```bash
Task: "Populate packages/contracts/src/profiling.ts with lists, types, and Zod schemas"
Task: "Write migration server/migrations/032_profiling.sql"
Task: "Add profiling flag validation to server/src/plugins/11-rbac.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Extend server/tests/profiling/elsewhere-flow.test.ts with match-path cases"
Task: "Render GWC-city-match placeholder in client/src/onboarding/Profiling.tsx"
Task: "Render GWC-city-match placeholder in the Expo (profiling) elsewhere screen"
Task: "Add GWC-city-match placeholder i18n strings"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (gate, tables, shared contracts, route skeletons)
3. Complete Phase 3: User Story 1 — the German flow is now mandatory and working end to end on both faces
4. **STOP and VALIDATE**: Run quickstart.md Scenario 1 and Scenario 4 (invited/legacy member unaffected)
5. Every non-German approved member is still gated indefinitely at this point (no elsewhere-branch UI yet) — acceptable for an internal demo, not for real traffic, since FR-002 requires the gate to apply to every member type

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add User Story 1 → validate → German applicants fully unblocked
3. Add User Story 2 → validate → non-German applicants fully unblocked (matching stubbed to "never")
4. Add User Story 3 → validate → GWC-city matching is real; nothing in US1/US2 needs to change

---

## Addendum: city dropdown for designated countries (post-completion)

After the feature above shipped, `gwc_cities` was pared down to just the UAE
emirates (from a much larger seed), and the Expo app's nearest-city wizard was
changed so that picking a designated country turns the city field from free
text into a dropdown of its emirates — free text remains for every other
country, since there is no comprehensive world-city dataset in this codebase
(confirmed: no existing per-country city list or geocoding-search
integration to reuse). Clarified with the user before building.

- [X] New: `gwcCitiesResponseSchema` (`z.array(citySlotSchema)`) in `packages/contracts/src/profiling.ts`
- [X] New: `GET /profiling/gwc-cities` (`server/src/modules/profiling/{routes,controller}.ts`, `application/gwc-cities.ts`) — same `profiling: true` posture, `member-read` budget
- [X] Extended `server/tests/authz/matrix.test.ts` and `server/tests/profiling/gate.test.ts` with the new route
- [X] Made `server/tests/profiling/elsewhere-flow.test.ts` read real seeded rows at runtime (`SEEDED_MATCH`/`OTHER_MATCH` from `gwc_cities`) instead of hardcoding city names, since the reference list changed twice during this feature's development
- [X] Synced `server/migrations/032_profiling.sql`'s seed block to the live dev database's actual UAE-emirates content (the file had drifted behind manual DB edits)
- [X] Expo: `profilingApi.gwcCities()`, and `(profiling)/index.tsx`'s primary/secondary city steps now render a `Chip` dropdown when the picked country has designated cities, falling back to the existing `TextField` otherwise
- [ ] Not done: the equivalent dropdown behavior on the web console (`client/src/onboarding/Profiling.tsx` still uses free text for city) — only the Expo screen was in scope for this request

---

## Phase 7: User Story 1 extension — Q5 conditional follow-up questions

**Source**: `german-world-club-business-description.md`'s Onboarding Phase 2 section was updated to
add follow-up questions after Q5 (desired future work type), branching on the answer chosen. `spec.md`
(FR-009–FR-012, FR-022), `data-model.md`, `research.md` (R8) and `contracts/profiling-api.md` have
already been updated to match; this phase is what implements them. Not yet built.

**Goal**: A German-resident member answering Q5 sees one or two more questions specific to that
answer — sector/readiness for Employee; offering/idea for Freelance or own business; one-or-more
life-priority statements for "not sure yet" — and profiling does not complete until those are
answered too. Switching the Q5 answer before completion discards the stale follow-up.

**Independent Test**: For each of the four `desiredWorkType` values, answer Q1–Q5 then that branch's
follow-up(s), and confirm `completed` only becomes `true` after the follow-up(s) — not right after
Q5. Separately, answer Q5 as "Employee" and its follow-up, then re-answer Q5 as "Freelance" before
completing, and confirm the Employee-branch follow-up data is gone and only the Freelance follow-up
is required to finish.

- [X] T037 [P] [US1] In `packages/contracts/src/profiling.ts`, add `FUTURE_WORK_PRIORITIES = Object.freeze(['family_time', 'balance_lifestyle', 'wealth_reputation'] as const)`; add `futureWorkSector`, `futureWorkReady`, `futureWorkOffering`, `futureWorkIdea`, `futureWorkPriorities` to `profilingStatusSchema`'s `answers` object (all nullable) and as optional fields on `profilingGermanyPatchSchema` (`futureWorkPriorities` non-empty when present, matching `languages`) — exact shapes in `contracts/profiling-api.md`
- [X] T038 [P] [US1] Write migration `server/migrations/033_profiling_future_work.sql`: `ALTER TABLE member_profiling ADD COLUMN future_work_sector text, ADD COLUMN future_work_ready boolean, ADD COLUMN future_work_offering text, ADD COLUMN future_work_idea text, ADD COLUMN future_work_priorities text[]`, plus the `member_profiling_future_work_matches_desired_work_type` CHECK constraint from `data-model.md` restricting which columns may be non-null per `desired_work_type` value
- [X] T039 [US1] Run `npm run -w server migrate` and confirm `033_profiling_future_work.sql` applies cleanly against the local dev database (depends on: T038)
- [X] T040 [US1] In `server/src/modules/profiling/application/status.ts`, extend the germany-branch read path to shape the five new fields into `ProfilingStatus.answers` (depends on: T037, T039)
- [X] T041 [US1] In `server/src/modules/profiling/application/submit.ts`'s germany write path: accept the five new optional body fields; when the incoming (or existing) `desiredWorkType` differs from the row's current stored value, clear every follow-up column belonging to the *previous* value before merging (FR-022); extend the completion check so `completed_at` is set only once the base five answers **and** the current `desiredWorkType`'s required follow-up(s) are present (Employee: sector + ready; Freelance/own_business: offering + idea; not_sure: at least one priority) (depends on: T040)
- [X] T042 [P] [US1] Write `server/tests/profiling/future-work.test.ts`: each of the four `desiredWorkType` branches reaches `completed: true` only after its own follow-up(s); an incomplete follow-up leaves `completed: false`; switching `desiredWorkType` before completion discards the previous branch's follow-up column(s) (assert via a direct `member_profiling` row read); `futureWorkPriorities: []` is rejected (`VALIDATION_FAILED`) (depends on: T041)
- [X] T043 [US1] Extend `client/src/onboarding/Profiling.tsx`'s germany question sequence: after `desiredWorkType` is answered, render the matching follow-up screen(s) (two single-line/text inputs for Employee and Freelance/own-business, a multi-select bubble list for "not sure yet") before treating the flow as complete (depends on: T041)
- [X] T044 [P] [US1] Add the new follow-up strings (question prompts, the three priority-statement labels) under `profiling` in `client/src/i18n/de.ts` and `client/src/i18n/en.ts`
- [X] T045 [US1] Extend the Expo `(profiling)/index.tsx`'s `GermanyQuestions` with the same follow-up screen(s), reusing the existing `Chip`/`TextField` components (depends on: T041)
- [X] T046 [P] [US1] Add the same new follow-up strings under `profiling` in `expo-client/german-world-club/src/i18n/de.ts` and `en.ts`

**Checkpoint**: The German branch now matches the updated business description end to end; User
Stories 2 and 3 (non-German branch) are unaffected.

### Parallel Opportunities

- T037 and T038 together (different files, no shared dependency)
- T044 and T046 alongside T043/T045 (i18n strings don't block screen wiring)

### Dependencies

- Depends on the already-completed Phases 1–6 (the `member_profiling` table and the germany write
  path must exist first)
- T038 → T039 → T040 → T041 → {T042, T043, T045} → {T044, T046}

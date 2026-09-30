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

---

# Revision 2 (2026-09-29): updated Profiling Workflow + go-back

**Branch**: `013-profiling-relationship-goback` (cut from `main` after PR #9).

**Input**: `spec.md` Revision 2 (Stories 4 and 5, FR-023–FR-034, amended FR-008–FR-014/016/017/020/022),
`plan.md` "Revision 2", `research.md` R10–R15, `data-model.md` Revision 2 (`034`),
`contracts/profiling-api.md` Revision 2, `quickstart.md` Scenarios 6–9.

**Tests**: Included — plan.md's Revision 2 Constitution Check names a test per principle.

**Behaviour change to keep in mind**: after this revision `PATCH /profiling` never completes profiling;
only `POST /profiling/submit` does (R10). Every earlier test or client that relied on "last answer
completes" is updated inside the phase that changes it (US5), not left failing.

**Story map**: US1 (amended: income + Q7 paths), US5 (submit + go back, both branches — P1, MVP of this
revision), US4 (relationship / kids / partner, both branches — P2), US2/US3 (amended: elsewhere
saves cities, outcome at submit — done inside US5 because it cannot ship separately).

## Phase 8: Revision 2 Setup & Foundational (blocks all Revision 2 stories)

- [X] T047 [P] Add `PROFILING_ANSWERS_MISSING: { type: \`${BASE}/profiling-answers-missing\`, title: 'Profiling answers missing', status: 409 }` to the "Account state" section of `packages/contracts/src/errors.ts`, next to `PROFILING_INCOMPLETE`
- [X] T048 [P] In `packages/contracts/src/profiling.ts` add `YEARLY_INCOME_RANGES` (`up_to_50k`, `50k_to_100k`, `over_100k`), `RELATIONSHIP_TAGS` (`single`, `partner`, `family`, `kids`), `KID_AGE_RANGES` (`age_0_6`, `age_6_14`, `age_14_18`, `age_18_plus`) as `Object.freeze([...] as const)`, and add `'business_owner'` to `DESIRED_WORK_TYPES` (order: employee, freelance, business_owner, own_business, not_sure)
- [X] T049 In `packages/contracts/src/profiling.ts` extend `profilingStatusSchema.answers` with `yearlyIncomeRange`, `relationshipStatus` (nullable tag array), `kids` (`KID_AGE_RANGES` array, `[]` when none) and `partner` (nullable `{ settlingStatus, languages, yearlyIncomeRange, qualificationLevel, occupation }`, each nullable); replace both patch schemas per `contracts/profiling-api.md` Revision 2 (both branches "non-empty subset" and `.strict()`; `secondaryCities` only with `primaryCity`; `kids` 1–20; `relationshipStatus` non-empty and `single` exclusive via `.refine`; `partner` a partial of the five partner fields) (depends on: T048)
- [X] T050 In `packages/contracts/src/profiling.ts` implement and export `profilingSteps(branch, answers)` and `profilingMissing(branch, answers)` plus `ProfilingStepId` and `ProfilingAnswers`, exactly the step order in `contracts/profiling-api.md` (Germany: settling, languages, income, qualification, occupation, relationship, kids?, partner x5?, work-type, path follow-ups, review; elsewhere: cities, relationship, kids?, partner x5?, review; Q7 paths: employee → industry, ready; freelance/own_business → offering, industry, idea; business_owner → industry, idea; not_sure → priorities, industry) (depends on: T049)
- [X] T051 [P] Write `packages/contracts/tests/profiling-steps.test.ts`: for every Q6 tag combination × every Q7 value × both branches, assert the step list contents/order, that `profilingMissing` lists exactly the unanswered applicable steps, that the elsewhere list never contains a `work-*` step, that `single` yields no kids/partner steps, and a counter-assertion that an answered-then-inapplicable field (e.g. kids after removing the tag) is ignored (depends on: T050)
- [X] T052 [P] Write migration `server/migrations/034_profiling_relationship.sql` per `data-model.md` Revision 2: `yearly_income_range` and `relationship_tags` columns; replace `member_profiling_desired_work_type` (add `business_owner`), `member_profiling_germany_fields_only_in_germany_branch` (add income) and `member_profiling_future_work_matches_desired_work_type` (industry on any non-null type, ready employee-only, offering freelance/own_business, idea freelance/own_business/business_owner, priorities not_sure) using idempotent `DROP CONSTRAINT IF EXISTS` + `ADD`; `member_profiling_relationship_tags_valid`; tables `member_profiling_kids` and `member_profiling_partner` with their CHECKs; trigger `member_profiling_children_are_final` on both tables
- [X] T053 Run `npm run -w server migrate` and confirm `034_profiling_relationship.sql` applies cleanly on a database that already has completed and in-progress `member_profiling` rows from `032`/`033` (depends on: T052)
- [X] T054 [P] In `server/src/seed/tables.ts` list `member_profiling_kids` and `member_profiling_partner` under `HISTORY` next to `member_profiling` (never seeded), and confirm `server/tests/seed/` manifest tests pass
- [X] T055 [P] Write `server/tests/profiling/relationship-schema.test.ts` (SQL suite): `single` plus another tag rejected by the CHECK; empty tag array rejected; bad `age_range`/income value rejected; a kids or partner INSERT/UPDATE/DELETE after `completed_at` is set raises; the same writes before completion succeed; a completed pre-revision row still cannot be updated (depends on: T053)

**Checkpoint**: Contracts, step engine and schema exist; nothing user-visible has changed yet.

---

## Phase 9: User Story 1 amendments — income and the five Q7 paths (P1)

**Goal**: German flow matches the new Q1–Q5 and Q7: income question inserted, `business_owner` path, industry asked on every path.

**Independent Test**: For each of the five `desiredWorkType` values, PATCH the base answers, income and that path's follow-ups; `profilingMissing` is empty only when the path is fully answered; switching paths clears the previous path's follow-ups.

- [X] T056 [US1] In `server/src/modules/profiling/application/status.ts` select and shape `yearly_income_range` → `yearlyIncomeRange` (explicit columns; no `SELECT *`) (depends on: T053, T049)
- [X] T057 [US1] In `server/src/modules/profiling/application/submit.ts` `submitGermany`: accept `yearlyIncomeRange`; extend `FUTURE_WORK_FIELDS_FOR` to the new mapping (employee: sector, ready; freelance/own_business: offering, sector, idea; business_owner: sector, idea; not_sure: priorities, sector); keep the FR-022 clear-on-change rule with that mapping; **remove the auto-completion** (`completed_at` is no longer set here — see T064) (depends on: T056)
- [X] T058 [P] [US1] Update `server/tests/profiling/germany-flow.test.ts` and `server/tests/profiling/future-work.test.ts` for income, `business_owner`, industry-on-every-path, and "PATCH never completes"; add a switch-path case per pair of paths asserting stale follow-ups are gone (depends on: T057)
- [X] T059 [P] [US1] Add the income question, the `business_owner` option and industry step strings (Q3 prompt and three ranges, "Business Owner", "Build My Own Business", "Freelancer", industry and "product or service" prompts) to `client/src/i18n/de.ts`, `client/src/i18n/en.ts`, `expo-client/german-world-club/src/i18n/de.ts` and `en.ts`

**Checkpoint**: Server accepts the new German answers; clients not yet updated (they are rebuilt in US5).

---

## Phase 10: User Story 5 - Submit is the only completion; go back and change answers (P1) 🎯 MVP of Revision 2

**Goal**: Answers are saved as you go, freely re-answerable; a review step shows them all; `POST /profiling/submit` completes. Includes the elsewhere branch (cities saved, outcome computed at submit). Both clients get Back + review.

**Independent Test**: Quickstart Scenarios 6 and 9. Answer the last question via PATCH → still `completed: false`; change an earlier answer; submit → complete; further PATCH/submit → 409.

- [X] T060 [US5] In `server/src/modules/profiling/application/submit.ts` `submitElsewhere`: save `primaryCity`/`secondaryCities` as a unit without resolving the outcome (no GWC lookup, no `completed_at`), validating distinctness; a partial body (only `primaryCity`) clears secondaries only when `secondaryCities` is given (depends on: T057)
- [X] T061 [US5] Create `server/src/modules/profiling/application/complete.ts` exporting `completeProfiling(app, { memberId, signal })`: in one `withTransaction`, `SELECT … FOR UPDATE` the row (explicit columns) plus kids/partner, rebuild `ProfilingAnswers`, compute `profilingMissing` from `@gwc/contracts/profiling`; if non-empty throw `PROFILING_ANSWERS_MISSING` (409, missing step ids as an extension member); if already complete throw `CONFLICT`; for `elsewhere` run the existing GWC lookup (primary first) and set `outcome` + `matched_gwc_city_id`; set `completed_at`; return `loadProfilingStatus` (depends on: T060, T050)
- [X] T062 [US5] In `server/src/modules/profiling/routes.ts` and `controller.ts` add `POST /profiling/submit` with `config: { auth: { audience: 'member', profiling: true }, budget: 'member-write' }`, `onRequest: app.guard`, response `profilingStatusSchema`; extend the `PATCH` body schema import to the new union (depends on: T061)
- [X] T063 [P] [US5] Write `server/tests/profiling/submit.test.ts`: PATCH of the last answer leaves `completed: false` and ordinary routes 403 `profiling-incomplete`; submit with a missing step → 409 `profiling-answers-missing` naming it (counter-assertion: the row is unchanged); full germany submit → complete and ordinary routes succeed; elsewhere `outcome`/`matchedCity` null before submit and set after (in-person and GWC-match cases, using seeded rows read at runtime as `elsewhere-flow.test.ts` does); PATCH or second submit after completion → 409 (depends on: T062)
- [X] T064 [P] [US5] Write `server/tests/profiling/go-back.test.ts`: re-sending an answered field replaces it and leaves the others; changing the elsewhere cities after saving them replaces them; changing `desiredWorkType` clears follow-ups; nothing stale is present in the status after each change; state survives a fresh session (depends on: T062)
- [X] T065 [P] [US5] Update `server/tests/profiling/elsewhere-flow.test.ts`, `gate.test.ts`, `branch-freeze.test.ts` and `server/tests/authz/matrix.test.ts` for the new completion semantics and to include `POST /profiling/submit` across every principal kind (depends on: T062)
- [X] T066 [US5] Add `profilingApi.submit()` (and the extended `patch` typing) to `client/src/lib/api.ts` and `expo-client/german-world-club/src/api/endpoints.ts` (depends on: T062)
- [X] T067 [US5] Restructure `client/src/onboarding/Profiling.tsx` into `client/src/onboarding/profiling/` (step components per `ProfilingStepId`, a `useProfilingWizard` hook holding the current step id): the step list comes from `profilingSteps(status.branch, status.answers)` recomputed after every save; Continue PATCHes then advances; **Back** on every step but the first shows the previous step with the saved answer preselected; a **Review** step lists each answer with "Change" (returns to review after save) and a Submit that calls `profilingApi.submit()`; on `PROFILING_ANSWERS_MISSING` jump to the first missing step (no error state, `console.error('Profiling.submit', …)` per the CLAUDE.md client-failure rule); after submit show the existing outcome / hand off to `onComplete` (depends on: T066, T059)
- [X] T068 [US5] Move the Expo wizard out of the single `expo-client/german-world-club/src/app/(profiling)/index.tsx` into per-step components under `expo-client/german-world-club/src/app/(profiling)/` mirroring T067: header Back plus Android `BackHandler` (back on the first step exits as today), preselected saved answers, Review with Change, Submit, first-missing-step jump; the existing GWC-cities chip dropdown for city steps is kept (depends on: T066, T059)
- [X] T069 [P] [US5] Add Back, Review, "Change", Submit and completion strings to `client/src/i18n/{de,en}.ts` and `expo-client/german-world-club/src/i18n/{de,en}.ts`; run `npm run -w client test:i18n`
- [X] T070 [P] [US5] Extend `client/tests/onboarding/profiling.test.tsx`: Back shows the previous step with the saved answer; changing an earlier answer and continuing keeps later answers; "Change" from review returns to review; the last answer alone does not complete (Submit does); a 409 `profiling-answers-missing` moves to the first missing step without an error banner (depends on: T067)

**Checkpoint**: Going back and explicit submit work on both faces and both branches. Story 2 and 3 outcomes still appear (now after Submit).

---

## Phase 11: User Story 4 - Relationship, kids and partner (P2)

**Goal**: Q6 on both branches with Single exclusivity, kids count + per-kid age range, partner Q1–Q5 questionnaire; German continues to Q7, non-German goes to review.

**Independent Test**: Quickstart Scenario 7.

- [X] T071 [US4] In `server/src/modules/profiling/application/status.ts` read `relationship_tags`, the kids rows (ordered by `position`) and the partner row (explicit columns) into `relationshipStatus`, `kids`, `partner` (depends on: T053, T049)
- [X] T072 [US4] In `server/src/modules/profiling/application/submit.ts` handle `relationshipStatus`, `kids`, `partner` for **both** branches in the same transaction as the write: ensure the parent row exists (branch frozen as today); apply the R14 cascades (no `kids` tag → delete kid rows; neither `partner` nor `family` → delete partner row; `single` → both); reject `kids` without the tag or `partner` without `partner`/`family` (`VALIDATION_FAILED`); replace kid rows wholesale on `kids`; upsert only the given partner fields (depends on: T071, T057, T060)
- [X] T073 [P] [US4] Write `server/tests/profiling/relationship-flow.test.ts`: `single`+other → 400; kids/partner sub-answers persisted and returned; each cascade in Scenario 7 step 3 leaves no orphan rows (counter-assertion: rows do exist before the change); partner answers use the same enum validation as the member's own; submit is refused while kids ages or any of the five partner answers are missing and accepted when complete; both branches; non-German step list ends at review with no Q7 (depends on: T072, T061)
- [X] T074 [US4] **Not changed, deliberately.** `server/src/modules/onboarding/application/review.ts` exposes only branch/completed/outcome/matched city to staff and never exposed the German answers; adding income, tags, kids and partner answers would widen what a staff *list* endpoint returns (and `applicationSchema` in contracts) beyond this feature's ask. The answers remain queryable in `member_profiling*` (FR-019). If staff need to see them in the console, that is a separate, explicit change.
- [X] T075 [P] [US4] Add `client/src/onboarding/profiling/` steps: relationship bubbles (selecting Single deselects the rest and selecting another deselects Single), kids count input with N per-kid age-range pickers (changing N keeps existing ranges by position), and the partner wizard reusing the German question components via a `subject: 'self' | 'partner'` prop so the five partner steps write to `partner` (depends on: T067, T072)
- [X] T076 [P] [US4] Add the same relationship / kids / partner steps to the Expo `(profiling)` screens, reusing `Chip`/`TextField` (depends on: T068, T072)
- [X] T077 [P] [US4] Add relationship, tag, kid-count, age-range and partner-section strings (with the partner variants of the five questions) to `client/src/i18n/{de,en}.ts` and `expo-client/german-world-club/src/i18n/{de,en}.ts`; run `npm run -w client test:i18n`
- [X] T078 [P] [US4] Extend `client/tests/onboarding/profiling.test.tsx`: Single exclusivity both ways, N kids → N pickers, Partner shows five partner steps and no Q6, German continues to Q7 while non-German goes to review (depends on: T075)

**Checkpoint**: Full updated workflow on both faces.

---

## Phase 12: Polish & Cross-Cutting (Revision 2)

- [X] T079 Scenarios 6–9 are covered by automated suites: Scenario 6 → `go-back.test.ts` + `client/tests/onboarding/profiling.test.tsx` (Back, Change from review); Scenario 7 → `relationship-flow.test.ts`, `relationship-schema.test.ts`, `profiling-steps.test.ts`; Scenario 8 → `future-work.test.ts` (every from→to path pair); Scenario 9 → `submit.test.ts`, `gate.test.ts`. **Not done: a manual click-through of the web console and the Expo app** — the Expo screens have no automated tests and were only type-checked (`tsc --noEmit` clean) and linted (no new `expo lint` problems).
- [X] T080 `tsc --noEmit` clean for `packages/contracts`, `client` and `expo-client/german-world-club`; `server` has many pre-existing errors elsewhere (none in `src/modules/profiling`, `src/seed/tables.ts`). Server suites run against a real database: all `tests/profiling` (63 tests) pass; the failures in `authz`/`ops`/`onboarding` are identical with and without this change (development-mode swagger routes and an SMS-rollback test). `expo lint` and `client` lint report the same pre-existing errors as before (`set-state-in-effect`).
- [X] T081 [P] Update `CLAUDE.md`'s profiling paragraph with the two rules that would otherwise surprise: **completion is `POST /profiling/submit`, never a PATCH**, and **kids/partner rows are final with the parent (trigger)**; keep it to the existing style (why, not what)
- [X] T082 [P] Superseded and done by T121: the web console's city steps now use the searchable city dropdown fed by `GET /profiling/cities`.

### Dependencies & Execution Order (Revision 2)

- Phase 8 first; T047, T048, T052, T054 in parallel; T049 → T050 → T051; T052 → T053 → T055.
- Phase 9 (US1 amendments) after T053/T049; server tasks before the client work in Phase 10.
- Phase 10 (US5) after Phase 9: T060 → T061 → T062 → {T063, T064, T065, T066}; T066 → {T067, T068} → T070; T069 alongside.
- Phase 11 (US4) after Phase 10 (needs the wizard structure and the submit check): T071 → T072 → {T073, T074, T075, T076}; T077 alongside; T078 after T075.
- Phase 12 last.

### Parallel Examples

```bash
# Phase 8
Task: "T047 PROFILING_ANSWERS_MISSING in errors.ts"
Task: "T048 new lists + business_owner in contracts/profiling.ts"
Task: "T052 migration 034_profiling_relationship.sql"
Task: "T054 seed manifest tables"
# Phase 11, once T072 lands
Task: "T073 relationship-flow.test.ts"
Task: "T075 web relationship/kids/partner steps"
Task: "T076 Expo relationship/kids/partner steps"
```

### Implementation Strategy

1. Build in order Phase 8 → 9 → 10 → 11, validating after each checkpoint. Phase 10 is the first point where Back/Review/Submit work end to end, so it is the **demo/MVP checkpoint** for this revision.
2. **Release unit is Phases 8–11 together.** Q6 is required (FR-024) and the shared step engine includes it from T050, so shipping Phase 10 without Phase 11 would leave members with a mandatory step no client renders. Likewise T057 removes PATCH auto-completion and T062 restores completion via submit, so never deploy between them.
3. Phase 12 closes out.


---

# Revision 3 (2026-09-29): partner settling removed, industry dropdown, single-select statement

- [X] T083 [US4] Remove the partner's settling question everywhere: `partner.settlingStatus` and `partner-settling` from `packages/contracts/src/profiling.ts`; migration `server/migrations/035_profiling_industry_single_priority.sql` drops `member_profiling_partner.settling_status`; `status.ts`/`submit.ts` no longer read or write it; web and Expo partner steps start at languages
- [X] T084 [US1] Industry as a fixed list: `INDUSTRIES` (21 codes) in contracts, `futureWorkSector` validated as one of them, migration clears unfinished free-text values and adds a `NOT VALID` CHECK; dropdown on web (`client/src/onboarding/profiling/steps.tsx`), chip picker on Expo (the app's idiom for a fixed list); new wording and de/en labels in all four i18n catalogues
- [X] T085 [US1] "I am not sure yet" statement is a single choice: `futureWorkPriority` replaces `futureWorkPriorities` in contracts, server, both clients and tests; migration keeps the first element of unfinished multi-selections and adds a `NOT VALID` single-element CHECK
- [X] T086 Update tests: `future-work`, `relationship-flow`, `relationship-schema`, `germany-flow`, contracts `profiling-steps`, web `profiling.test.tsx` (industry dropdown lists exactly the 21 values; partner never asked settling; single-select statement)

---

# Revision 4 (2026-09-30): Phase 1 rules + Phase 2 rewrite (from the updated business description)

**Source of truth**: `german-world-club-business-description.md`, "Onboarding — Phase 1" and "Phase 2" (both rewritten). It is not tracked by git; read it before starting.

**Branch**: continue on `013-profiling-relationship-goback`.

**Decisions taken with the user for this revision** (from the questions asked before generating these tasks):
1. **Partner "same German questionnaire from Q1"** → the partner is asked the **settling question again** (Yes / Please help, country, city, Dubai follow-up). This **reverses Revision 3's removal** of `partner-settling`.
2. **Q7 "I am not sure yet"** → **multi-select** statements, **no industry question** on this path. This **reverses Revision 3's** single-select and industry-on-all-paths for `not_sure` only. The industry dropdown (21 items) stays for every other path.
3. **Country "Others"** → opens the full country picker; the ISO code is stored as today (`members.country_of_residence`). Germany / Austria / Switzerland are shortcuts.
4. **InterNations country/city lists** → **supplied**: `400_Cities_160_Countries.xlsx` at the repository root (sheet `Cities`: `#, City, Country, Region, Type` — 400 rows, 160 countries, English country names not ISO codes, `Type` is `Capital` (160) or `Major city` (240); sheet `Countries` repeats the 160 countries with their capital). Inspected facts the tasks rely on: 8 country names do not match the CLDR names in `packages/contracts/src/countries.ts` and need an explicit alias (Bosnia and Herzegovina→BA, Czech Republic→CZ, Côte d'Ivoire→CI, DR Congo→CD, Myanmar→MM, Republic of the Congo→CG, Trinidad and Tobago→TT, Turkey→TR); `Tripoli` occurs twice (two countries) so the key is `(country, lower(city))`; names contain diacritics and punctuation (`Asunción`, `Xi'an`, `N'Djamena`), so matching is case-insensitive but exact otherwise; the list has only 2–6 cities per country (Germany 6, UAE 5) and **omits three of the seven UAE emirates the club treats as GWC cities** (Ajman, Umm Al Quwain, Fujairah). The other ~90 countries are not in the list at all.

**Assumptions to confirm** (cheap to change, each isolated to one task):
- **Confirmed by the user:** the Dubai follow-up "How long are you already working?" is a **single choice**: `under_1` (less than 1 year), `1_3` (1–3 years), `3_5` (3–5 years), `5_10` (5–10 years), `over_10` (more than 10 years). Contracts constant `WORKING_DURATIONS`, column `settling_work_duration`.
- Business Owner's "What is your product or service?" becomes **multi-select** of Produce / Distribute / Sales / Other (`future_work_business_activities`); at least one required. Its old free-text `idea` is no longer used for Business Owner.
- **Confirmed by the user:** a non-German member who selects **no GWC city** still goes through the review and **Submit** before profiling is complete (the explicit-submit rule from Revision 2 stands).
- **Confirmed by the user:** no legacy data has to be preserved — the development database is wiped with `npm run -w server migrate:down` (development-only, refuses otherwise) and rebuilt with `migrate` + `seed:dev`. So there is **no "registered before this change" case**: every applicant registers with a `primary_language`. `members.primary_language` still stays nullable, because members who never apply (the fixed `seed:dev` accounts, invited members) have no application row and are never touched by the rules.
- Yearly income gains `over_500k` and `over_1m`; the existing code `over_100k` keeps its meaning label "100K+ Euro" (it is now the 100K–500K band in practice — no data migration, completed rows are immutable).

**Tests**: included, per the Constitution Check. **Story map**: US6 (register capture), US7 (Phase 1 decision rules), US8 (settling expansion, member + partner), US9 (question order/income/Q7 changes), US10 (non-German GWC branching + city data).

## Phase 13: Revision 4 Setup & Foundational

- [X] T087 [P] Record Revision 4 in the design docs: append a "Revision 4" section to `specs/013-onboarding-profiling/spec.md` (new stories US6–US10, requirements FR-036 onward covering everything in this Revision's header, superseding FR-004/FR-011/FR-029/FR-035 where they conflict), `data-model.md` (migration `036`), `contracts/profiling-api.md` and `research.md` (R16–R19: system decisions, GWC match timing, business activities, city dataset)
- [X] T088 [P] In `packages/contracts/src/onboarding.ts` add `PRIMARY_LANGUAGES = Object.freeze(['german', 'non_german'] as const)` and `RESIDENCE_SHORTCUTS = Object.freeze(['DE', 'AT', 'CH'] as const)`; extend `registerRequestSchema` with `ageConfirmed: z.literal(true)` and `primaryLanguage: z.enum(PRIMARY_LANGUAGES)`; extend `applicationSchema` with `primaryLanguage` (nullable) and `decidedBy: 'staff' | 'automatic' | null`
- [X] T089 In `packages/contracts/src/profiling.ts` apply the Revision 4 answer shape: `YEARLY_INCOME_RANGES` gains `over_500k`, `over_1m`; add `WORKING_DURATIONS = ['under_1','1_3','3_5','5_10','over_10']` and `BUSINESS_ACTIVITIES = ['produce','distribute','sales','other']`; `ProfilingAnswers` (status + patch, member and `partner`) gains `settlingCountry` (ISO-2 | null), `settlingCity` (string | null), `settlingWorkDuration` (one of `WORKING_DURATIONS` | null); the partner object regains `settlingStatus` and the same three fields; `futureWorkPriority` (single) is replaced by `futureWorkPriorities` (array, min 1) again; add `futureWorkBusinessActivities` (array of `BUSINESS_ACTIVITIES`, min 1); status gains `gwcMatch: boolean` (true once a submitted city matches a GWC city) (depends on: T088)
- [X] T090 In `packages/contracts/src/profiling.ts` rewrite `profilingSteps`/`profilingMissing` for the new flow and export the new `ProfilingStepId`s: German order `settling` (+ `settling-info` when `need_help`; `settling-place` and, when the place is Dubai (`AE` + `Dubai`, case-insensitive), `settling-work` when `know_where`), `languages`, `qualification`, `occupation`, `income`, `relationship`, `kids`?, partner block, `work-type`, path follow-ups; partner block = `partner-settling` (+ `-info`/`-place`/`-work` by the same rule), `partner-languages`, `partner-qualification`, `partner-occupation`, `partner-income`; Q7 paths: employee → industry, ready; freelance/own_business → offering, industry, idea; business_owner → industry, `work-activities`; not_sure → `work-priorities` only (no industry); elsewhere: `cities`, then **only if `gwcMatch`** `relationship`, `kids`?, partner block, then `review` (no match → straight to `review`) (depends on: T089)
- [X] T091 [P] Update `packages/contracts/tests/profiling-steps.test.ts`: new German order (income after occupation); settling sub-steps for `need_help` / `know_where` / Dubai / non-Dubai, member and partner; `business_owner` yields `work-activities` not `work-idea`; `not_sure` yields `work-priorities` and **no** `work-industry`; elsewhere with `gwcMatch: false` lists only `cities` then `review`, with `gwcMatch: true` adds Q6 and sub-flows; counter-assertion that `work-*` steps never appear for elsewhere (depends on: T090)
- [X] T092 [P] Write migration `server/migrations/036_onboarding_rules.sql`: **members** `primary_language text CHECK (primary_language IS NULL OR primary_language IN ('german','non_german'))` and `age_confirmed_at timestamptz`; **membership_applications** `decided_automatically boolean NOT NULL DEFAULT false`; **member_profiling** `settling_country char(2)` (ISO CHECK), `settling_city text`, `settling_work_duration text CHECK (settling_work_duration IS NULL OR settling_work_duration IN ('under_1','1_3','3_5','5_10','over_10'))`, `future_work_business_activities text[]`, replace the income CHECK with the 5 values, replace `member_profiling_future_work_matches_desired_work_type` (sector only for employee/freelance/own_business/business_owner and NULL for not_sure; ready employee-only; offering freelance/own_business; idea freelance/own_business; activities business_owner-only; priorities not_sure-only), **drop** `member_profiling_future_work_priority_single`, replace `member_profiling_match_implies_gwc_outcome` with: `outcome = 'gwc_city_match'` ⇒ `matched_gwc_city_id IS NOT NULL`, `outcome = 'in_person_meeting'` ⇒ it IS NULL (a match may exist before an outcome); **member_profiling_partner** re-add `settling_status` (same CHECK), `settling_country`, `settling_city`, `settling_work_duration` (same CHECK), replace its income CHECK; data fix: `UPDATE member_profiling SET future_work_sector = NULL WHERE completed_at IS NULL AND desired_work_type = 'not_sure'`. Every new CHECK on a table that has immutable completed rows is `NOT VALID` where old rows could violate it
- [X] T093 Reset and rebuild the development database (the user confirmed nothing needs preserving): `NODE_ENV=development npm run -w server migrate:down`, then `npm run -w server migrate` and `npm run -w server seed:dev`; confirm `036` applies from scratch and `seed:dev` still succeeds (applications are never seeded — `membership_applications` is in the never-seeded list in `server/src/seed/tables.ts` — so no seeder change is needed) (depends on: T092)
- [X] T094 [P] Add `onboarding.thank-you` (de + en, "approval may take up to 48 hours") to `server/src/integrations/mail-templates.ts` in the same `both(...)` style as `onboarding.approved`, and a test in the existing mail-template test file asserting subject/body mention 48 hours and the name greeting
- [X] T095 [P] Add the job `{ name: 'onboarding.auto-approve', schedule: '*/15 * * * *', description: 'Approve German-speaker applications still pending 24 hours after submission' }` to `PLATFORM_JOBS` in `server/src/ops/jobs.ts` (the handler is wired in T103)

**Checkpoint**: contracts, schema, mail template and job declaration exist; no behaviour has changed yet.

---

## Phase 14: User Story 6 - Register captures age confirmation, primary language and residence (Priority: P1)

**Goal**: Register asks the applicant to confirm their age and choose German / Non-German; country of residence is Germany / Austria / Switzerland / Others (Others opens the full picker).

**Independent Test**: Register with `ageConfirmed: true`, `primaryLanguage: 'german'`, `countryOfResidence: 'AT'` → 202; omit either or send `ageConfirmed: false` → 400; `members.primary_language` and `age_confirmed_at` are stored.

- [X] T096 [US6] In `server/src/modules/onboarding/application/register.ts` write `primary_language` and `age_confirmed_at = now()` in the same statement that sets `display_name, mobile, birthday, gender, country_of_residence` (line ~128); an application that re-registers (resume path) updates them too (depends on: T093, T088)
- [X] T097 [P] [US6] Write `server/tests/onboarding/register-language.test.ts`: missing/false `ageConfirmed` → 400 `validation-failed`; missing/invalid `primaryLanguage` → 400; a valid request stores both columns; the response shape is unchanged for a taken email (counter-assertion: still identical, no oracle) (depends on: T096)
- [X] T098 [P] [US6] Web console: in `client/src/onboarding/Register.tsx` add an age-confirmation checkbox (required) and a German / Non-German radio group to the details step, replace the country `<select>` with the four options Germany / Austria / Switzerland / Others where **Others** reveals the existing full country list (excluding DE/AT/CH), send `ageConfirmed` and `primaryLanguage`, show the local field errors like the existing ones; add de/en strings to `client/src/i18n/{de,en}.ts` and update `client/tests/onboarding/web-onboarding.test.tsx` (depends on: T088)
- [X] T099 [P] [US6] Expo: in `expo-client/german-world-club/src/app/(public)/register.tsx` add the age-confirmation switch and the German / Non-German choice (chips), store them in the registration draft (`src/session/registration-draft.tsx`), and in `(public)/country.tsx` show Germany / Austria / Switzerland / Others first, with Others opening the existing `CountryPicker`; send both new fields in the register call (`src/api/endpoints.ts`); add strings to `src/i18n/{de,en}.ts` (depends on: T088)

**Checkpoint**: applicants supply everything the Phase 1 decision rules need.

---

## Phase 15: User Story 7 - Phase 1 decision rules: auto-deny, thank-you email, 24h auto-approval (Priority: P1)

**Goal**: On email verification, a Non-German applicant is denied automatically (no staff queue), a German applicant gets the 48-hour thank-you email, and a job approves German applications still pending after 24 hours.

**Independent Test**: Quickstart Scenario 10 (below).

- [X] T100 [US7] (DEVIATION: the audit entry for an automatic decision has `actor_id`/`actor_kind` NULL, not a `'system'` kind — `audit_log.actor_kind` is the enum `account_kind` ('member' | 'admin'); adding a value to that enum for one caller was not worth it, and NULL already reads as "nobody on staff") In `server/src/modules/onboarding/application/review.ts` refactor `decide` so the actor is `{ kind: 'admin'; id } | { kind: 'system' }`: `reviewed_by` stays NULL and `decided_automatically = true` for `system`; the audit call uses `actorKind: 'system'` with `actorId: null` (check `server/src/decorators/audit.ts` for the accepted kinds and add `'system'` there if missing); the device approval, denial-reason constraint and email enqueue behave exactly as for staff. Export a `decideAutomatically(app, { memberId, decision, client })` that takes an existing transaction client
- [X] T101 [US7] In `server/src/modules/onboarding/application/verify.ts` `verifyEmail`, inside the transaction that sets `submitted_at`: read `members.primary_language`; `'non_german'` → call `decideAutomatically` with `{ state: 'denied', reason: 'Primary language is not German' }` (denial email is queued by it); `'german'` → `app.enqueueMail({ template: 'onboarding.thank-you', subjectKey: 'application-submitted:'+memberId, variables: { name } }, { client })`; any other value (`NULL`, which registration never produces) triggers neither rule. The returned status shows `denied` / `awaiting_approval` accordingly (depends on: T100, T094)
- [X] T102 [US7] Create `server/src/modules/onboarding/application/auto-approve.ts` exporting `autoApproveDue(app)`: `SELECT member_id FROM membership_applications a JOIN members m ON m.id = a.member_id WHERE a.state = 'pending' AND a.submitted_at IS NOT NULL AND a.submitted_at <= now() - interval '24 hours' AND m.primary_language = 'german' FOR UPDATE OF a SKIP LOCKED LIMIT 100`, then `decideAutomatically(... approved)` per row in its own transaction; return the count. The `state = 'pending'` guard makes a race with a staff decision decide exactly once (depends on: T100)
- [X] T103 [US7] Wire the job in `server/src/ops/jobs.ts`: `'onboarding.auto-approve': async () => autoApproveDue(app)` next to `'mail.deliver'` (depends on: T102, T095)
- [X] T104 [P] [US7] Write `server/tests/onboarding/phase1-decisions.test.ts`: non-German at email verification → state `denied`, `decided_automatically`, denial mail queued with the reason, **absent from** `/admin/onboarding/applications?state=pending`; German → stays `pending`, one thank-you mail queued (counter-assertion: none queued for the non-German);  `autoApproveDue` approves a German application submitted 25h ago (seed `submitted_at` directly) and queues the approval mail, leaves one submitted 23h ago, leaves a non-German one, is idempotent on a second run, and loses cleanly to a staff decision made first (state unchanged, one approval mail); the audit log records `actorKind: 'system'` (depends on: T101, T102)
- [X] T105 [P] [US7] Staff console: in `server/src/modules/onboarding/application/review.ts` `toApplication` return `primaryLanguage` and `decidedBy` (`'automatic'` when `decided_automatically`), and in `client/src/console/admin/Applications.tsx` show the language and an "Automatic" badge on decided rows (de/en strings in `client/src/i18n/{de,en}.ts`); extend the existing applications test (depends on: T088, T100)
- [X] T106 [P] [US7] Web + Expo waiting/denied copy: update the "Waiting for approval" screens (`client/src/onboarding/Application.tsx`, `expo-client/german-world-club/src/app/(applicant)/waiting.tsx`) to say approval may take up to 48 hours, and make sure an automatically denied applicant lands on the existing denied state with the reason (no new screen); strings in all four i18n catalogues (depends on: T101)

**Checkpoint**: Phase 1 matches the business description end to end.

---

## Phase 16: User Story 8 - Settling question expansion, for the member and the partner (Priority: P2)

**Goal**: Q1 "Do you know where you'll settle?": *Please help* → an information screen; *Yes* → country, city, and for Dubai "How long are you already working?". The partner is asked the same.

**Independent Test**: Quickstart Scenario 11.

- [X] T107 [US8] In `server/src/modules/profiling/application/submit.ts` and `status.ts` read/write `settling_country`, `settling_city`, `settling_work_duration` for the member and re-add `settling_status` + the three fields to the partner upsert/select; cascade rule: changing `settlingStatus` to `need_help`, or the place away from Dubai, nulls the fields that no longer apply (member and partner); reject place fields while `settlingStatus` is not `know_where` (`VALIDATION_FAILED`) (depends on: T093, T089)
- [X] T108 [P] [US8] Write `server/tests/profiling/settling.test.ts`: `need_help` needs no place and completes the step; `know_where` needs country + city; Dubai (`AE`, `dubai` in any case) additionally requires `settlingWorkDuration` (a value outside the five is 400) and a non-Dubai city refuses it; switching `know_where`→`need_help` clears country/city/duration; the same rules for `partner`; submit is refused naming `settling-place` / `settling-work` / `partner-settling-place` (depends on: T107)
- [X] T109 [P] [US8] Web console: in `client/src/onboarding/profiling/steps.tsx` and `summary.ts` add the `settling-info` screen (text from i18n, Continue only), `settling-place` (country `<select>` + city input/dropdown, reusing the city dropdown from T121), `settling-work` (five options as single-choice buttons: less than 1 year / 1–3 years / 3–5 years / 5–10 years / more than 10 years, with de/en labels) for the member **and** the partner (`partner-` prefix), restore the partner settling case removed in Revision 3; strings ("For best relocation purpose, to ease you in your new life, please help us and answer the following questions", "How long are you already working?") in `client/src/i18n/{de,en}.ts`; update `client/tests/onboarding/profiling.test.tsx` (the Revision 3 assertion that the partner is never asked settling becomes its opposite) (depends on: T090, T107, T121 for the shared city dropdown)
- [X] T110 [P] [US8] Expo: the same three steps in `expo-client/german-world-club/src/components/profiling/steps.tsx`, `summary.ts` and a new `settling.tsx` (info screen, `CountryPicker` + city chips/text, five-option single choice for the duration, `Chip`s), member and partner; strings in `expo-client/german-world-club/src/i18n/{de,en}.ts` (depends on: T090, T107)

**Checkpoint**: settling works for member and partner on both faces.

---

## Phase 17: User Story 9 - Reordered questions, income bands, Q7 changes (Priority: P1)

**Goal**: Order Q1 settling, Q2 languages, Q3 qualification, Q4 occupation, Q5 income (5 bands), Q6, Q7; Business Owner picks activities; "not sure" is multi-select with no industry.

**Independent Test**: Quickstart Scenario 12.

- [X] T111 [US9] In `server/src/modules/profiling/application/submit.ts` update the Q7 mapping (`FUTURE_WORK_FIELDS_FOR`: employee → sector, ready; freelance/own_business → offering, sector, idea; business_owner → sector, `future_work_business_activities`; not_sure → priorities only), accept `futureWorkBusinessActivities` and `futureWorkPriorities` (array), keep the FR-022 clear-on-path-change for the new column, and in `status.ts` return them; `futureWorkPriority` (single) is removed from status/patch (depends on: T093, T089)
- [X] T112 [P] [US9] Update `server/tests/profiling/future-work.test.ts`, `germany-flow.test.ts`, `go-back.test.ts`, `relationship-flow.test.ts`, `submit.test.ts` and `support.ts` to the new order/answers: Business Owner completes with industry + activities (an `idea` is refused), `not_sure` completes with ≥1 priority and **no** industry (an industry is refused), empty activities/priorities → 400, income accepts `over_500k`/`over_1m`, every from→to Q7 path pair still clears stale follow-ups (depends on: T111)
- [X] T113 [P] [US9] Web console: `client/src/onboarding/profiling/steps.tsx` — Business Owner activities as multi-select bubbles (`Bubbles`), `not_sure` priorities as multi-select again, drop the industry step on `not_sure`, income with 5 options, order comes from `profilingSteps`; `summary.ts` and `client/src/i18n/{de,en}.ts` (activity labels, income labels 500K+/1M+, restored "Select all that apply" title); update `client/tests/onboarding/profiling.test.tsx` (the Revision 3 single-select test becomes a multi-select test; not_sure shows no industry dropdown) (depends on: T090, T111)
- [X] T114 [P] [US9] Expo: the same changes in `expo-client/german-world-club/src/components/profiling/steps.tsx`, `summary.ts` and `src/i18n/{de,en}.ts` (depends on: T090, T111)

**Checkpoint**: the German pathway matches the description.

---

## Phase 18: User Story 10 - Non-German path: city data and GWC branching (Priority: P2)

**Goal**: Nearest cities come from country/city dropdowns (InterNations list). If no submitted city is a GWC city the flow goes straight to review; if one is, Q6 and its sub-flows follow.

**Independent Test**: Quickstart Scenario 13.

- [X] T115 [US10] Convert the supplied workbook to a committed JSON source (no spreadsheet library at runtime): move `400_Cities_160_Countries.xlsx` to `server/data/source/400_Cities_160_Countries.xlsx`, and add `server/src/scripts/convert-cities.py` (run once with `python3`, `openpyxl`) that reads sheet `Cities`, maps `Country` names to ISO-2 through `packages/contracts/src/countries.ts` (`en` names) **plus the 8-name alias table above**, fails loudly on any unmapped name, and writes `server/data/internations-cities.json` as `[{ "country": "AE", "city": "Dubai", "region": "Middle East", "capital": false }]` (400 entries, sorted by country then capital-first then city). Commit both files. Verify: 400 rows, 160 distinct ISO codes, `Tripoli` under two codes, `Xi'an` and `Asunción` byte-exact
- [X] T116 [US10] Migration `server/migrations/037_world_cities.sql` creating `world_cities (country char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'), city text NOT NULL, region text NOT NULL, is_capital boolean NOT NULL DEFAULT false, with `CREATE UNIQUE INDEX world_cities_country_city ON world_cities (country, lower(city))` (a primary key cannot hold an expression), plain reference data like `gwc_cities`; `server/src/scripts/load-cities.ts` + `"load:cities": "node --env-file-if-exists=.env src/scripts/load-cities.ts"` in `server/package.json` that reads `server/data/internations-cities.json` and upserts idempotently (`ON CONFLICT DO UPDATE`), never deletes, and prints the count; run it from `npm run -w server seed:dev` and `seed:demo` too so a fresh database has the list; add `world_cities` next to `gwc_cities` in the reference-data list in `server/src/seed/tables.ts` (depends on: T115)
- [X] T117 [US10] Add `GET /profiling/cities?country=XX&q=` (`config.auth = { audience: 'member', profiling: true }`, `budget: 'member-read'`) in `server/src/modules/profiling/routes.ts`, `controller.ts` and a new `application/world-cities.ts`. It returns `{ listed: boolean, cities: string[] }`: `listed` is true when the country has any row in `world_cities` **or** `gwc_cities`; `cities` is the **union of both tables** for that country (so Ajman, Umm Al Quwain and Fujairah, which are GWC cities missing from the workbook, are always selectable), de-duplicated case-insensitively, capitals first then alphabetical, filtered by case-insensitive prefix `q`, at most 50; explicit columns; response schema in `packages/contracts/src/profiling.ts` (`citiesResponseSchema`); add the route to `server/tests/authz/matrix.test.ts` (depends on: T116)
- [X] T118 [US10] Validate cities against the list where the list applies: in `submit.ts` (`saveElsewhere`, the member's and partner's settling place) reject a city that is not in the union of `world_cities` and `gwc_cities` **only when the country is `listed`** (`VALIDATION_FAILED`); for the ~90 countries the workbook does not cover accept free text (trimmed, 1–200 chars). Compute and store `matched_gwc_city_id` **when the cities are saved** (clear it when none match) and expose `gwcMatch` in status; when the saved cities stop matching, delete `relationship_tags`, kids and partner (FR-033 cascade) (depends on: T117, T092, T089)
- [X] T119 [US10] Update `server/src/modules/profiling/application/complete.ts`: the elsewhere outcome is `gwc_city_match` when a match is stored, else `in_person_meeting` (no lookup at submit any more); missing steps come from the new `profilingSteps` so a non-GWC member can submit right after the cities (depends on: T118, T090)
- [X] T120 [P] [US10] Write/update `server/tests/profiling/elsewhere-flow.test.ts`, `relationship-flow.test.ts`, `submit.test.ts` and add `server/tests/profiling/world-cities.test.ts`: no GWC match → submit succeeds right after the cities with `in_person_meeting` and Q6 is refused (`VALIDATION_FAILED`, counter-assertion: a matching member may answer it); GWC match → Q6 (+ kids/partner) required before submit, outcome `gwc_city_match`; changing matched cities to unmatched deletes previously saved Q6/kids/partner rows; `matchedCity` is now visible before submit; the cities endpoint filters by country and prefix and is refused for other audiences; a listed country (e.g. `DE`) rejects an unlisted city while an unlisted country (pick one absent from the workbook, e.g. `IS`) accepts free text; a GWC city absent from the workbook (`AE` / Fujairah) is offered by the endpoint and accepted; `Tripoli` is offered under both of its countries; `Xi'an` matches case-insensitively but not with a different apostrophe (depends on: T119)
- [X] T121 [P] [US10] Web console: replace the free-text city inputs in `client/src/onboarding/profiling/steps.tsx` (`Cities`) with a searchable dropdown fed by `GET /profiling/cities` (an `<input list>`/select filtered by the typed prefix), falling back to the text field when the response says `listed: false`; after saving, the step list from `profilingSteps` decides between Q6 and review; add the dropdown for `settling-place` from T109; add the api call to `client/src/lib/api.ts`; tests in `client/tests/onboarding/profiling.test.tsx` (no GWC city → review; GWC city → relationship step) (depends on: T090, T117)
- [X] T122 [P] [US10] Expo: the same in `expo-client/german-world-club/src/components/profiling/cities.tsx` (searchable chip list from the endpoint when `listed`, replacing the separate `gwcCities()` call — the endpoint already includes the GWC cities — with the free-text fallback otherwise), `src/api/endpoints.ts` (`profilingApi.cities(country, q)`), and the settling place from T110 (depends on: T090, T117)

**Checkpoint**: the non-German pathway matches the description.

---

## Phase 19: Polish & Cross-Cutting (Revision 4)

- [X] T123 Add quickstart Scenarios 10–13 to `specs/013-onboarding-profiling/quickstart.md`: 10 Phase 1 rules (non-German auto-denied and never in the queue; German gets the thank-you mail; set `submitted_at` to 25 hours ago and run the job, `pm2`/`runJob('onboarding.auto-approve')`, approval mail queued); 11 settling (need_help info screen, Dubai follow-up, partner too); 12 order/income/Q7 (Business Owner activities, not_sure without industry); 13 non-German (no GWC → review; GWC → Q6 → review)
- [X] T124 (RESULTS: contracts 109 tests, client 403 tests, i18n catalogues agree, contracts and Expo `tsc` clean, `tests/profiling` 79 tests and `tests/onboarding` pass. The remaining failures are the same ones that fail without this change — development-mode swagger routes, an SMS-rollback test, media/localisation ops suites, and 4 pre-existing `tsc` errors in `client/tests/member/marketplace.test.tsx`; the live-matrix suite passed alone but timed out once under load.) [P] Run `tsc --noEmit` for `packages/contracts`, `client` and `expo-client/german-world-club`, `npm run -w client test:i18n`, all `packages/contracts`, `client` and `server/tests/{profiling,onboarding,authz,seed}` suites with a database; report failures that also fail on the untouched baseline separately, as in T080
- [X] T125 [P] Update `CLAUDE.md`: the onboarding paragraph ("Onboarding is gated by approval, not invitation") gains the two Phase 1 rules that would surprise — non-German applicants are denied automatically at email verification and never reach the staff queue; the `onboarding.auto-approve` job approves German applications after 24 h and only rows with an explicit `primary_language` — and the profiling paragraph gains: the GWC match is stored when the cities are saved and decides whether Q6 is asked
- [ ] T126 (NOT DONE — needs a person with a browser and a phone: the Expo screens have no automated tests, only `tsc`/lint) Manual click-through of Phase 1 and Phase 2 on the web console and the Expo app (both languages), since the Expo screens have no automated tests; record deviations at the end of this file

### Dependencies & Execution Order (Revision 4)

- Phase 13 first: T087 ∥ T088 ∥ T092 ∥ T094 ∥ T095; T088 → T089 → T090 → T091; T092 → T093.
- US6 (Phase 14) and US7 (Phase 15) need T093 + T088; US7: T100 → {T101, T102} → T103 → T104; T105, T106 in parallel after T100/T101.
- US9 (Phase 17) needs T089–T093 and is independent of US6/US7. US8 (Phase 16) needs T107 first, then web/Expo in parallel. US10 (Phase 18) needs T090 and T092; Nothing is user-blocked any more: T115 (convert the workbook) comes first, and T116–T122 follow it.
- Suggested order: 13 → 15 (+14) → 17 → 16 → 18 → 19. The `profilingSteps` change (T090) alters what both clients render, so **T113/T114 and T109/T110 and T121/T122 must land in the same release as T090**; do not deploy the contracts change alone.

### Parallel Examples

```bash
# Phase 13
Task: "T088 onboarding contracts"   Task: "T092 migration 036"   Task: "T094 thank-you mail"   Task: "T095 job declaration"
# After T111
Task: "T112 server tests"   Task: "T113 web Q7/income"   Task: "T114 Expo Q7/income"
# After T117
Task: "T121 web city dropdown"   Task: "T122 Expo city list"   Task: "T120 server tests"
```

### Implementation Strategy

1. **MVP of this revision = Phase 13 + US7 (+ US6)**: the Phase 1 rules are self-contained, server-first and change no Phase 2 screen. Validate with Scenario 10.
2. Then US9 (order/income/Q7), US8 (settling), US10 (GWC branching, city data). The three Phase 2 stories change the shared step engine and must ship together with their client tasks.
3. Everything that reverses an earlier request (partner settling, not-sure multi-select and no industry) is isolated in T090, T107–T110 and T111–T114; if you change your mind, those are the only tasks to drop.

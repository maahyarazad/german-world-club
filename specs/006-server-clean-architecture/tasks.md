---
description: "Task list template for feature implementation"
---

# Tasks: Server Clean Architecture Reorganization

**Input**: Design documents from `/specs/006-server-clean-architecture/`
**Prerequisites**: plan.md, spec.md, research.md, quickstart.md (no data-model.md/contracts/ — see plan.md)

**Tests**: Not requested. This is a refactor; the existing `server/tests/**` suite is the regression
oracle (per research.md's "No new test files" decision) — every checkpoint task below runs it.

**Organization**: Tasks are grouped by user story per spec.md's priorities (P1 → P2 → P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All file paths are relative to the repository root

## Path Conventions

Single project, existing `server/` workspace. Target layout is defined in `plan.md`'s Project
Structure section — this file does not repeat it, only references it per-task.

---

## Phase 1: Setup

**Purpose**: Establish the regression baseline and the destination for documentation before any
file moves, per FR-006/FR-008.

- [X] T001 Run `npm test` and `npm run -w server test` at the repo root and record the current
      pass/fail counts (e.g. in a scratch note, not committed) as the baseline that every later
      checkpoint task in this file must match
- [X] T002 [P] Create `server/ARCHITECTURE.md` with section headings only: "Layers" (routes /
      controllers / application / lib), "Fastify concepts in this repo" (plugins / decorators /
      hooks), and "Adding a new endpoint" — content is filled in by T053 and T055

**Checkpoint**: Baseline recorded; documentation skeleton exists.

---

## Phase 2: Foundational (app.js decorators and hooks)

**Purpose**: Extract the cross-cutting decorators and hooks currently inline in `server/src/app.js`
into their own folders (FR-002), so `app.js` reads as a boot sequence of named calls. Not a strict
blocker for Phase 3's domain splits, but done first because every later domain controller depends
on `app.contentSource`/`app.audit`/`app.mediaStorage`/`app.integrations`/`app.sendOtp` already
being decorated the same way — moving the decorator *code* doesn't change its *decorated name*, so
this is safe to isolate and verify before touching any domain.

- [X] T003 Extract the `onRequest` CSRF double-submit check out of `buildApp()` in `server/src/app.js`
      into `server/src/hooks/csrf-on-request.js`, exporting `registerCsrfHook(app)`; call it from
      `app.js` in the same position
- [X] T004 Extract the `onClose` dispatcher-shutdown hook out of `server/src/app.js` into
      `server/src/hooks/shutdown.js`, exporting `registerShutdownHook(app)`; call it from `app.js`
- [X] T005 Extract the `onReady` budget-assertion hook out of `server/src/app.js` into
      `server/src/hooks/budget-on-ready.js`, exporting `registerBudgetGate(app, env)`; call it from
      `app.js`
- [X] T006 Extract `app.decorate('contentSource', ...)` out of `server/src/app.js` into
      `server/src/decorators/content-source.js`, exporting `registerContentSource(app, { contentSource })`;
      call it from `app.js`
- [X] T007 Extract `app.decorate('audit', ...)` / `app.decorate('auditLog', ...)` out of
      `server/src/app.js` into `server/src/decorators/audit.js`, exporting `registerAudit(app)`;
      call it from `app.js`
- [X] T008 Extract `app.decorate('mediaStorage', ...)` / `app.decorate('jobQueue', ...)` out of
      `server/src/app.js` into `server/src/decorators/media.js`, exporting `registerMediaDecorators(app, { storage, jobQueue })`;
      call it from `app.js`
- [X] T009 Extract `app.decorate('integrations', ...)` out of `server/src/app.js` into
      `server/src/decorators/integrations.js`, exporting `registerIntegrations(app, { integrations, env })`;
      call it from `app.js`
- [X] T010 Extract `app.decorate('sendOtp', ...)` out of `server/src/app.js` into
      `server/src/decorators/send-otp.js`, exporting `registerSendOtp(app)` (depends on T009's
      `app.integrations` and `app.breakers` already being present); call it from `app.js`
- [X] T011 Run `npm run -w server test` and confirm the result matches T001's baseline exactly
      (checkpoint before touching any domain)

**Checkpoint**: `app.js` now only calls named `register*` functions; all decorators/hooks live in
`decorators/`/`hooks/`; full suite green.

---

## Phase 3: User Story 1 - Find any endpoint's layers in seconds (Priority: P1) 🎯 MVP

**Goal**: Every HTTP domain's route declaration, request/response translation, and business logic
live in three separate, predictably-named files/folders.

**Independent Test**: For any existing endpoint, a developer can find its route, controller, and
application logic in under 2 minutes using folder structure alone (spec.md SC-001).

Migrated in the order research.md settled on: `auth` (largest, best test coverage) → `media` →
`seo` → `organisations` → `push` → `public`. Each domain ends with its own checkpoint so a
regression is attributable to the domain just moved (FR-007).

### auth

- [X] T012 [US1] Create `server/src/modules/auth/` and move `passwords.js`, `tokens.js`,
      `sessions.js`, `otp.js` from `server/src/auth/` into it unchanged (content untouched, only
      the file location changes)
- [X] T013 [P] [US1] Extract the sign-in business logic from `server/src/auth/routes.js` into
      `server/src/modules/auth/application/sign-in.js` as a framework-free function taking its
      dependencies (db query fn, password verify fn, session start fn) as arguments
- [X] T014 [P] [US1] Extract the OTP verify logic from `server/src/auth/routes.js` into
      `server/src/modules/auth/application/verify-otp.js`
- [X] T015 [P] [US1] Extract the OTP resend logic from `server/src/auth/routes.js` into
      `server/src/modules/auth/application/resend-otp.js`
- [X] T016 [P] [US1] Extract the refresh-token logic from `server/src/auth/routes.js` into
      `server/src/modules/auth/application/refresh.js`
- [X] T017 [P] [US1] Extract the sign-out/session-revocation logic from `server/src/auth/routes.js`
      into `server/src/modules/auth/application/sign-out.js`
- [X] T018 [P] [US1] Extract the password-reset request logic from `server/src/auth/routes.js` into
      `server/src/modules/auth/application/request-password-reset.js`
- [X] T019 [P] [US1] Extract the password-reset confirm logic from `server/src/auth/routes.js` into
      `server/src/modules/auth/application/confirm-password-reset.js`
- [X] T020 [US1] Create `server/src/modules/auth/controller.js` with one exported handler per route,
      each translating `request`/`reply` into a call to the matching function from T013–T019 and
      shaping the reply (cookies via `setAuthCookies`/`clearAuthCookies`, status codes) — depends on
      T013–T019
- [X] T021 [US1] Create `server/src/modules/auth/routes.js` containing only path/method declarations,
      `schema`/`config.auth`/`config.produces`, and wiring to `controller.js` — depends on T020
- [X] T022 [US1] Update the `authRoutes` import in `server/src/app.js` to `./modules/auth/routes.js`;
      delete the now-empty `server/src/auth/` directory
- [X] T023 [US1] Update every import in `server/tests/auth/**` that referenced `src/auth/...` to the
      new `src/modules/auth/...` paths
- [X] T024 [US1] Run `npm run -w server test -- tests/auth` then `npm run -w server test`; confirm
      identical results to baseline (checkpoint)

### media

- [X] T025 [US1] Create `server/src/modules/media/` and move `worker.js`, `storage.js`,
      `derive-image.js`, `derive-video.js`, `strip-metadata.js`, `validate.js`, `queue.js` from
      `server/src/media/` into it unchanged
- [X] T026 [P] [US1] Extract the upload/validation business logic from `server/src/media/routes.js`
      into `server/src/modules/media/application/upload.js`
- [X] T027 [P] [US1] Extract the derivative-retrieval/delivery logic from `server/src/media/routes.js`
      into `server/src/modules/media/application/deliver.js`
- [X] T028 [US1] Create `server/src/modules/media/controller.js` mapping requests to T026/T027 —
      depends on T026, T027
- [X] T029 [US1] Create `server/src/modules/media/routes.js` (schema/wiring only) — depends on T028
- [X] T030 [US1] Update the `mediaRoutes`/`mediaWorker` imports in `server/src/app.js` to
      `./modules/media/...`; delete the now-empty `server/src/media/` directory
- [X] T031 [US1] Update every import in `server/tests/media/**` to the new `src/modules/media/...`
      paths
- [X] T032 [US1] Run `npm run -w server test -- tests/media` then `npm run -w server test`; confirm
      identical results to baseline (checkpoint)

### seo

- [X] T033 [US1] Create `server/src/modules/seo/` and move `build-page-meta.js`,
      `structured-data.js`, `surfaces.js` from `server/src/seo/` into it unchanged
- [X] T034 [P] [US1] Extract the robots/sitemap generation logic from `server/src/seo/robots.js`
      and `server/src/seo/sitemap.js` into `server/src/modules/seo/application/robots.js` and
      `.../application/sitemap.js`; create `server/src/modules/seo/public-routes.js` as the
      schema/wiring entry point that replaces both original files' registration role
- [X] T035 [P] [US1] Extract the staff SEO-edit business logic from `server/src/seo/staff-routes.js`
      into `server/src/modules/seo/application/staff-edit.js`
- [X] T036 [US1] Create `server/src/modules/seo/staff-controller.js` mapping staff requests to
      T035 — depends on T035
- [X] T037 [US1] Create `server/src/modules/seo/staff-routes.js` (schema/wiring only) — depends on
      T036
- [X] T038 [US1] Update the `robots`/`sitemap`/`seoStaffRoutes` imports in `server/src/app.js` to
      `./modules/seo/...`; delete the now-empty `server/src/seo/` directory
- [X] T039 [US1] Update every import in `server/tests/seo/**` to the new `src/modules/seo/...` paths
- [X] T040 [US1] Run `npm run -w server test -- tests/seo` then `npm run -w server test`; confirm
      identical results to baseline (checkpoint)

### organisations

- [X] T041 [US1] Extract the business logic from `server/src/organisations/routes.js` (guarded via
      `authz/object-guards.js`'s `guardOrganisationScope`) into
      `server/src/modules/organisations/application/*.js`, one file per operation
- [X] T042 [US1] Create `server/src/modules/organisations/controller.js` mapping requests to
      T041's functions — depends on T041
- [X] T043 [US1] Create `server/src/modules/organisations/routes.js` (schema/wiring only); update
      the `organisationRoutes` import in `server/src/app.js`; delete the now-empty
      `server/src/organisations/` directory — depends on T042
- [X] T044 [US1] Update any organisations-related test imports; run `npm run -w server test`;
      confirm identical results to baseline (checkpoint)

### push

- [X] T045 [US1] Create `server/src/modules/push/` and move `providers.js` from `server/src/push/`
      into it unchanged
- [X] T046 [US1] Extract the business logic from `server/src/push/routes.js` into
      `server/src/modules/push/application/*.js`
- [X] T047 [US1] Create `server/src/modules/push/controller.js` and
      `server/src/modules/push/routes.js` (schema/wiring only) — depends on T046
- [X] T048 [US1] Update the `pushRoutes` import in `server/src/app.js` to `./modules/push/routes.js`;
      delete the now-empty `server/src/push/` directory; update any push-related test imports; run
      `npm run -w server test`; confirm identical results to baseline (checkpoint)

### public

- [X] T049 [US1] Create `server/src/modules/public/` and move `content.js` from `server/src/public/`
      into it unchanged
- [X] T050 [US1] Extract the business logic from `server/src/public/routes.js` into
      `server/src/modules/public/application/*.js`
- [X] T051 [US1] Create `server/src/modules/public/controller.js` and
      `server/src/modules/public/routes.js` (schema/wiring only) — depends on T050
- [X] T052 [US1] Update the `publicRoutes` import in `server/src/app.js` to
      `./modules/public/routes.js`; delete the now-empty `server/src/public/` directory; run
      `npm run -w server test`; confirm identical results to baseline (checkpoint)

**Checkpoint**: Every HTTP domain now has a route/controller/application split; `server/src/ops/`
remains intentionally flat per plan.md; full suite green.

---

## Phase 4: User Story 2 - Add a new endpoint by following one obvious pattern (Priority: P2)

**Goal**: A developer can add a new endpoint by copying one existing domain's three-file pattern.

**Independent Test**: A developer adds a new, simple endpoint end-to-end by copying
`modules/organisations/` (the smallest fully-migrated domain) and renaming, without asking where
any kind of code belongs (spec.md, User Story 2's Independent Test).

- [X] T053 [US2] Write the "Adding a new endpoint" section of `server/ARCHITECTURE.md` (skeleton
      from T002): name `server/src/modules/organisations/` as the reference slice, and spell out the
      three files a new endpoint needs (route, controller, one application function) with the exact
      responsibility of each, referencing FR-001/FR-010 (cross-domain calls happen at the
      application layer, never route-to-route or controller-to-controller)

**Checkpoint**: Documentation exists; Phase 3's completed migration is itself the enforceable
example — no additional code changes are required for this story.

---

## Phase 5: User Story 3 - Learn Fastify's own structure from this codebase (Priority: P3)

**Goal**: A developer new to Fastify can tell a plugin, a decorator, and a hook apart using only
this codebase and one document.

**Independent Test**: Reading `server/ARCHITECTURE.md` plus browsing the folders it names, a
developer can correctly explain plugin vs. decorator vs. hook and name one real example of each
(spec.md SC-004).

- [X] T054 [US3] Write the "Fastify concepts in this repo" section of `server/ARCHITECTURE.md`:
      define plugin (`fastify.register`, example `server/src/plugins/07-rate-limit.js`), decorator
      (`fastify.decorate*`, example `server/src/decorators/send-otp.js`), and hook
      (`fastify.addHook`, example `server/src/hooks/csrf-on-request.js`); restate — do not
      re-derive — the numbered plugin boot-order rationale already in `CLAUDE.md`, with a link/quote
      rather than a second, potentially-drifting explanation
- [X] T055 [US3] Add a one-line pointer to `server/ARCHITECTURE.md` from `server/README.md`'s
      existing structure/overview section

**Checkpoint**: `server/ARCHITECTURE.md` fully written; all three user stories independently
verifiable per quickstart.md.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Close out anything spanning the whole reorganization.

- [X] T056 [P] Update `CLAUDE.md`'s "Layout" section to describe `server/src/modules/`,
      `server/src/decorators/`, and `server/src/hooks/` alongside the existing `server/` description
- [X] T057 Grep `server/src` and `server/tests` for any remaining import referencing a deleted path
      (`src/auth/`, `src/media/`, `src/seo/`, `src/organisations/`, `src/push/`, `src/public/`
      outside `src/modules/...`) and fix any found; there should be none left after Phase 3
- [X] T058 Run the full quickstart.md verification: `npm run -w server test`,
      `npm run -w server verify:seo`, `npm test` (all workspaces); confirm results match T001's
      baseline exactly (final gate before considering the feature done)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (needs the baseline from T001 to verify against);
  not a hard blocker for Phase 3, but ordered first since research.md front-loads the
  lower-risk/lower-payoff work
- **User Story 1 (Phase 3)**: Depends on Phase 2 being green (decorators auth/media/etc. controllers
  will call must already be registered under their final names)
- **User Story 2 (Phase 4)**: Depends on Phase 3 being complete (needs a fully-migrated domain to
  point at as the reference slice)
- **User Story 3 (Phase 5)**: Depends on Phase 2 (needs `decorators/`/`hooks/` to exist) and
  benefits from Phase 3 being complete, but could technically start once Phase 2 is done
- **Polish (Phase 6)**: Depends on Phases 3–5 all being complete

### Within Phase 3 (per domain)

- Application-layer extraction tasks (e.g. T013–T019 for auth) are `[P]` — each is a new,
  independent file with no dependency on the others
- The controller task always depends on that domain's application tasks being done
- The routes task always depends on that domain's controller task
- The `app.js` import update + directory deletion always comes after the routes task
- Test-import updates and the checkpoint test run always come last for that domain
- Domains themselves (auth → media → seo → organisations → push → public) are migrated
  **sequentially**, not in parallel, per FR-007 and research.md — each domain's checkpoint must be
  green before the next domain starts, so a regression is attributable to one domain

### Parallel Opportunities

- T006–T009 in Phase 2 touch independent new files, but all edit `server/src/app.js` at the end —
  treat as sequential in a single-developer session; a team could split the *new-file* halves in
  parallel and serialize only the `app.js` edits
- Within any one domain's application-layer extraction (e.g. T013–T019), all tasks are `[P]`
- T056 (CLAUDE.md update) can run in parallel with anything in Phase 5, since it touches a different
  file

---

## Parallel Example: auth application-layer extraction

```bash
# After T012 (files moved), launch T013–T019 together — each writes a different new file:
Task: "Extract sign-in logic into server/src/modules/auth/application/sign-in.js"
Task: "Extract OTP verify logic into server/src/modules/auth/application/verify-otp.js"
Task: "Extract OTP resend logic into server/src/modules/auth/application/resend-otp.js"
Task: "Extract refresh-token logic into server/src/modules/auth/application/refresh.js"
Task: "Extract sign-out logic into server/src/modules/auth/application/sign-out.js"
Task: "Extract password-reset request logic into server/src/modules/auth/application/request-password-reset.js"
Task: "Extract password-reset confirm logic into server/src/modules/auth/application/confirm-password-reset.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational)
2. Complete Phase 3 (User Story 1) — this alone delivers the spec's primary value: every endpoint's
   three layers are separately findable
3. **STOP and VALIDATE**: run quickstart.md's per-domain and whole-feature checks
4. Phases 4–5 (documentation) can follow whenever convenient; they add no code risk

### Incremental Delivery

1. Setup + Foundational → baseline recorded, `app.js` cleaned up, suite green
2. auth migrated → checkpoint green → media migrated → checkpoint green → seo → organisations →
   push → public, each its own checkpoint
3. Documentation (US2, US3) written once the reference slice (organisations) and the
   decorators/hooks (Phase 2) exist
4. Polish: update `CLAUDE.md`, final whole-workspace verification

## Notes

- No test tasks: this feature adds no new tests, per research.md — every checkpoint task re-runs
  the *existing* suite as the regression oracle (FR-006, SC-002)
- Commit after each domain's checkpoint (T024, T032, T040, T044, T048, T052), not after every task,
  so each commit is independently revertable per quickstart.md's Rollback section
- `server/src/ops/` (`health.js`, `jobs.js`, `metrics.js`, `audit.js`) is intentionally left flat —
  no tasks split it further, per plan.md's Structure Decision

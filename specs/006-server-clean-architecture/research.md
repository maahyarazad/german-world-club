# Phase 0 Research: Server Clean Architecture Reorganization

No `[NEEDS CLARIFICATION]` markers were left in the spec, and the target stack (Node 22, Fastify 5,
Vitest, ES modules) is fixed by the existing codebase — nothing to resolve there. The open
questions worth recording are about *how* to reorganize a live, principle-gated Fastify app without
introducing a behavior regression, not about *what* stack to use.

## Decision: Layer boundary = routes / controllers / application / lib, mapped onto existing Fastify concepts

**Decision**: Adopt a pragmatic four-layer split per HTTP domain — route (Fastify schema + wiring),
controller (request/response translation), application (business rule, framework-free), lib
(shared framework-free infrastructure) — rather than a textbook Clean Architecture with formal
dependency-inversion boundaries (entities/use-cases/interface-adapters/frameworks-and-drivers with
enforced inward-only dependencies via DI container).

**Rationale**: The spec's own success criteria (SC-001, SC-003, SC-004) are about *navigability and
learnability*, not about enforcing dependency-rule purity with tooling. The codebase has no DI
container today, and introducing one is out of scope per the spec's Assumptions. A four-layer split
that matches names developers already know (route/controller/service or route/controller/application)
delivers the lookup-speed win with a fraction of the risk of retrofitting formal Clean Architecture
onto 335 files in one feature.

**Alternatives considered**:
- *Full textbook Clean Architecture (entities, use-cases, interface adapters, frameworks/drivers,
  with dependency-inversion via interfaces/ports)* — rejected: this project has no domain entities
  with business rules independent of persistence (member/session/media rows are anemic records
  manipulated by SQL, per Principle IV — "Integrity Lives In The Database"), so a formal entity
  layer would be ceremony without content, and the migration risk on a 335-file codebase is not
  justified by the spec's own scope (Assumptions explicitly rule out introducing a DI framework).
- *Leave routes.js as-is, only add doc comments explaining the mixing* — rejected: fails FR-001/FR-002/
  User Story 1's independent test (find controller vs. application logic without full-text search);
  documentation without structural separation decays the first time someone is in a hurry.

## Decision: Extract `app.js`'s inline decorators/hooks into `decorators/` and `hooks/`, not into `plugins/`

**Decision**: `server/src/plugins/00`–`15` stay exactly as-is (already correctly organized, already
the canonical boot-order document per `CLAUDE.md`). The decorators and hooks currently written
inline inside `buildApp()` in `app.js` (7 `app.decorate(...)` groups, 1 `onRequest` CSRF hook, 1
`onClose` hook, 1 `onReady` hook) move into two new sibling folders, `decorators/` and `hooks/`,
each exporting a plain function that `app.js` calls, keeping `app.js` as the single place that
reads top-to-bottom as "this is the boot sequence" (register plugin → register plugin → apply
decorator → apply hook → register routes).

**Rationale**: FR-002 requires plugins, decorators, and hooks to be identifiable as distinct
categories. Today only plugins meet that bar; decorators and hooks are anonymous inline code in
`app.js`. Moving them out makes User Story 3's independent test possible (a Fastify newcomer can
point at three folders and get three correct, non-overlapping answers to "what's a plugin/decorator/
hook here").

**Alternatives considered**:
- *Wrap each decorator/hook as its own numbered plugin file inside `plugins/`* — rejected: would
  imply they participate in the same load-bearing *order* as `00`–`15` (FR-003 says that sequence's
  meaning must not be diluted), when in fact most of these decorators have no ordering constraint
  relative to each other (only relative to the plugins already before/after them in `app.js`).
  Folding them into the numbered sequence would make the sequence longer and harder to reason about
  for the one property (auth-before-authz-before-deadlines) that actually matters.
- *Leave them inline in `app.js`* — rejected: `app.js` is 383 lines today and is precisely the file
  User Story 3 says a newcomer opens first; leaving cross-cutting decorators/hooks inline defeats
  the "each category is easy to find" acceptance scenario.

## Decision: Migrate one domain at a time, verified by the existing suite, not a single-PR rewrite

**Decision**: Order of migration: `auth` (largest, most business logic, best regression coverage)
→ `media` → `seo`+`organisations`+`push`+`public` (smaller, similar shape) → the `app.js`
decorator/hook extraction → `ops` (left mostly flat, see plan.md) → documentation.

**Rationale**: FR-007 requires per-domain verifiability. `server/tests/` is already organized by
domain (`tests/auth`, `tests/media`, `tests/seo`, …), so each domain's move can be validated in
isolation by running that domain's suite plus the full suite before moving to the next, isolating
any regression to the domain just touched. `auth` first because it has the deepest existing test
coverage (per `CLAUDE.md`'s history of "complete US1 credential tests" work) and the biggest payoff
(750-line `routes.js`), so it validates the pattern before it's repeated four more times.

**Alternatives considered**:
- *Big-bang single-PR rewrite of all domains at once* — rejected outright by FR-007 and by the
  spec's Edge Cases (isolating a regression to the domain being moved).
- *Move `app.js` decorators/hooks first* — rejected: those are lower-value/lower-risk than the
  domain routes.js splits that deliver User Stories 1 and 2, and doing them last means the riskiest,
  highest-payoff work (auth, media) is validated while the team's attention is freshest.

## Decision: No new test files; existing suites are the regression oracle

**Decision**: This feature adds no new automated tests. It relies entirely on the existing
`server/tests/**` suite (organized by domain, asserting via `fastify.inject()` against behavior, not
file layout, per `CLAUDE.md`'s "Tests assert behaviour, not implementation") passing unchanged
after each domain's import paths are updated.

**Rationale**: Spec's FR-006 and SC-002 explicitly frame success as "100% of existing tests pass,
behavior unchanged" — this is a refactor, and per the repo-wide instruction ("don't add
tests/validation for scenarios that can't happen" / avoid unrequested scope), the correct new
artifact is not a test suite but a one-time verification pass (documented in quickstart.md) that
each moved domain's suite plus the whole-workspace suite is green before moving to the next domain.

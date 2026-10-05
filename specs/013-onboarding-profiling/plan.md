# Implementation Plan: Onboarding Phase 2 — Profiling Workflow

**Branch**: `013-onboarding-profiling` | **Date**: 2026-09-29 | **Revision 2**: 2026-09-29 (see bottom) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-onboarding-profiling/spec.md`

## Summary

A new, mandatory gate slots in right after Phase 1 approval and before ordinary member access,
exactly the way Phase 1's own `onboarding: true` gate already works (research R1, R2). The
questionnaire branches on the `country_of_residence` a member already gave during registration
(`members.country_of_residence`, `020_onboarding.sql` — its comment already anticipates this
feature): Germany gets five sequential questions (settling status, languages, qualification,
occupation, desired work type); everyone else submits one primary and up to two secondary nearest
cities, which are checked against a new small reference list of designated GWC cities and resolve
to one of two outcomes (in-person meeting, or a placeholder for the still-undefined GWC-city-match
flow). One new sidecar table (`member_profiling`), one new reference table (`gwc_cities`), two new
member routes (`GET /profiling/status`, `PATCH /profiling`), one new auth-gate check, and matching
client-side gating on both the web console and the Expo app.

## Technical Context

**Language/Version**: TypeScript on Node 22 (server: ES modules, `.ts`), React 19 (console), Expo
SDK 57 / React Native (mobile) — same stack as every prior feature since 007's TypeScript migration.

**Primary Dependencies**: Fastify 5, `pg`, Zod (contracts request/response schemas — still present;
feature 007 migrated the server to TypeScript, it did not remove Zod) on the server; React Router in
the console; `expo-router` in the app. No new dependencies.

**Storage**: PostgreSQL. Migration `032_profiling.sql`: `gwc_cities`, `member_profiling`, two
triggers (immutability on `member_profiling`, `updated_at` bump), and one new problem type constant
(no schema change for that part — it's TypeScript only).

**Testing**: Vitest for server and client (SQL suites skip loudly without a database), the existing
access-control matrix suite extended with the two new routes and the new gate check, `expo lint` for
the mobile app (unchanged guard), `test:i18n` for the two new locale catalogue keys.

**Target Platform**: Linux server; staff console and member console in evergreen browsers; iOS/
Android (and Expo web) for the mobile app.

**Project Type**: Web service + web client + mobile app (npm workspaces, shared `@gwc/contracts`) —
unchanged from every prior feature.

**Performance Goals**: Both new routes are simple single-row reads/writes with no outbound
dependency; `member-read`/`member-write` budgets (2000ms / 5000ms deadlines) apply unchanged.

**Constraints**:
- Zero external calls from either new route (no SMS/mail/geocoding — geocoding is not needed since
  matching is an exact `(country, city)` lookup against a small reference table, not a live lookup).
- `member_profiling` writes must be rejected once `completed_at` is set, enforced by trigger, not
  application code (Constitution IV).
- No response schema layer remains to check response shape (Constitution VI, amended) — both
  controllers name their selected columns explicitly, per the project-wide convention that replaced
  it.

**Scale/Scope**: 1 migration, 2 new tables, 2 new server routes, 1 new contracts file, 1 gate check
extension in an existing plugin, 1 new web console screen, 1 new Expo route group (2-3 screens), 2
locale catalogue additions.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Touched by | Status | Automated check |
|---|---|---|---|
| **I. One rule set, three clients** | `ProfilingStatus`/request types, the fixed choice lists (`SETTLING_STATUSES`, `QUALIFICATION_LEVELS`, `OCCUPATIONS`, `DESIRED_WORK_TYPES`, `LANGUAGES`), reuse of the existing `GERMANY` constant | ✅ All defined once in `packages/contracts/src/profiling.ts`, imported by server (SQL `CHECK` values kept in sync by hand, same as `members.gender`/`GENDERS` already are) and both clients. Neither client decides completion, branch, or GWC-city matching itself — both call `GET /profiling/status`/`PATCH /profiling` and render what the server returns. | `tsc --noEmit` across workspaces; a new `client/tests/onboarding/profiling.test.tsx` and the Expo app's `expo lint` |
| **II. Declare every posture** | 2 new member routes | ✅ Both declare `config.auth = { audience: 'member', profiling: true }`; the boot gate (no route with no `config.auth`) refuses an undeclared one. No new crawl posture: these are gated member API routes, already excluded from indexing the same way `/onboarding/*` is. | Boot gate; access-control matrix test extended with both routes × every principal kind |
| **III. Published state matches real state** | N/A — no public/indexed surface | ✅ Vacuously satisfied; noted rather than omitted, per the constitution's own precedent against silent "vacuous pass." | — |
| **IV. Integrity in the database** | `member_profiling` immutability, branch freeze, outcome/match consistency | ✅ `BEFORE UPDATE` trigger refuses any change once `completed_at` is set (mirrors `membership_applications_decision_is_final`); `CHECK` constraints keep germany-only and elsewhere-only fields mutually exclusive and keep `outcome`/`matched_gwc_city_id` consistent; `member_id` is `PRIMARY KEY REFERENCES members ON DELETE RESTRICT`, so profiling data cannot outlive a deleted member — and members are never deleted anyway. | `server/tests/profiling/germany-flow.test.ts` and `elsewhere-flow.test.ts` (immutability + constraint violations), `branch-freeze.test.ts` |
| **V. Failure explicit and bounded** | 2 new routes, no outbound dependency | ✅ `member-read`/`member-write` budgets already satisfy `Σ(outbound) < deadline < requestTimeout` (`assertBudgets`) since neither route adds a new outbound call; GWC-city matching is a same-transaction table lookup, not a network call. | `assertBudgets` (startup gate, unchanged since no new `OUTBOUND` entry is added) |
| **VI. Server shapes what leaves it** | `member_profiling`/`gwc_cities` queries, `ProfilingStatus` response | ✅ Controller/application code names every selected column explicitly (no `SELECT *`), per the project convention that replaced the withdrawn response-schema gate; no PII beyond what the member themselves submitted is exposed; language codes and enum values are opaque tokens, not free text. | New `server/tests/profiling/*.test.ts` include an explicit-columns check alongside behaviour, matching the pattern in `tests/server-faults/redaction.test.ts` for a comparable prior feature |
| **Workflow: every principle has a check** | All of the above | ✅ Each row above names its test | New suite under `server/tests/profiling/` |
| **Onboarding-specific rule (CLAUDE.md)**: "An applicant with no row is untouched" | The new gate check | ✅ Gated on `application_state === 'approved'`, so invited/legacy members (`application_state IS NULL`) never see this check | `server/tests/profiling/gate.test.ts` scenario for a no-row member |

**Gate result (pre-research)**: PASS. No violations; Complexity Tracking stays empty.

**Re-check (post-design)**: PASS. The design adds one gate check, one join column, two tables, and
two routes, all following existing precedent exactly (Phase 1's own onboarding gate, `member_avatars`
/`organisation_profiles` sidecar shape, `membership_applications`' final-decision trigger). No
principle is weakened; nothing here relies on a protection feature 007 already removed.

## Project Structure

### Documentation (this feature)

```text
specs/013-onboarding-profiling/
├── plan.md                        # This file
├── spec.md
├── research.md                    # R1–R7
├── data-model.md                  # gwc_cities, member_profiling
├── quickstart.md                  # 5 validation scenarios + automated coverage list
├── contracts/
│   └── profiling-api.md           # GET /profiling/status, PATCH /profiling, gate interaction
├── checklists/requirements.md
└── tasks.md                       # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
packages/contracts/src/
├── onboarding.ts                  # unchanged — GERMANY constant reused, not redeclared
├── errors.ts                      # + PROFILING_INCOMPLETE (Account state section)
└── profiling.ts                   # NEW: ProfilingStatus, PATCH request shapes, fixed choice
                                    #      lists, LANGUAGES

server/
├── migrations/032_profiling.sql              # NEW: gwc_cities, member_profiling, triggers, seed rows
├── src/
│   ├── plugins/10-auth.ts                    # applyMemberGates: + profiling check; loadMember: + join
│   ├── plugins/11-rbac.ts                    # validateAuthConfig: + profiling flag validation
│   └── modules/profiling/                    # NEW
│       ├── routes.ts                         # GET /profiling/status, PATCH /profiling
│       ├── controller.ts
│       └── application/
│           ├── status.ts                     # read branch/progress/completion
│           └── submit.ts                     # merge answer(s), compute completion + outcome
└── tests/profiling/                          # NEW: gate, germany-flow, elsewhere-flow, branch-freeze

client/src/
├── onboarding/
│   ├── Application.tsx                       # + profiling-status check before `enter()`
│   └── Profiling.tsx                         # NEW: renders the branch-appropriate flow
├── lib/api.ts                                # + profiling calls (or reuse existing get/patch helpers)
└── i18n/{de,en}.ts                           # + profiling strings
client/tests/onboarding/profiling.test.tsx    # NEW

expo-client/german-world-club/src/
├── session/session.tsx                       # SessionState: + 'profiling' status; route(): 3-way branch
├── app/
│   ├── _layout.tsx                           # + Stack.Protected guard for 'profiling'
│   └── (profiling)/                          # NEW, mirrors (applicant)/
│       ├── _layout.tsx
│       └── index.tsx                         # (or per-branch screens)
└── api/endpoints.ts                          # + profiling calls
```

**Structure Decision**: The existing workspace layout, unchanged. Server code follows
`server/ARCHITECTURE.md`'s module split (`routes.ts` / `controller.ts` / `application/`); the new
`profiling` module sits alongside `onboarding` rather than inside it, because it has its own access
posture (`profiling: true`, not `onboarding: true`) and its own gate check — conflating the two
modules would blur exactly the distinction the new gate exists to make. Client changes extend the
existing single post-approval decision point on each face (research R7) rather than introducing a
new navigation pattern.

## Complexity Tracking

*No entries — the Constitution Check above recorded no violations.*

---

# Revision 2 — updated Profiling Workflow + go-back (2026-09-29)

Feature 013 shipped once (migrations `032`, `033`; `PATCH /profiling` completing on the last
answer). The business description then changed and members must be able to correct mistakes. This
section is the delta plan; everything above still describes what is built. Decisions are in
`research.md` R10–R15, shapes in `data-model.md` and `contracts/profiling-api.md`.

## What changes

| Layer | Change |
|---|---|
| **Database** | `034_profiling_relationship.sql`: `member_profiling` + `yearly_income_range`, `relationship_tags`; `desired_work_type` gains `business_owner`; future-work CHECK replaced (industry on every path); new tables `member_profiling_kids`, `member_profiling_partner`; trigger making both final once the parent is complete. Additive; completed rows untouched. |
| **Contracts** | `profiling.ts`: new lists (`YEARLY_INCOME_RANGES`, `RELATIONSHIP_TAGS`, `KID_AGE_RANGES`), `business_owner`, extended status/patch schemas (partner, kids, tags; elsewhere fields become a subset), **`profilingSteps` / `profilingMissing`** step engine. `errors.ts`: `PROFILING_ANSWERS_MISSING` (409). |
| **Server** | `submit.ts`: PATCH saves only (no completion), partner/kids/tags upsert with cascade clears (R14), elsewhere cities saved without resolving. New `application/complete.ts` + `POST /profiling/submit` (missing-check via the shared engine, GWC match + outcome, `completed_at`). `status.ts` reads kids/partner/tags/income. `review.ts` (staff) shows the new answers (SC-006). `seed/tables.ts` lists the two new tables. |
| **Web console** | `client/src/onboarding/Profiling.tsx` driven by `profilingSteps`: Back on every step but the first, saved answers preselected, income and relationship (bubbles, Single exclusive), kids count + per-kid age, partner wizard reusing the German question components with a `subject` prop, five Q7 paths, **Review** step (Change per answer, Submit), completion/outcome screen. i18n `de`/`en` keys for all of it. |
| **Expo app** | `(profiling)/index.tsx` and its wizard get the same treatment (split into per-step components under `(profiling)/`), header + Android hardware Back (`BackHandler`), review + submit, `api/endpoints.ts` gains `submitProfiling`. Same shared step engine, same endpoints. |
| **Unchanged** | The auth gate, `profiling: true` flag, `GET /profiling/gwc-cities`, branch freezing, FR-020 immutability, the `INTERNAL`/logging conventions (clients `console.error` failures; no error state — a refusal like `PROFILING_ANSWERS_MISSING` only moves the member to the first missing step). |

## Technical Context additions

- **Storage**: one more migration (`034`); 2 new tables, 3 new `member_profiling` columns, 2 replaced CHECKs.
- **Testing**: server suites extended — `germany-flow` (income, Q7 five paths, business owner), new `relationship-flow` (tags, Single exclusivity, kids, partner, both branches, elsewhere ends at review), new `go-back.test.ts` (re-answer replaces; cascades from R14; nothing stale reaches submit), new `submit.test.ts` (missing → 409 `PROFILING_ANSWERS_MISSING`; elsewhere outcome computed at submit; PATCH never completes), immutability trigger tests for the new tables, contracts unit tests for `profilingSteps`/`profilingMissing` (every Q6 × Q7 combination). Client `profiling.test.tsx`: Back preselects, Change from review returns to review, Single exclusivity. `test:i18n` for new keys. Access-control matrix gains `POST /profiling/submit`. No-PII scan (`no-pii-in-social`) unaffected (no social route reads these tables).
- **Performance**: `POST /profiling/submit` is one transaction of a few single-row queries; `member-write` budget unchanged, no new outbound call.

## Constitution Check (revision 2)

| Principle | Status | Note |
|---|---|---|
| I. One rule set | ✅ | Step order and "missing" defined once in contracts and used by server + web + Expo (R11); `tsc --noEmit` names every caller of a changed shape. |
| II. Declare every posture | ✅ | `POST /profiling/submit` declares `{ audience: 'member', profiling: true }`; boot gate and access-control matrix cover it. |
| III. Published state | ✅ N/A | No public surface. |
| IV. Integrity in the database | ✅ | Tag/age/income/Q7 CHECKs; Single exclusivity as a CHECK; kids/partner final-by-trigger; PATCH-vs-submit split means completion is a single guarded UPDATE. |
| V. Failure bounded | ✅ | No new outbound dependency; `assertBudgets` unchanged. |
| VI. Server shapes output | ✅ | Explicit columns in `status.ts` and the new queries; partner rows hold answers only, no identity. |

**Gate result**: PASS, no Complexity Tracking entries. One behaviour change to call out: PATCH no longer
completes (R10) — any caller relying on that (the two clients, existing tests) is updated in this work.

## Source additions

```text
packages/contracts/src/profiling.ts      # + lists, schemas, profilingSteps/profilingMissing
packages/contracts/src/errors.ts         # + PROFILING_ANSWERS_MISSING
server/migrations/034_profiling_relationship.sql
server/src/modules/profiling/application/complete.ts   # NEW
server/src/modules/profiling/{routes,controller}.ts    # + POST /profiling/submit
server/src/modules/onboarding/application/review.ts    # + new answers for staff
server/src/seed/tables.ts                              # + kids, partner (HISTORY, never seeded)
server/tests/profiling/{relationship-flow,go-back,submit}.test.ts   # NEW
packages/contracts/tests/profiling-steps.test.ts       # NEW
client/src/onboarding/profiling/*                      # step components split out of Profiling.tsx
expo-client/german-world-club/src/app/(profiling)/*    # per-step screens/components
```

## Open point for the user

Members who already **completed** profiling under the old questions are not re-profiled (R15). If
the business wants them asked the new questions, that is a deliberate follow-up — it needs a way to
reopen a completed row, which today's trigger forbids by design.

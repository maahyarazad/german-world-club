# Implementation Plan: Onboarding Phase 2 — Profiling Workflow

**Branch**: `013-onboarding-profiling` | **Date**: 2026-09-29 | **Spec**: [spec.md](./spec.md)

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

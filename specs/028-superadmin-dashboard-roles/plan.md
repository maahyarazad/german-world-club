# Implementation Plan: Superadmin dashboard numbers, and Roles & permissions

**Branch**: `028-superadmin-dashboard-roles` (create from `main`; nothing here depends on 026/027 except that `.specify/memory/constitution.md` is at 4.0.0 on that PR) | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

## Summary

Two additions to the staff console, both reading and writing nothing that does not already exist:

1. **Dashboard figures.** A new superadmin-only read, `GET /admin/dashboard/figures`, returns nine counts computed on the server; `AdminDashboard.tsx` shows them to a superadmin in place of the granted-areas tiles and list. Other staff keep today's dashboard.
2. **Roles & permissions.** The `admins` module has no routes, which is the whole reason it reads "Not available yet". Two routes make it real: `GET /admin/admins` (every staff account with role, state, grants, and, per account, which changes are allowed and why not) and `PATCH /admin/admins/:id` (grants, role, active state). The rules are the ones the platform already has: the database trigger that keeps one active superadmin, and the two object guards (`guardAdminTarget`, `guardSelfDemotion`) that exist and are tested but have no caller. The server computes "allowed / reason" once; the page only disables a control and shows the tooltip. No migration and no new table.

## Technical Context

**Language/Version**: Node 22, Fastify 5, TypeScript in `server/src`; React 19 + Vite web console; Zod types from `packages/contracts`
**Primary Dependencies**: existing only
**Storage**: PostgreSQL; reads `members`, `membership_applications`, `organisations`, `marketplace_listings`, `conversations`, `marketplace_reports`, `thread_reports`, `events`, `admin_users`; writes `admin_users` and `admin_permissions`. **No migration.**
**Testing**: vitest (server SQL suites against a throwaway Postgres with an explicit `DATABASE_URL`; never the URL in `server/.env`); client vitest + Testing Library
**Target Platform**: Linux server; web console only (the Expo app has no staff console)
**Project Type**: web-service + web client
**Performance Goals**: nine counts in parallel, each over an indexed predicate; whole response well under the 2 s success criterion (route class `admin-read`, 5 s deadline)
**Constraints**: no `SELECT *`; no `password_hash` or session data in any response; the server sends reason codes, never translated text; every change audited; a change effective on the target's next request (permissions are resolved per request, so nothing to invalidate)
**Scale/Scope**: tens of staff accounts, a few thousand members

## Constitution Check

*Checked against `.specify/memory/constitution.md` (3.0.0 on `main`; 4.0.0 on PR #20).*

| Principle | Result |
|---|---|
| I One rule set | PASS. Which change is allowed, and the reason, is computed once on the server and sent as codes; the console only renders it. Types and reason codes live in `@gwc/contracts`. |
| II Declare posture | PASS. Three new routes declare `config.auth` with module `admins`. Rules that depend on the *target* run inside the handler's transaction against the row loaded `FOR UPDATE` (the existing guards), not in the route declaration. |
| III Published = real | N/A. Gated surface, never indexed; no public page changes. |
| IV Integrity in the DB | PASS. The last-superadmin invariant stays a trigger (006). The application check gives a clean answer first; if two requests race, the trigger still refuses and the handler maps its exception to the same problem type. Audit is append-only, unchanged. |
| V Failure explicit | PASS. New routes use `admin-read` (5 s) and a new `admin-write` class (5 s, `redis` only); no outbound call. Each dashboard count that fails is reported as unavailable, not zero. |
| VI Server shapes output | PASS. Explicit column lists, hand-built response objects; a test scans the responses for `password`, `hash`, `token`, `session`. |
| Baseline | PASS. No credential or session behaviour changes. |

No violations; Complexity Tracking is empty. Post-design re-check: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/028-superadmin-dashboard-roles/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/admin-api.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
packages/contracts/src/admin.ts                    # DASHBOARD_FIGURES, figure + admin-account schemas, BLOCKERS, request schema
packages/contracts/src/errors.ts                   # + LAST_SUPERADMIN (409), CANNOT_CHANGE_SELF (403); CONFLICT reused for stale
packages/contracts/package.json                    # "./admin" export
server/src/config/budgets.ts                       # + 'admin-write'
server/src/modules/admin-dashboard/{routes,controller}.ts + application/figures.ts
server/src/modules/admins/{routes,controller}.ts + application/{list,update,constraints}.ts
server/src/authz/object-guards.ts                  # guards reused; guardSelfDemotion/guardLastSuperadmin get their first caller
server/src/app.ts                                  # register the two route plugins
client/src/console/AdminDashboard.tsx              # superadmin view: figures; others unchanged
client/src/console/admin/Roles.tsx                 # list, grants grid, role/active controls, tooltips
client/src/console/routes.tsx                      # `rollen` -> <Roles/> (RequireGrant admins/read)
client/src/i18n/{en,de}.ts                         # figures, roles page, blocker tooltips
client/tests/console/unbuilt-areas.test.tsx        # add 'admins' to BUILT
server/tests/admins/, server/tests/admin-dashboard/, client/tests/console/{admin-dashboard,roles}.test.tsx
server/tests/authz/matrix.test.ts                  # rows for the three routes
```

**Structure Decision**: two small modules (`admin-dashboard`, `admins`) per the repo layout rules (`routes` / `controller` / `application/`). The guards stay where they are.

## Design decisions (detail in research.md)

- **D1** "Roles" are derived: `superadmin` (`is_superadmin`), `administrator` (`is_admin`), `staff`. No role table (§11 keeps the matrix as is).
- **D2** The module's page is available because routes registering with module `admins` make `availableModules()` include it; nothing is hard-coded.
- **D3** Per-account `constraints` are computed on the server by one function used both to build the list and to validate the PATCH, so the page and the refusal cannot disagree.
- **D4** Reasons are codes: `self`, `last-superadmin`, `superadmin-required`. The page maps them to localised tooltips; refusals are problem types `CANNOT_CHANGE_SELF`, `LAST_SUPERADMIN`, `CANNOT_MANAGE_ADMIN`, and a stale write is `CONFLICT`.
- **D5** Concurrency: the PATCH carries the account's `version` (its `updated_at`); the handler loads the row `FOR UPDATE`, refuses on mismatch, and every grant change also touches `admin_users.updated_at` so one token covers role, state and grants.
- **D6** The dashboard route needs module `admins` + flag `read` for posture and then refuses anyone who is not a superadmin in the handler (the posture vocabulary has no "superadmin only" and adding one is not worth a new gate class for one route).
- **D7** Figures are computed in parallel with `Promise.allSettled`; a failure yields `value: null` for that figure only.

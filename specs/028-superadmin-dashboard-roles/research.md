# Research: Superadmin dashboard and Roles & permissions

Findings are from reading the code on 2026-11-17. No database was queried.

## R1. Why "Roles & permissions" says "Not available yet"
`availableModules()` (`server/src/plugins/11-rbac.ts` ~l.227) is derived from registered routes whose `config.auth.module` names a module. No route names `admins`, so the console marks it unavailable. The client item is `ADMIN_ITEMS` → `/konsole/admin/rollen`, `module: 'admins'` (`client/src/console/admin/AdminLayout.tsx`), and `routes.tsx` sends unknown admin paths to `NotBuilt`. `client/tests/console/unbuilt-areas.test.tsx` lists the built modules in `BUILT`; `admins` must be added or that suite will assert the "not available" hint against a real page.
- **Decision**: add the routes; nothing else flips the state.

## R2. What the database already enforces
- `admin_users(is_admin, is_superadmin, is_active, …)` and `admin_permissions(admin_user_id, module, can_read, can_write, can_edit, can_delete, can_status)` with PK `(admin_user_id, module)`; the `admin_module` enum is exactly the 21 areas (migrations 001, 030, 040). No row means no flags.
- Trigger `admin_users_superadmin_guard` (006): the last active superadmin cannot be demoted, deactivated or deleted.
- No CHECK ties `is_superadmin` to `is_admin`, and nothing forbids granting modules to a superadmin (their grants are simply bypassed at enforcement).
- **Decision**: these are the only "database rules"; the page offers everything else.

## R3. What the application already enforces, unused
`server/src/authz/object-guards.ts` has `guardAdminTarget` (only a superadmin manages an admin/superadmin, **regardless of the actor's `admins` flags**), `guardSelfDemotion`, and `guardLastSuperadmin`, with tests in `tests/authz/object-guards.test.ts` and no caller. This feature is their first.
- **Decision**: reuse them unchanged inside the PATCH transaction, after loading the target `FOR UPDATE`, before any write. Do not copy their logic into a second rule set.

## R4. Where a "reason" lives
- `CANNOT_MANAGE_ADMIN` (403) exists. There is no problem type for "last superadmin" or "yourself"; `guardLastSuperadmin` currently reuses `CANNOT_MANAGE_ADMIN` with an English detail, and the console translates on `type`, so three situations would look identical to it.
- **Decision**: add `LAST_SUPERADMIN` (409) and `CANNOT_CHANGE_SELF` (403) to `packages/contracts/src/errors.ts` (and register their console descriptions in `client/src/lib/problems.ts`), and make the two guards throw them. The list response carries the same three reasons as codes.

## R5. Stale and concurrent edits
Two superadmins can open the same account. `admin_users.updated_at` is maintained by the guard trigger on every UPDATE; grants live in another table.
- **Decision**: every PATCH `UPDATE admin_users SET updated_at = now()` in the same transaction, even when only grants change, and the version token is that timestamp. A mismatch is `CONFLICT` (409). The trigger remains the last line for the "two superadmins demote each other" race; its `RAISE EXCEPTION` (SQLSTATE P0001, message "…cannot be demoted or deactivated…") is mapped to `LAST_SUPERADMIN`.
- **Rejected**: advisory locks (more machinery for tens of rows) and per-row versions on `admin_permissions` (a second token to carry).

## R6. The dashboard numbers
| Figure | Source | Predicate |
|---|---|---|
| activeMembers | `members` | `status = 'active'` **and no application that is not approved** (an applicant's status stays `active`; implemented this way after the US1.3 scenario) |
| waitingApplications | `membership_applications` | `state = 'pending' AND submitted_at IS NOT NULL` (what staff actually see in the queue) |
| activeMerchants / activePartners | `organisations` | `kind = 'merchant' \| 'partner'`, `status = 'active'` |
| liveListings | `marketplace_listings` | `state = 'active'` |
| listingRequests | `conversations` | `subject_type = 'listing'` and created in the last 30 days (008: a request is the first message of one conversation per member per listing) |
| openReports | `marketplace_reports` + `thread_reports` | `state = 'open'`, summed |
| upcomingEvents | `events` | `starts_at > now()` (and not cancelled; verify the cancel column in `016_events.sql`) |
| activeStaff | `admin_users` | `is_active = true` |
- Column names were read from migrations 005, 014, 016, 019, 020, 024 and 018; the events cancel column and the conversation creation column are to be confirmed when writing the queries.
- **Decision**: one query per figure, run in parallel, each with `count(*)` and an indexed predicate (the marketplace and members tables already index by state). A failed figure is `null`, shown as unavailable.
- **Rejected**: a materialised view or stored counters (nothing in the spec needs them, and stored counts drift: 010 computes counts on read for that reason).

## R7. Who may read the numbers
The route posture vocabulary (`11-rbac.ts` `validateAuthConfig`) has `anyStaff` or `module + flag`; there is no "superadmin only".
- **Decision**: declare module `admins`, flag `read`, then refuse non-superadmins in the handler with `CANNOT_MANAGE_ADMIN`. A superadmin bypasses the module check, a plain staff with `admins.read` passes the posture and fails the handler check. The matrix test gets a row.
- **Rejected**: a new `superadminOnly` posture flag (a new gate class and a change to the posture tests for one route).

## R8. Client
- `AdminDashboard.tsx` reads `snapshot.isSuperadmin`; when true it renders the figures (a new `useFigures` load with the console's `console.error('AdminDashboard.load', …)` convention and a load-failed callout) and omits the granted-areas tiles and list; otherwise unchanged.
- `Roles.tsx` follows the pattern of `Push.tsx`/`Referrals.tsx` (`RequireGrant admins/read`). A native `<table>` or card list; per row: role badge, active state, a grants grid of five flag checkboxes per area (only areas with a grant or being edited), and controls with `disabled` + `title`/accessible description from the reason code. Explicit save per account with the `version` token; a 409 reloads that row.
- Strings: `t.adminRoles.*`, `t.adminDashboard.figures.*`, blocker tooltips keyed by the reason code, both catalogues; `npm run -w client test:i18n` must pass.
- Tooltips on disabled controls: disabled buttons do not fire pointer events in every browser, so the reason is attached to a wrapper (`span title` + `aria-describedby` text), not to the disabled element itself.

## Findings during implementation (2026-11-17)

- **R5 was incomplete.** The 006 trigger cannot stop two superadmins demoting each other: under READ COMMITTED each sees the other still in place. `update.ts` takes `pg_advisory_xact_lock` first and re-reads the caller inside the transaction; `tests/admins/update.test.ts` runs the race and asserts exactly one success.
- **Permissions are cached.** `createPermissionResolver` caches each account's snapshot for 30 s and needs `invalidate(adminId)` on every write; the test for "takes effect on the next request" failed until `update.ts` did that after commit.
- **Escalation hole closed.** `guardAdminTarget` only inspects the target's current state, so a staff member with `admins.edit` could promote themselves or grant themselves everything. `constraintsFor` blocks role changes for non-superadmins and own-grant edits (`self`).
- **Reason order.** `last-superadmin` is checked before `self`; otherwise the only superadmin's own row would always say "self" and the "at least one must remain" tooltip would be unreachable.
- **Audit allowlist.** `ops/audit.ts` strips unknown `detail` keys; `adminChange` was added, and `auditInTransaction` shares the writer's INSERT.

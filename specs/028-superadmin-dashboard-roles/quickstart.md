# Quickstart: validating the superadmin dashboard and Roles & permissions

Prerequisites: a **throwaway local Postgres** (never the URL in `server/.env`; see specs/027 T002 for the container command and for pre-marking `delete-member.sql` as applied), `DATABASE_URL` set explicitly on every command, `npm run -w server migrate`, `npm run -w server seed:demo` (development only). Seed staff and passwords come from the seed's credentials table.

1. **Figures.** Sign in as a superadmin, open Admin Panel: nine figures, no "granted areas" tiles or list. Compare each with the SQL in research.md R6 against the same database. (US1, SC-001)
2. **Plain staff.** Sign in as a non-superadmin staff member: the old dashboard; `GET /admin/dashboard/figures` returns 403. (US1.4, SC-006)
3. **One figure down.** In `gwc_test`, rename a table the `openReports` figure reads (inside a transaction in a test, not by hand on a shared DB): that figure is unavailable, the other eight still show, none shows 0. (FR-004)
4. **List.** As a superadmin open Roles & permissions (no longer "Not available yet" in the sidebar or on the dashboard for this role): every staff account with role, state and grants; inspect the response for `password`/`hash`: absent. (US2, SC-002)
5. **Grant change.** Give a staff account `read` + `status` on Events; as that account, the next request to an Events route succeeds only for those flags. Audit entry present. (US3.1, SC-003, SC-007)
6. **Disabled with a reason.** With one superadmin only, their demote and deactivate controls are disabled with the "at least one active superadmin" tooltip; your own row's controls carry the "cannot change yourself" tooltip. Force `PATCH` anyway: 409 `LAST_SUPERADMIN` / 403 `CANNOT_CHANGE_SELF`. (US3.2–3.3, SC-004, SC-005)
7. **Race.** Two superadmins; each demotes the other at the same instant: exactly one succeeds, an active superadmin remains. (FR-012)
8. **Stale.** Open an account in two tabs, change it in one, save in the other: 409 `CONFLICT`, the row reloads. (FR-012)
9. **Non-superadmin with the grant.** A staff account holding all five flags on Roles & permissions cannot see or edit administrators. (US2.3, SC-006)
10. `npm run -w server test` (SQL suites), `npm test -w client`, `tsc --noEmit` in contracts/client/expo, `npm run -w client test:i18n`.

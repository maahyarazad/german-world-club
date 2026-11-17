---
description: "Tasks for 029: the web console renews its session from the refresh cookie"
---

# Tasks: Web console session refresh

**Input**: owner request: "implement the missing using of refresh token in the web console". Written after the code was read; not run through `/speckit-specify`.
**Branch**: worked on `028-superadmin-dashboard-roles` (uncommitted); move to its own branch before committing.

- [X] T001 Read `client/src/lib/api.ts` `request()` and `upload()`, the server's `/auth/refresh` (cookie in, cookies out, body `{}` valid) and which 401 an expired token produces (`unauthenticated`; a revoked session is `session-revoked`).
- [X] T002 `ACCESS_TOKEN_TTL_SECONDS` 600 → 86 400 in `packages/contracts/src/auth.ts`, and derive `DENYLIST_TTL_SECONDS` from it in `server/src/modules/auth/sessions.ts` (it was a second hard-coded 600); fix the "ten minutes" comments.
- [X] T003 `server/tests/auth/denylist-ttl.test.ts`: the denylist lifetime equals the token lifetime and an entry holds for all of it and not past it.
- [X] T004 `client/src/lib/api.ts`: `refreshSession()` with one in-flight refresh, Web Locks across tabs, a `gwc.refreshedAt` skip window, only for 401 `unauthenticated`; wired into `request()` (one retry, `noRefresh` for the refresh call itself) and `upload()`.
- [X] T005 `client/tests/lib/api-refresh.test.ts` (14 cases): renew + retry; four simultaneous requests share one refresh; lock used; skip when another tab just renewed (and not when it did long ago); revoked session, wrong password and 403 are never refreshed; failed refresh surfaces the original 401 with no loop; renewed token refused again does not loop; network failure; upload renews and re-sends.
- [X] T006 `CLAUDE.md` paragraph.
- [X] T007 Verification: client 500/500 and `tsc` clean; server auth/authz/onboarding/devices/admins/admin-dashboard/push 606/606 on a throwaway Postgres (removed). Not done: a browser check of a real expiry (set `ACCESS_TOKEN_TTL_SECONDS` to a few seconds locally and watch one `POST /auth/refresh` in the network tab).

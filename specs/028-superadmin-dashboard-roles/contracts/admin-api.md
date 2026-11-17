# Contract: admin dashboard figures and administrators

Types and schemas go in `packages/contracts/src/admin.ts` (new `"./admin"` export); no client declares its own. All routes: `config.auth = { audience: 'staff', module: 'admins', flag: … }`, `private, no-store`, under `/admin` (already a gated, never-indexed surface in `seo/surfaces.ts`).

## GET /admin/dashboard/figures
Posture: module `admins`, flag `read`, budget `admin-read`. **Handler refuses a caller who is not a superadmin** with 403 `CANNOT_MANAGE_ADMIN` (D6).

200
```json
{ "asOf": "ISO",
  "figures": [
    { "key": "activeMembers", "value": 1240 },
    { "key": "waitingApplications", "value": 7 },
    { "key": "activeMerchants", "value": 31 },
    { "key": "activePartners", "value": 12 },
    { "key": "liveListings", "value": 214 },
    { "key": "listingRequests", "value": 58 },
    { "key": "openReports", "value": null },
    { "key": "upcomingEvents", "value": 4 },
    { "key": "activeStaff", "value": 9 } ] }
```
`value: null` means that one figure could not be computed. Keys are the `DASHBOARD_FIGURES` constant; the response always contains every key, in that order.

## GET /admin/admins
Posture: module `admins`, flag `read`, budget `admin-read`. A caller who is not a superadmin receives only accounts that are neither administrators nor superadmins (the same rule that refuses their edits), so the list never shows what they could not manage.

200
```json
{ "admins": [
  { "id": "uuid", "email": "a@b", "displayName": "Name|null",
    "role": "superadmin|administrator|staff", "isActive": true,
    "version": "ISO", "current": false,
    "grants": { "members": { "read": true, "write": false, "edit": false, "delete": false, "status": true } },
    "constraints": {
      "changeRole":  { "allowed": false, "reason": "last-superadmin" },
      "setActive":   { "allowed": false, "reason": "self" },
      "editGrants":  { "allowed": true } } } ] }
```
- `grants` contains only areas where at least one flag is true (absence is denial).
- Never returned: `password_hash`, `created_by`, sessions, tokens.
- `current` is true for the caller's own row.

## PATCH /admin/admins/:id
Posture: module `admins`, flag `edit`, budget `admin-write`.

Request
```json
{ "version": "ISO",
  "role": "superadmin|administrator|staff",       // optional
  "isActive": true,                                 // optional
  "grants": { "events": { "read": true, "write": false, "edit": false, "delete": false, "status": false } } }  // optional; per area the full five flags
```
At least one of `role`, `isActive`, `grants` is required. `grants` replaces the five flags of each named area; an area with all five false is removed.

200: the updated account in the same shape as a list entry (new `version`).

Refusals (problem+json, branch on `type`):
- 403 `CANNOT_MANAGE_ADMIN` — caller is not a superadmin and the target is an administrator or superadmin.
- 403 `CANNOT_CHANGE_SELF` — the change would demote or deactivate the caller.
- 409 `LAST_SUPERADMIN` — the change would leave no active superadmin (checked in the handler, and by the database trigger on a race).
- 409 `CONFLICT` — `version` does not match; the client reloads the row.
- 404 `NOT_FOUND` — unknown id (same body whatever the reason).
- 422 validation — unknown area, a flag not boolean, empty change.

Every success writes one audit entry `admin_updated` with `detail.before/after` of the fields that changed.

## Errors added to `@gwc/contracts/errors`
`LAST_SUPERADMIN` (409, `…/last-superadmin`), `CANNOT_CHANGE_SELF` (403, `…/cannot-change-self`); the console registers descriptions for both in `client/src/lib/problems.ts`.

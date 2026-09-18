# Contract: Capability API

**Feature**: 003-web-console

How a client learns what to display, and why that is never how it learns what is allowed.

## The defect this contract fixes

A staff member holding `seo.read` and nothing else currently cannot obtain their own capability
set (research R3). `/auth/me` is declared `{ audience: 'member' }` and an admin token fails its
audience check at verification; `/auth/staff/me` is declared
`{ audience: 'staff', module: 'settings', flag: 'read' }`. Both are refused. The console can render
nothing for them.

## `GET /auth/session`

**Posture**: `{ audience: 'staff', anyStaff: true }` — reachable by any authenticated staff
principal, whatever they hold.

**Rationale**: knowing what you may do is not a privilege on the settings module. Reading how the
system is configured is; those are different things.

### This posture does not exist yet

`validateAuthConfig` (`server/src/plugins/11-rbac.js:41-48`) requires every staff route to declare
both a known module and a known flag, so `{ audience: 'staff' }` alone **fails startup**. That is
the gate working correctly, and the fix is not to stop it working.

The gate gains one branch: a staff route may omit module and flag **only** when it declares
`anyStaff: true`. Silence still fails the build; the exemption is an affirmative act visible in a
diff, which is the same shape Principle II already requires for making a route public. The branch
carries its own new failure mode — `anyStaff` together with a module or flag is a declaration
error, because it would leave two postures on one route with no way to tell which governs.

Enforcement stays where it is: `app.guard` authenticates the staff audience; there is simply no
module lookup to perform.

`/auth/staff/me` keeps its `settings.read` posture verbatim. It is the staff *profile* route and
the existing authz matrix asserts its posture; this contract adds a route rather than weakening
one.

### Response

```jsonc
{
  "kind": "staff",
  "id": "uuid",
  "displayName": "string|null",
  "isSuperadmin": false,
  "modules": {
    "seo":  { "read": true, "write": false, "edit": true, "delete": false, "status": false },
    "pages": { "read": true, "write": false, "edit": false, "delete": false, "status": false }
  },
  "available": ["seo", "settings", "mass_messages"]
}
```

- `modules` contains **only modules where at least one flag is true.** Absence is denial, so
  shipping nineteen all-false objects would be noise that says nothing.
- `available` is the list of modules that have a working server surface *today*. It is what lets
  the console satisfy SC-001 — mark a module the principal holds a grant on but that has no API as
  "noch nicht verfügbar" — without hard-coding a list in the client that would drift from the
  server as modules land.
- `no-store`, always. It is per-principal and stale is wrong.

### Variants by principal kind

| Kind | Route | Body |
|---|---|---|
| member | `GET /auth/me` (exists) | `kind: "member"`, member permission flags, tier, entitlement |
| staff | `GET /auth/session` (new) | as above |
| merchant | `GET /auth/session` | `kind: "merchant"`, `organisationId`, `role`, organisation status |
| partner | `GET /auth/session` | `kind: "partner"`, `organisationId`, `role`, organisation status |

One route serves staff, merchant and partner; the handler branches on the verified token audience,
never on anything the client sent.

## Rules

1. **Display only.** A client may use this to decide what to render. It may not use it to decide
   what is permitted. Every operation is re-checked server-side (FR-004, Principle I).
2. **Resolved per request.** The snapshot comes from `app.permissions.resolve()` against live
   state, never from token claims, so a revoked grant takes effect on the next request
   (Principle II).
3. **Re-fetched after any 403.** A refusal means the client's copy is stale. The console re-fetches
   and re-renders rather than showing a broken screen (FR-016, SC-003).
4. **Never cached across principals.** `no-store`, and cleared on sign-out.
5. **A capability is not a route.** The console maps modules to screens; the server never tells the
   client what URL to visit, so a compromised response cannot redirect a staff member anywhere.

## Refusals

RFC 9457 problem+json throughout. Clients branch on `type`, never on `detail` (FR-018).

| Situation | Status | Meaning for the console |
|---|---|---|
| No credential | 403 `UNAUTHENTICATED` | Go to sign-in. |
| Wrong audience for the route | 403 `INSUFFICIENT_PERMISSION` | This credential is not for this interface. Do not re-authenticate; it cannot help. |
| Valid credential, missing grant | 403 `INSUFFICIENT_PERMISSION` | Re-fetch capabilities, re-render navigation, show the refusal. |
| Session revoked elsewhere | 403 `SESSION_REVOKED` | At most one session per account is active. Return to sign-in, preserve unsaved input. |
| Account not `active` | 403 `ACCOUNT_LOCKED` / `ACCOUNT_INACTIVE` / `MEMBERSHIP_ENDED` | Show the server's remedy. Do not invent one. |
| Rate limited | 429 | Retryable. Show when. |
| Business quota | 4xx quota problem | **Not** retryable. Do not offer a retry that cannot succeed (FR-019). |
| Deadline exceeded | 503 | Retryable. Distinguish from a validation failure. |

The 401/403 distinction is already settled by `contracts/http-conventions.md` in feature 002 and is
not re-litigated here: a valid credential that is simply not for this audience is 403, because 401
would invite a re-authentication that cannot help.

## Non-enumeration

An authorization refusal must not reveal whether the resource exists (FR-007). The console must not
distinguish "no such record" from "not yours" in anything it renders, because the server does not
distinguish them in what it sends.

## Client contract

`packages/contracts` gains the capability response schema, so the console and the server import the
same object. A module renamed on the server becomes a type error in the client rather than an empty
sidebar in production (Principle I).

The console's navigation is **derived** from the capability set on every render. It is never stored,
never merged with a local default, and never falls back to a hard-coded list when the fetch fails —
a failed capability fetch renders an error state, not a guess.

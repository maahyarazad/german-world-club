# Contract: RBAC Model

**Feature**: `002-server-platform` | **Source**: `BUSINESS_DESCRIPTION.md` §11, §12.9, §3.2, §6.1

§11 is explicit that the five-flag matrix "should be preserved as-is" and is "finer-grained than a typical single role system". This contract is that model, plus the two enforcement layers it requires and the startup gate that keeps it honest.

---

## 1. Principals

| Kind | Audience | Reaches |
|---|---|---|
| Anonymous | — | Public surfaces only |
| Member | `member` | Public + member-authenticated |
| Department admin (`is_admin`) | `admin` | Public + staff routes where the module flag is granted |
| Superadmin (`is_superadmin`) | `admin` | Everything; module checks bypassed (FR-008) |

Audience separation is structural: a member's token fails `aud` verification on a staff route before any handler runs (FR-003). This is not a check that can be forgotten per route.

---

## 2. Route posture declaration

Every route declares its posture in `config.auth`. There are exactly four shapes:

```js
{ auth: { audience: 'public' } }                                   // §10.1 public surface
{ auth: { audience: 'member' } }                                   // any active, confirmed member
{ auth: { audience: 'member', requires: 'marketplace_post' } }     // + a per-member permission flag
{ auth: { audience: 'staff', module: 'members', flag: 'edit' } }   // five-flag matrix
```

**Silence is a startup failure.** An `onRoute` hook records every registered route; an `onReady` hook throws, naming each offending method and path, if any route declared no posture:

```
FATAL: 2 route(s) registered without an access posture:
  POST   /admin/partners/:id/contract
  GET    /admin/exports/members.csv
Declare config.auth — use { audience: 'public' } for a deliberately public route.
```

This is §10.1's "silence is not an acceptable default in either direction" applied to authorization. It converts the most common authorization defect — a route added under time pressure that nobody remembers to guard — from a review-checklist item into an un-mergeable build failure, and it is the whole implementation of SC-001.

Making a route public is an affirmative act that shows up in a diff.

---

## 3. Modules and flags

The five flags, per §11:

| Flag | Meaning |
|---|---|
| `read` | View records in the module |
| `write` | Create new records |
| `edit` | Modify existing records |
| `delete` | Remove records |
| `status` | Enable / disable / lock records |

Modules: `members`, `invitations`, `events`, `event_registrations`, `partners`, `partner_contracts`, `membership_orders`, `committees`, `threads_moderation`, `marketplace_moderation`, `support_tickets`, `newsletters`, `mass_messages`, `magazine`, `pages`, `seo`, `admins`, `settings`, `jobs`.

Exported from `packages/contracts/src/permissions.js` so the admin console renders its permission editor from the same list the server enforces — a module cannot exist in the UI but not the server, or vice versa.

`seo` is a first-class module, which is how §10.8 gets satisfied: staff-editable SEO fields are grantable under the same five flags as any other content attribute, so adjusting how a paying partner's page presents in search needs no engineering involvement.

---

## 4. Layer 1 — module capability

```js
async function requirePermission(request, reply) {
  const { module, flag } = request.routeOptions.config.auth
  const snapshot = await resolvePermissions(request.principal.id)   // 30s cache, invalidated on write

  if (!snapshot.isActive)      throw forbidden('account-inactive')
  if (snapshot.isSuperadmin)   return                                // FR-008
  if (!snapshot.modules[module]?.[flag]) {
    await audit({ action: 'permission_denied', requiredPermission: `${module}.${flag}` })
    throw forbidden('insufficient-permission')
  }
}
```

Resolution reads **server-held state**, never token claims (FR-006). The 30 s cache is invalidated explicitly on any write to `admin_permissions` or to an account's `is_active` / `is_admin` / `is_superadmin`, so SC-003 — a revoked permission refused on the target's very next request — holds by mechanism rather than by waiting out a TTL.

An absent module row resolves to all-false. Absence is denial, never inheritance.

---

## 5. Layer 2 — object guards

Some rules depend on the **target** of the operation, not on the caller's flags. No route declaration can express them, and collapsing them into Layer 1 is how they get lost.

### The load-bearing one — FR-009 (§11)

> "Lower-privileged staff can never edit or remove admin/superadmin accounts or their permissions; only a superadmin can manage other admins."

```js
async function guardAdminTarget(actor, targetAdmin) {
  if (actor.isSuperadmin) return
  if (targetAdmin.is_admin || targetAdmin.is_superadmin) {
    await audit({ action: 'permission_denied',
                  requiredPermission: 'superadmin',
                  targetId: targetAdmin.id })
    throw forbidden('cannot-manage-admin')
  }
}
```

Called **inside the handler's transaction**, after the target row is loaded and before any mutation — so a concurrent promotion of the target cannot slip between the check and the write.

Why this cannot be Layer 1: a route declaring `{ module: 'admins', flag: 'edit' }` looks correctly guarded to a reviewer reading route declarations. The escalation path — a department admin with `admins.edit` granting themselves superadmin — is invisible at that level and only closes at the object.

### Other object guards

| Guard | Rule | Source |
|---|---|---|
| Self-demotion | No admin may remove their own `is_superadmin`, and the last active superadmin cannot be deactivated | §11 recoverability |
| Member soft-delete | "End membership" is a status transition; row deletion is refused | §12.4, §3.2 |
| Member-owned content | A member may edit or delete only their own marketplace listing or thread post; staff need the module flag | §7 |
| SEO field edit | Requires the flag on **both** `seo` and the underlying record's module | §10.8 |
| Contract-gated visibility | A partner listing is served as active only while in contract | §5, §10.5 |

---

## 6. Member-side gates

Members have no five-flag matrix. Their access is gated by state and by per-member flags:

| Gate | Condition | Failure |
|---|---|---|
| Status | `status = 'active'` | 403 with the §3.2 remedy |
| Email confirmed | `email_confirmed_at IS NOT NULL` | 403 `profile-incomplete` (FR-011) |
| Device approved (mobile) | `device_approvals(member_id, device_id).state = 'approved'` | 403 `approval-pending` (§6.1) |
| Marketplace posting | per-member permission flag + accepted terms | 403 `permission-required` (§7) |
| Thread moderation | staff-assigned, global — Threads has no categories | 403 |

**Entitlement is not a gate.** A membership package never grants or denies *access*; it changes *price* (§12.2). It is resolved at checkout from the card's validity window, never from a token or a cached column — a card that lapses between sign-in and checkout must not still discount.

---

## 7. Test contract

| Suite | Asserts | Criterion |
|---|---|---|
| `route-posture.test.js` | Startup throws when a route declares no posture; the message names it | SC-001 |
| `matrix.test.js` | Every route class × every principal kind; permitted set matches the declared matrix exactly | SC-002 |
| `object-guards.test.js` | Department admin with full `admins` flags cannot edit an admin or superadmin | FR-009 |
| `revocation.test.js` | Permission revoked → refused on the very next request, no re-login | SC-003 |
| `audience.test.js` | Member token on a staff route fails at verification, not in a handler | FR-003 |
| `claims.test.js` | Access token claim keys are exactly the documented set | FR-006, FR-013 |

`matrix.test.js` is written as a **data table**, one row per route class. Adding a route without adding a row leaves a route untested, which the posture gate and a coverage assertion both catch — the same deny-by-default discipline, applied to the tests.

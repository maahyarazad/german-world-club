# Data Model: Superadmin dashboard and Roles & permissions

**No migration and no new table.** Everything below is an existing row, or a response shape.

## Existing rows used

### `admin_users` (006)
| Column | Use here |
|---|---|
| id, email, display_name | listed (email is shown, nothing else identifying) |
| is_admin, is_superadmin | derive the role: `superadmin` if `is_superadmin`; else `administrator` if `is_admin`; else `staff` |
| is_active | shown; changed by PATCH |
| created_at, updated_at | `updated_at` is the **version token** for optimistic concurrency |
| password_hash, created_by | never selected |

Rules in the database: trigger `admin_users_superadmin_guard` refuses to demote, deactivate or delete the last active superadmin (SQLSTATE P0001). It also stamps `updated_at` on every UPDATE.

### `admin_permissions` (006)
`(admin_user_id, module)` primary key, five booleans `can_read, can_write, can_edit, can_delete, can_status`. Absence of a row is denial. `module` is the `admin_module` enum, so an area that is not in `MODULES` cannot be stored.

## Derived (not stored)

- **Role**: `superadmin | administrator | staff` from the two booleans (D1).
- **Constraint**: per account, for each of three actions (`changeRole`, `setActive`, `editGrants`) either `{ allowed: true }` or `{ allowed: false, reason }` with `reason ∈ {self, last-superadmin, superadmin-required}`.
  - `self`: the target is the caller and the action would demote or deactivate them.
  - `last-superadmin`: the target is the only active superadmin and the action would demote or deactivate them.
  - `superadmin-required`: the target is an administrator or superadmin and the caller is not a superadmin (the `guardAdminTarget` rule).
- **Dashboard figure**: `{ key, value: number | null }`; `null` means unavailable.

## Write rules (PATCH)

1. Load the target with `SELECT … FROM admin_users WHERE id = $1 FOR UPDATE` inside one transaction.
2. Version token must equal `updated_at`; else `CONFLICT`.
3. Run `guardAdminTarget`, `guardSelfDemotion`, `guardLastSuperadmin` against the loaded row and the requested changes, in that order.
4. Apply: `UPDATE admin_users` (role/active) and, for grants, upsert each changed `(admin, module)` row, delete a row when all five flags become false (so absence stays denial and the page and the resolver agree), always bump `admin_users.updated_at`.
5. A P0001 from the trigger (a race the checks could not see) is mapped to `LAST_SUPERADMIN`.
6. Audit entry in the same transaction: action `admin_updated`, actor, target, `detail = { before, after }` limited to the fields that changed.

## State transitions

- Role: staff ↔ administrator ↔ superadmin, by the booleans; demotion from superadmin is the only guarded one.
- Active: active ↔ inactive; deactivating a superadmin is guarded like demotion. An inactive account's next request is refused by authentication (existing behaviour) and its sessions are not deleted.

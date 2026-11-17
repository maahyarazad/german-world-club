import type { AdminAction, AdminRole, ChangeBlocker, ChangeConstraint } from '@gwc/contracts/admin'

/**
 * Which changes to an administrator account are allowed, and why not (feature
 * 028, data-model.md "Derived").
 *
 * ONE function, used twice: to build the list the console renders (a disabled
 * control and its tooltip) and to refuse a PATCH. If the page and the refusal
 * were computed separately they would drift, and the page would enable a
 * control the server then refused. It is pure so every row of the table below
 * is a unit test.
 *
 * The rules, in the order they are checked:
 *   1. `superadmin-required` — the caller is not a superadmin and the target is
 *      an administrator or superadmin (§11, `guardAdminTarget`); and, for ROLE
 *      changes, any non-superadmin caller at all, because promoting someone —
 *      oneself included — is a superadmin act.
 *   2. `last-superadmin` — demoting or deactivating the only active superadmin
 *      (the database trigger in migration 006, checked first so the answer is a
 *      reason rather than an exception). It outranks `self`: when the caller IS
 *      the only superadmin, "at least one must remain" is the useful thing to
 *      say, and `self` is then reserved for a caller with other superadmins.
 *   3. `self` — a change that could lock the caller out (demoting or
 *      deactivating themselves: `guardSelfDemotion`), and a non-superadmin
 *      editing their own grants, which would be an escalation: `admins.edit`
 *      would otherwise be "grant yourself everything" in one step.
 */
export type ConstraintActor = { adminId: string; isSuperadmin: boolean }
export type ConstraintTarget = { id: string; isAdmin: boolean; isSuperadmin: boolean; isActive: boolean }

const blocked = (reason: ChangeBlocker): ChangeConstraint => ({ allowed: false, reason })
const ALLOWED: ChangeConstraint = { allowed: true }

export function roleOf({ isAdmin, isSuperadmin }: { isAdmin: boolean; isSuperadmin: boolean }): AdminRole {
  if (isSuperadmin) return 'superadmin'
  return isAdmin ? 'administrator' : 'staff'
}

export function constraintsFor(
  { actor, target, activeSuperadmins }: { actor: ConstraintActor; target: ConstraintTarget; activeSuperadmins: number },
): Record<AdminAction, ChangeConstraint> {
  const isSelf = actor.adminId === target.id
  const notManageable = !actor.isSuperadmin && (target.isAdmin || target.isSuperadmin)
  const lastSuperadmin = target.isSuperadmin && target.isActive && activeSuperadmins <= 1

  const changeRole = (): ChangeConstraint => {
    if (!actor.isSuperadmin) return blocked('superadmin-required')
    if (lastSuperadmin) return blocked('last-superadmin')
    if (target.isSuperadmin && isSelf) return blocked('self')
    return ALLOWED
  }

  const setActive = (): ChangeConstraint => {
    if (notManageable) return blocked('superadmin-required')
    if (lastSuperadmin) return blocked('last-superadmin')
    if (isSelf) return blocked('self')
    return ALLOWED
  }

  const editGrants = (): ChangeConstraint => {
    if (notManageable) return blocked('superadmin-required')
    if (isSelf && !actor.isSuperadmin) return blocked('self')
    return ALLOWED
  }

  return { changeRole: changeRole(), setActive: setActive(), editGrants: editGrants() }
}

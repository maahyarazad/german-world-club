import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden } from './require-permission.js'
import { permits } from './permissions.js'

/**
 * Layer 2 — object guards (rbac-model.md §5).
 *
 * These rules depend on the **target** of an operation, not on the caller's
 * flags. No route declaration can express them, which is exactly why they need
 * their own file and their own tests: a route declaring
 * `{ module: 'admins', flag: 'edit' }` looks correctly guarded to a reviewer
 * reading route declarations, and the escalation path is invisible at that
 * level.
 *
 * Every guard runs **inside the handler's transaction**, after the target row
 * is loaded with `FOR UPDATE` and before any mutation — so a concurrent
 * promotion of the target cannot slip between the check and the write.
 */

/**
 * FR-009, the load-bearing one (§11):
 *
 * > "Lower-privileged staff can never edit or remove admin/superadmin accounts
 * > or their permissions; only a superadmin can manage other admins."
 *
 * Note what it does *not* consult: the actor's flags on the `admins` module. A
 * department admin holding all five is still refused. That is the whole point —
 * otherwise `admins.edit` is a grant of superadmin by two steps.
 */
export async function guardAdminTarget(app, request, actorSnapshot, targetAdmin) {
  if (actorSnapshot?.isSuperadmin) return
  if (!targetAdmin) return
  if (targetAdmin.is_admin || targetAdmin.is_superadmin) {
    await app.auditDenial(request, {
      requiredPermission: 'superadmin',
      targetType: 'admin_user',
      targetId: targetAdmin.id,
    })
    throw forbidden(PROBLEMS.CANNOT_MANAGE_ADMIN, 'Only a superadmin may manage another administrator.')
  }
}

/**
 * §11 recoverability. An admin may not remove their own superadmin status: the
 * plausible reasons are a mistake and a compromised session, and neither is
 * worth the risk of locking the system out of its own administration.
 */
export async function guardSelfDemotion(app, request, actorSnapshot, target, changes) {
  const isSelf = actorSnapshot?.adminId === target?.id
  if (!isSelf) return
  const removingSuperadmin = changes?.is_superadmin === false && target.is_superadmin
  const deactivatingSelf = changes?.is_active === false && target.is_active
  if (removingSuperadmin || deactivatingSelf) {
    await app.auditDenial(request, { requiredPermission: 'superadmin', targetType: 'admin_user', targetId: target.id })
    throw forbidden(PROBLEMS.CANNOT_MANAGE_ADMIN, 'An administrator cannot demote or deactivate their own account.')
  }
}

/**
 * The last active superadmin cannot be demoted or deactivated.
 *
 * The database enforces this too, with a trigger. Checking here as well is not
 * redundancy for its own sake: the trigger produces a raw SQL error, and this
 * produces the documented problem+json a client can act on.
 */
export async function guardLastSuperadmin(client, target, changes) {
  const losingSuperadmin = changes?.is_superadmin === false || changes?.is_active === false
  if (!losingSuperadmin || !target?.is_superadmin || !target?.is_active) return

  const { rows } = await client.query(
    `SELECT count(*)::int AS remaining FROM admin_users
      WHERE is_superadmin = true AND is_active = true AND id <> $1`,
    [target.id],
  )
  if (rows[0].remaining === 0) {
    throw forbidden(
      PROBLEMS.CANNOT_MANAGE_ADMIN,
      'At least one active superadmin must remain — a system with none cannot grant permissions to anyone.',
    )
  }
}

/**
 * §12.4 / §3.2: "Full deletion of a member is deliberately not allowed."
 * Ending a membership is a status transition. The database refuses the delete
 * as well; this turns it into an actionable answer rather than a 500.
 */
export function guardMemberDeletion() {
  throw forbidden(
    PROBLEMS.CONFLICT,
    'Members are never deleted. End the membership with a status change instead.',
  )
}

/**
 * §7: a member may edit or delete only their own marketplace listing or thread
 * post. Staff need the module flag instead — the two paths are separate, and
 * ownership never substitutes for a staff grant or the reverse.
 */
export async function guardOwnedContent(app, request, { ownerId, ownerKind = 'member' }) {
  const principal = request.principal
  if (principal?.kind === 'admin') return // staff reach this only through Layer 1
  if (principal?.id === ownerId && principal?.kind === ownerKind) return
  await app.auditDenial(request, { requiredPermission: 'ownership', targetId: ownerId })
  throw forbidden(PROBLEMS.INSUFFICIENT_PERMISSION, 'This content belongs to another member.')
}

/**
 * §10.8: editing a record's SEO fields requires the flag on **both** `seo` and
 * the record's own module. SEO editing is a grantable privilege, but it is not
 * a way around the permissions on the content itself — otherwise `seo.edit`
 * would be edit access to every title on the site.
 */
export function seoModulesFor(recordType) {
  return {
    seo: 'seo',
    record: {
      partner: 'partners', outlet: 'partners', event: 'events',
      article: 'magazine', committee: 'committees', page: 'pages',
    }[recordType] ?? 'pages',
  }
}

export async function guardSeoEdit(app, request, snapshot, recordType, flag = 'edit') {
  const modules = seoModulesFor(recordType)
  if (snapshot?.isSuperadmin) return

  for (const module of [modules.seo, modules.record]) {
    if (!permits(snapshot, module, flag)) {
      await app.auditDenial(request, { requiredPermission: `${module}.${flag}` })
      throw forbidden(PROBLEMS.INSUFFICIENT_PERMISSION, `Requires '${flag}' on module '${module}'.`)
    }
  }
}

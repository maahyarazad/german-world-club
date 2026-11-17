import { FLAGS } from '@gwc/contracts/permissions'
import type { Flag, Module } from '@gwc/contracts/permissions'
import { PROBLEMS } from '@gwc/contracts/errors'
import type { AdminAccount, AdminRole, UpdateAdminRequest } from '@gwc/contracts/admin'
import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { guardAdminTarget, guardSelfDemotion, guardLastSuperadmin } from '../../../authz/object-guards.ts'
import { auditInTransaction } from '../../../ops/audit.ts'
import { ACCOUNT_COLUMNS, buildAccount, countActiveSuperadmins, loadGrants } from './list.ts'
import type { AccountRow, GrantRow } from './list.ts'
import { constraintsFor, roleOf } from './constraints.ts'
import type { ConstraintActor } from './constraints.ts'
import type { PoolClient } from 'pg'
import type { FastifyRequest } from 'fastify'
import type { GwcApp } from '../../../app.ts'

/**
 * Change an administrator account (feature 028, US3, data-model.md "Write rules").
 *
 * Everything that decides the outcome happens inside ONE transaction:
 *
 *   1. A transaction-level advisory lock, taken before anything is read. The
 *      database trigger (006) refuses to remove the last active superadmin, but
 *      under READ COMMITTED two superadmins demoting each other each see the
 *      other still in place, both pass the trigger, and both commit — leaving
 *      none. Serialising these updates makes the second one see the first's
 *      result and be refused. Administrator edits are rare, so one lock is the
 *      simplest thing that is correct.
 *   2. The CALLER is re-read from the database: the permission snapshot is from
 *      the start of the request, and a superadmin demoted a moment ago must not
 *      get to finish promoting someone.
 *   3. The target is loaded `FOR UPDATE`, its `version` compared, then the rules
 *      from `constraints.ts` — the same function that built the list the page
 *      rendered, so the refusal and the disabled control cannot disagree.
 *   4. The audit entry is written in the same transaction as the change.
 */
const ROLE_FLAGS: Record<AdminRole, { is_admin: boolean; is_superadmin: boolean }> = {
  superadmin: { is_admin: true, is_superadmin: true },
  administrator: { is_admin: true, is_superadmin: false },
  staff: { is_admin: false, is_superadmin: false },
}

type Flags = Record<Flag, boolean>
const NO_FLAGS = Object.freeze(Object.fromEntries(FLAGS.map((f) => [f, false]))) as Flags
const anyFlag = (flags: Flags) => FLAGS.some((f) => flags[f])
const sameFlags = (a: Flags, b: Flags) => FLAGS.every((f) => a[f] === b[f])

const flagsOf = (g: GrantRow | undefined): Flags | null => g && ({
  read: g.can_read, write: g.can_write, edit: g.can_edit, delete: g.can_delete, status: g.can_status,
})

export async function updateAdmin(
  app: GwcApp,
  { actor, targetId, changes, request }: {
    actor: ConstraintActor; targetId: string; changes: UpdateAdminRequest; request: FastifyRequest
  },
): Promise<AdminAccount> {
  const account = await withTransaction(app.pg, async (client: PoolClient) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('gwc.admin_users.roles'))`)

    // (2) The caller, as the database has it now.
    const { rows: callerRows } = await client.query(
      'SELECT is_superadmin, is_active FROM admin_users WHERE id = $1', [actor.adminId])
    const caller = callerRows[0]
    if (!caller?.is_active) throw forbidden(PROBLEMS.CANNOT_MANAGE_ADMIN, 'This account is no longer active.')
    const liveActor: ConstraintActor = { adminId: actor.adminId, isSuperadmin: caller.is_superadmin === true }

    // (3) The target.
    const { rows } = await client.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM admin_users WHERE id = $1 FOR UPDATE`, [targetId])
    const target = rows[0]
    if (!target) throw forbidden(PROBLEMS.NOT_FOUND, 'No such account.')
    if (target.version !== changes.version) {
      throw forbidden(PROBLEMS.CONFLICT, 'This account was changed by someone else. Reload it and try again.')
    }

    const named = Object.keys(changes.grants ?? {}) as Module[]
    const existing = named.length
      ? (await client.query<GrantRow>(
        `SELECT admin_user_id, module, can_read, can_write, can_edit, can_delete, can_status
           FROM admin_permissions WHERE admin_user_id = $1 AND module = ANY($2::admin_module[])`,
        [targetId, named])).rows
      : []

    // What would actually change. A request that changes nothing is a quiet success.
    const role = roleOf({ isAdmin: target.is_admin, isSuperadmin: target.is_superadmin })
    const roleChange = changes.role !== undefined && changes.role !== role
    const activeChange = changes.isActive !== undefined && changes.isActive !== target.is_active
    const grantChanges = named.filter((module) => {
      const before = flagsOf(existing.find((g) => g.module === module)) ?? NO_FLAGS
      return !sameFlags(before, changes.grants![module] as Flags)
    })

    const activeSuperadmins = await countActiveSuperadmins(app)
    const target_ = { id: target.id, isAdmin: target.is_admin, isSuperadmin: target.is_superadmin, isActive: target.is_active }
    const verdict = constraintsFor({ actor: liveActor, target: target_, activeSuperadmins })

    const refuse = async (action: 'changeRole' | 'setActive' | 'editGrants') => {
      const v = verdict[action]
      if (v.allowed) return
      await app.auditDenial(request, { requiredPermission: 'superadmin', targetType: 'admin_user', targetId })
      if (v.reason === 'self') throw forbidden(PROBLEMS.CANNOT_CHANGE_SELF, 'You cannot change your own account this way.')
      if (v.reason === 'last-superadmin') {
        throw forbidden(PROBLEMS.LAST_SUPERADMIN, 'At least one active superadmin must remain.')
      }
      throw forbidden(PROBLEMS.CANNOT_MANAGE_ADMIN, 'Only a superadmin may make this change.')
    }
    if (roleChange) await refuse('changeRole')
    if (activeChange) await refuse('setActive')
    if (grantChanges.length > 0) await refuse('editGrants')

    // Defence in depth: the same rules as `constraints.ts`, from the guards that
    // existed first (rbac-model.md §5). They are no-ops when the above passed.
    const snapshot = { adminId: liveActor.adminId, isSuperadmin: liveActor.isSuperadmin }
    const raw = { id: target.id, is_admin: target.is_admin, is_superadmin: target.is_superadmin, is_active: target.is_active }
    const next = ROLE_FLAGS[changes.role ?? role]
    const nextActive = changes.isActive ?? target.is_active
    const columnChanges = { is_superadmin: next.is_superadmin, is_active: nextActive }
    await guardAdminTarget(app, request, snapshot, raw)
    await guardSelfDemotion(app, request, snapshot, raw, columnChanges)
    await guardLastSuperadmin(client, raw, columnChanges)

    if (!roleChange && !activeChange && grantChanges.length === 0) {
      return buildAccount(target, await loadGrants(app, [targetId]), { actor: liveActor, activeSuperadmins })
    }

    // Apply. The UPDATE runs even for a grants-only change: the 006 trigger stamps
    // `updated_at`, which is the account's version, so one token covers role,
    // state and grants alike.
    try {
      await client.query(
        'UPDATE admin_users SET is_admin = $2, is_superadmin = $3, is_active = $4 WHERE id = $1',
        [targetId, next.is_admin, next.is_superadmin, nextActive],
      )
    } catch (error) {
      // A race the checks above could not see: the trigger is the last line.
      if ((error as { code?: string }).code === 'P0001' && /last active superadmin/.test((error as Error).message)) {
        throw forbidden(PROBLEMS.LAST_SUPERADMIN, 'At least one active superadmin must remain.')
      }
      throw error
    }

    for (const module of grantChanges) {
      const flags = changes.grants![module] as Flags
      if (!anyFlag(flags)) {
        // Absence is denial: delete the row rather than leave five falses.
        await client.query('DELETE FROM admin_permissions WHERE admin_user_id = $1 AND module = $2', [targetId, module])
      } else {
        await client.query(
          `INSERT INTO admin_permissions (admin_user_id, module, can_read, can_write, can_edit, can_delete, can_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (admin_user_id, module) DO UPDATE
             SET can_read = EXCLUDED.can_read, can_write = EXCLUDED.can_write, can_edit = EXCLUDED.can_edit,
                 can_delete = EXCLUDED.can_delete, can_status = EXCLUDED.can_status, updated_at = now()`,
          [targetId, module, flags.read, flags.write, flags.edit, flags.delete, flags.status],
        )
      }
    }

    // (4) Only what changed, before and after.
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (roleChange) { before.role = role; after.role = changes.role }
    if (activeChange) { before.isActive = target.is_active; after.isActive = nextActive }
    if (grantChanges.length > 0) {
      before.grants = Object.fromEntries(grantChanges.map((m) => [m, flagsOf(existing.find((g) => g.module === m)) ?? null]))
      after.grants = Object.fromEntries(grantChanges.map((m) => {
        const flags = changes.grants![m] as Flags
        return [m, anyFlag(flags) ? flags : null]
      }))
    }
    await auditInTransaction(client, {
      action: 'admin_updated', outcome: 'allowed', requestId: request.id,
      actorId: actor.adminId, actorKind: 'admin', targetType: 'admin_user', targetId,
      detail: { adminChange: { before, after } },
    })

    const { rows: fresh } = await client.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM admin_users WHERE id = $1`, [targetId])
    const { rows: grants } = await client.query<GrantRow>(
      `SELECT admin_user_id, module, can_read, can_write, can_edit, can_delete, can_status
         FROM admin_permissions WHERE admin_user_id = $1`, [targetId])
    const remaining = (await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM admin_users WHERE is_superadmin = true AND is_active = true')).rows[0]!.n
    return buildAccount(fresh[0]!, grants, { actor: liveActor, activeSuperadmins: remaining })
  })

  // After the commit, never inside it: the resolver caches each account's
  // snapshot and its explicit invalidation — not the 30 s TTL — is what makes a
  // change bite on the account's very next request (SC-003, permissions.ts). An
  // invalidation inside the transaction could be undone by a read that raced the
  // commit and re-cached the old state. (Other server instances still wait out
  // the TTL; that is the resolver's existing, documented backstop.)
  app.permissions.invalidate(targetId)
  return account
}

import { FLAGS, MODULES } from '@gwc/contracts/permissions'
import type { Flag, Module } from '@gwc/contracts/permissions'
import type { AdminAccount, AdminListResponse } from '@gwc/contracts/admin'
import { query } from '../../../db/query.ts'
import { constraintsFor, roleOf } from './constraints.ts'
import type { ConstraintActor } from './constraints.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * The administrator list (feature 028, US2, contracts/admin-api.md).
 *
 * Columns are named, never `SELECT *`: this table holds `password_hash`, and a
 * column added to it later must not reach a client (constitution VI). The
 * `version` is the account's `updated_at` formatted by the DATABASE to the
 * microsecond — a JavaScript Date keeps milliseconds only, so two edits in the
 * same millisecond would look identical and a stale write would slip through.
 */
export const VERSION_SQL = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

export const ACCOUNT_COLUMNS = `id, email, display_name, is_admin, is_superadmin, is_active, ${VERSION_SQL} AS version`

export type AccountRow = {
  id: string; email: string; display_name: string | null
  is_admin: boolean; is_superadmin: boolean; is_active: boolean; version: string
}
export type GrantRow = {
  admin_user_id: string; module: Module
  can_read: boolean; can_write: boolean; can_edit: boolean; can_delete: boolean; can_status: boolean
}

const FLAG_COLUMN: Record<Flag, keyof GrantRow> = {
  read: 'can_read', write: 'can_write', edit: 'can_edit', delete: 'can_delete', status: 'can_status',
}

/** One account in the contract's shape. Shared with the PATCH, so both answer identically. */
export function buildAccount(
  row: AccountRow,
  grantRows: readonly GrantRow[],
  { actor, activeSuperadmins }: { actor: ConstraintActor; activeSuperadmins: number },
): AdminAccount {
  const grants: AdminAccount['grants'] = {}
  for (const g of grantRows) {
    if (g.admin_user_id !== row.id || !MODULES.includes(g.module)) continue
    const flags = Object.fromEntries(FLAGS.map((flag) => [flag, g[FLAG_COLUMN[flag]] === true])) as Record<Flag, boolean>
    // Absence is denial: a row of five falses is not an area the account has.
    if (FLAGS.some((flag) => flags[flag])) grants[g.module] = flags
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: roleOf({ isAdmin: row.is_admin, isSuperadmin: row.is_superadmin }),
    isActive: row.is_active,
    version: row.version,
    current: row.id === actor.adminId,
    grants,
    constraints: constraintsFor({
      actor,
      target: { id: row.id, isAdmin: row.is_admin, isSuperadmin: row.is_superadmin, isActive: row.is_active },
      activeSuperadmins,
    }),
  }
}

export async function loadGrants(app: GwcApp, ids: readonly string[], signal?: AbortSignal): Promise<GrantRow[]> {
  if (ids.length === 0) return []
  const { rows } = await query<GrantRow>(
    app.pg,
    `SELECT admin_user_id, module, can_read, can_write, can_edit, can_delete, can_status
       FROM admin_permissions WHERE admin_user_id = ANY($1::uuid[])`,
    [ids],
    { signal },
  )
  return rows
}

export async function countActiveSuperadmins(app: GwcApp, signal?: AbortSignal): Promise<number> {
  const { rows } = await query<{ n: number }>(
    app.pg, 'SELECT count(*)::int AS n FROM admin_users WHERE is_superadmin = true AND is_active = true', [], { signal },
  )
  return rows[0]!.n
}

export async function listAdmins(
  app: GwcApp,
  { actor, signal }: { actor: ConstraintActor; signal?: AbortSignal },
): Promise<AdminListResponse> {
  // A non-superadmin sees only what they could manage (the same rule that
  // refuses their edits), so the list never shows what they could not act on.
  const { rows } = await query<AccountRow>(
    app.pg,
    `SELECT ${ACCOUNT_COLUMNS} FROM admin_users
      WHERE ($1::boolean OR (is_admin = false AND is_superadmin = false))
      ORDER BY is_superadmin DESC, is_admin DESC, lower(email), id`,
    [actor.isSuperadmin],
    { signal },
  )
  const [grants, activeSuperadmins] = await Promise.all([
    loadGrants(app, rows.map((r) => r.id), signal),
    countActiveSuperadmins(app, signal),
  ])
  return { admins: rows.map((row) => buildAccount(row, grants, { actor, activeSuperadmins })) }
}

import { PROBLEMS } from '@gwc/contracts/errors'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import type { GwcApp } from '../../../app.ts'
import type { Designation } from '@gwc/contracts/profile'

/**
 * Staff grant and revoke member designations — today only `influencer`
 * (feature 010, US6, research R3).
 *
 * Each action carries a reason and writes to the audit log. Rows are history:
 * the table refuses DELETE and refuses touching a revoked row
 * (026_profiles.sql), so grant → revoke → grant is three facts on record.
 */

type Kind = 'influencer'

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)

function toDesignation(row: Record<string, any>): Designation {
  return {
    id: String(row.id),
    designation: row.designation,
    grantedAt: iso(row.granted_at)!,
    grantedBy: row.granted_by ? String(row.granted_by) : null,
    grantReason: String(row.grant_reason),
    revokedAt: iso(row.revoked_at),
    revokedBy: row.revoked_by ? String(row.revoked_by) : null,
    revokeReason: row.revoke_reason ?? null,
  }
}

const COLUMNS = `id, designation, granted_at, granted_by, grant_reason, revoked_at, revoked_by, revoke_reason`

async function assertMember(db: { query: (t: string, v?: unknown[]) => Promise<{ rows: any[] }> }, memberId: string) {
  const { rows } = await db.query('SELECT 1 FROM members WHERE id = $1', [memberId])
  if (rows.length === 0) throw refuse(PROBLEMS.NOT_FOUND, 'No such member.')
}

/**
 * Find a member by handle, for staff (US6). Deliberately narrow: id, name,
 * handle and status — enough to pick the right person, and no contact
 * details, which staff tools that need them read through the members module.
 */
export async function findMemberByHandle(
  app: GwcApp,
  { handle, signal }: { handle: string; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    'SELECT id, display_name, handle, status FROM members WHERE handle = $1::citext',
    [handle.trim().replace(/^@/, '')],
    { signal },
  )
  const row = rows[0]
  if (!row) throw refuse(PROBLEMS.NOT_FOUND, 'No member has that handle.')
  return { id: String(row.id), displayName: row.display_name ?? null, handle: String(row.handle), status: String(row.status) }
}

/** Newest first, active and revoked alike. */
export async function listDesignations(
  app: GwcApp,
  { memberId, signal }: { memberId: string; signal?: AbortSignal },
) {
  await assertMember(app.pg, memberId)
  const { rows } = await query(
    app.pg,
    `SELECT ${COLUMNS} FROM member_designations WHERE member_id = $1 ORDER BY granted_at DESC, id DESC`,
    [memberId],
    { signal },
  )
  return { items: rows.map(toDesignation) }
}

const checkReason = (reason: string) => {
  // By hand as well as by the request schema, for the day it is gone
  // (data-model §7); the table has the same bound as a CHECK.
  const trimmed = reason?.trim() ?? ''
  if (trimmed.length < 3 || trimmed.length > 2000) {
    throw refuse(PROBLEMS.VALIDATION_FAILED, 'A reason of 3–2000 characters is required.')
  }
  return trimmed
}

/**
 * Grant. Idempotent: an active designation already present is returned as it
 * is — the partial unique index makes a second active row impossible, and a
 * retried click must not be a second grant in the audit log either.
 */
export async function grantDesignation(
  app: GwcApp,
  { memberId, adminId, designation, reason, requestId, signal }:
    { memberId: string; adminId: string; designation: Kind; reason: string; requestId?: string; signal?: AbortSignal },
) {
  const why = checkReason(reason)
  const granted = await withTransaction(app.pg, async (client) => {
    await assertMember(client, memberId)
    const { rows } = await client.query(
      `INSERT INTO member_designations (member_id, designation, granted_by, grant_reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (member_id, designation) WHERE revoked_at IS NULL DO NOTHING
       RETURNING id`,
      [memberId, designation, adminId, why],
    )
    return rows[0] ? String(rows[0].id) : null
  }, { signal })

  if (granted) {
    await app.audit({
      action: 'member.designation.granted', outcome: 'allowed', requestId,
      actorId: adminId, actorKind: 'admin', targetType: 'member', targetId: memberId,
      detail: { designation, reason: why, designationId: granted },
    })
  }
  return listDesignations(app, { memberId, signal })
}

/** Revoke the active designation. None active is a 404: there is nothing to revoke. */
export async function revokeDesignation(
  app: GwcApp,
  { memberId, adminId, designation, reason, requestId, signal }:
    { memberId: string; adminId: string; designation: Kind; reason: string; requestId?: string; signal?: AbortSignal },
) {
  const why = checkReason(reason)
  const { rows } = await query(
    app.pg,
    `UPDATE member_designations
        SET revoked_at = now(), revoked_by = $3, revoke_reason = $4
      WHERE member_id = $1 AND designation = $2 AND revoked_at IS NULL
      RETURNING id`,
    [memberId, designation, adminId, why],
    { signal },
  )
  if (rows.length === 0) throw refuse(PROBLEMS.NOT_FOUND, 'No active designation to revoke.')
  await app.audit({
    action: 'member.designation.revoked', outcome: 'allowed', requestId,
    actorId: adminId, actorKind: 'admin', targetType: 'member', targetId: memberId,
    detail: { designation, reason: why, designationId: String(rows[0]!.id) },
  })
  return listDesignations(app, { memberId, signal })
}

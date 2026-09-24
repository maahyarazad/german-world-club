import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import type { TestRecipientList } from '@gwc/contracts/push'
import type { GwcApp } from '../../../app.ts'

/**
 * The rehearsal list.
 *
 * **No email in the response** (constitution VI, analysis A2). A rehearsal list
 * needs to tell staff *who* will get the test — a name and a handle — not how
 * to contact them, and the console adds people by handle anyway.
 */
export async function listTestRecipients(
  app: GwcApp,
  { signal }: { signal?: AbortSignal },
): Promise<TestRecipientList['recipients']> {
  const { rows } = await query(
    app.pg,
    `SELECT t.member_id, m.display_name, m.handle,
            (SELECT count(*)::int FROM push_devices d
              WHERE d.member_id = t.member_id AND d.enabled AND d.disabled_reason IS NULL) AS device_count
       FROM push_test_recipients t
       JOIN members m ON m.id = t.member_id
      ORDER BY m.display_name NULLS LAST, m.handle`,
    [],
    { signal },
  )
  return rows.map((r) => ({
    memberId: String(r.member_id),
    displayName: r.display_name ?? null,
    handle: r.handle ?? null,
    deviceCount: r.device_count,
  }))
}

type Actor = { principal: { id: string; kind?: string }; requestId: string; signal?: AbortSignal }

/**
 * Add a member to the rehearsal list, audited (FR-020): being on it means
 * receiving messages nobody else has seen yet.
 *
 * By id, or by handle — the console's way, so composing push needs no grant on
 * the `members` module. An unknown member answers 404 either way.
 */
export async function addTestRecipient(
  app: GwcApp,
  { memberId, handle, principal, requestId, signal }: Actor & { memberId?: string; handle?: string },
) {
  const { rows } = await query(
    app.pg,
    `INSERT INTO push_test_recipients (member_id, added_by)
     SELECT id, $3 FROM members
      WHERE ($1::uuid IS NOT NULL AND id = $1::uuid) OR ($2::citext IS NOT NULL AND handle = $2::citext)
     ON CONFLICT (member_id) DO UPDATE SET added_by = EXCLUDED.added_by
     RETURNING member_id`,
    [memberId ?? null, handle ?? null, principal.id],
    { signal },
  )
  if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such member.')
  const added = String(rows[0].member_id)
  await app.audit({
    action: 'push_test_recipient_added', outcome: 'allowed', requestId,
    actorId: principal.id, actorKind: principal.kind,
    targetType: 'member', targetId: added,
    requiredPermission: 'mass_messages.edit',
  })
  return added
}

export async function removeTestRecipient(app: GwcApp, { memberId, principal, requestId, signal }: Actor & { memberId: string }) {
  const { rows } = await query(
    app.pg,
    'DELETE FROM push_test_recipients WHERE member_id = $1 RETURNING member_id',
    [memberId],
    { signal },
  )
  if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'Not on the test list.')
  await app.audit({
    action: 'push_test_recipient_removed', outcome: 'allowed', requestId,
    actorId: principal.id, actorKind: principal.kind,
    targetType: 'member', targetId: memberId,
    requiredPermission: 'mass_messages.edit',
  })
  return String(rows[0].member_id)
}

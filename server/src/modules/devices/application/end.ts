import { PROBLEMS } from '@gwc/contracts/errors'
import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { revokeSession } from '../../auth/sessions.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'

/**
 * A member ends one of their own devices (feature 026, US3).
 *
 * Two outcomes, on purpose:
 *   - the device making the request: an ordinary sign-out. The phone stays
 *     KNOWN (spec scenario 3.2, and "a phone that signs itself out keeps it").
 *   - any other device: the session ends, its refresh tokens and push
 *     registration go, and a phone is FORGOTTEN — its next sign-in needs the
 *     SMS code. That is the point of the action: it is how a member deals with
 *     a lost or unrecognised phone.
 *
 * Ownership is part of the lookup, so a device that is not the caller's and one
 * that does not exist take the same path and give the same 404 — status, body
 * and headers — and a member cannot enumerate anyone else's devices by id.
 */
export async function endDevice(
  app: GwcApp,
  { memberId, sessionId, deviceId, requestId }: { memberId: string; sessionId: string; deviceId: string; requestId?: string },
): Promise<{ current: boolean }> {
  const { rows } = await app.pg.query(
    `SELECT d.id, d.kind,
            (SELECT s.id FROM sessions s WHERE s.member_device_id = d.id AND s.revoked_at IS NULL) AS session_id
       FROM member_devices d
      WHERE d.id = $1 AND d.member_id = $2`,
    [deviceId, memberId],
  )
  const device = rows[0]

  if (!device) {
    // Audited whether the id is someone else's or nobody's: "a member probed for
    // a device that is not theirs" is the same event either way.
    await app.audit({
      action: 'device_end_refused', outcome: 'denied', requestId,
      actorId: memberId, actorKind: 'member', targetType: 'member_device', targetId: null,
      detail: { reason: 'not-found' },
    })
    throw forbidden(PROBLEMS.NOT_FOUND, 'No such device.')
  }

  if (device.session_id && device.session_id === sessionId) {
    await revokeSession(app.pg, sessionId, 'logout', { forgetPushDevices: true })
    await app.denylist.add(sessionId)
    await app.audit({
      action: 'session_revoked', outcome: 'allowed', requestId,
      actorId: memberId, actorKind: 'member', detail: { reason: 'logout', sessionId },
    })
    return { current: true }
  }

  const ended = await withTransaction(app.pg, async (client: PoolClient) => {
    const { rows: revoked } = await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'device_ended'
        WHERE member_device_id = $1 AND revoked_at IS NULL
        RETURNING id`,
      [device.id],
    )
    const ids = revoked.map((r) => r.id)
    if (ids.length > 0) {
      await client.query('DELETE FROM refresh_tokens WHERE session_id = ANY($1::uuid[])', [ids])
      await client.query('DELETE FROM push_devices WHERE session_id = ANY($1::uuid[])', [ids])
    }
    // Forgetting is the member's decision to stop trusting this phone, so it
    // happens even if the session had already lapsed (idempotent for a retry).
    if (device.kind === 'mobile') {
      await client.query('UPDATE member_devices SET known_at = NULL WHERE id = $1', [device.id])
    }
    return ids
  })

  // After commit, never inside it: the denylist closes the access token's
  // remaining minutes, and a Redis hiccup must not undo a revocation that has
  // already been made durable in the database.
  for (const id of ended) await app.denylist.add(id)

  await app.audit({
    action: 'device_ended', outcome: 'allowed', requestId,
    actorId: memberId, actorKind: 'member', targetType: 'member_device', targetId: device.id,
    detail: { kind: device.kind, sessions: ended.length },
  })
  return { current: false }
}

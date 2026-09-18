import { PROBLEMS } from '@gwc/contracts/errors'
import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { hashRefreshToken } from '../tokens.ts'
import { hashPassword } from '../passwords.ts'
import { revokeAllSessions } from '../sessions.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'

export async function confirmPasswordReset(app: GwcApp, { token: presentedToken, password, requestId }) {
  const presentedHash = hashRefreshToken(presentedToken)
  const newHash = await hashPassword(password)

  const result = await withTransaction(app.pg, async (client: PoolClient) => {
    const { rows } = await client.query(
      `SELECT id, account_id, account_kind, expires_at, consumed_at
         FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE`,
      [presentedHash],
    )
    if (rows.length === 0) return null
    const record = rows[0]
    if (record.consumed_at !== null || new Date(record.expires_at) <= new Date()) return null

    await client.query('UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1', [record.id])

    if (record.account_kind === 'member') {
      // §3.2: a completed reset also reactivates an inactive member.
      await client.query(
        `UPDATE members
            SET password_hash = $2, password_reset_required = false,
                status = CASE WHEN status = 'inactive' THEN 'active'::member_status ELSE status END
          WHERE id = $1`,
        [record.account_id, newHash],
      )
    } else {
      await client.query('UPDATE admin_users SET password_hash = $2 WHERE id = $1', [record.account_id, newHash])
    }
    return record
  })

  // INVALID_RESET_TOKEN, not INVALID_REFRESH_TOKEN: the remedy for a stale
  // reset link is a new link, not a sign-in. The two used to share a type and
  // a console branching on it sent the user to the one place that cannot
  // help someone who has forgotten their password.
  if (!result) throw forbidden(PROBLEMS.INVALID_RESET_TOKEN, 'That reset link is not valid or has expired.')

  // Revoking every session is the POINT of a reset: the likely reason for one
  // is that the old credential is compromised.
  const revoked = await revokeAllSessions(app.pg, result.account_id, result.account_kind, 'password_reset')
  for (const sid of revoked) await app.denylist.add(sid)

  await app.audit({
    action: 'session_revoked', outcome: 'allowed', requestId,
    actorId: result.account_id, actorKind: result.account_kind,
    detail: { reason: 'password_reset', count: revoked.length },
  })

  return { reset: true }
}

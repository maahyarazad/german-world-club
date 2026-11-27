import { PROBLEMS } from '@gwc/contracts/errors'
import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { hashRefreshToken } from '../tokens.ts'
import { hashPassword } from '../passwords.ts'
import { applyNewPassword, endAllSessions } from './finish-password-reset.ts'
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

    // The change itself is shared with the reset-by-code flow (finish-password-reset.ts).
    // No status filter: a link in a locked member's mailbox changes the password and
    // leaves them locked, exactly as before.
    await applyNewPassword(client, {
      accountId: record.account_id, accountKind: record.account_kind, passwordHash: newHash,
    })
    return record
  })

  // INVALID_RESET_TOKEN, not INVALID_REFRESH_TOKEN: the remedy for a stale
  // reset link is a new link, not a sign-in. The two used to share a type and
  // a console branching on it sent the user to the one place that cannot
  // help someone who has forgotten their password.
  if (!result) throw forbidden(PROBLEMS.INVALID_RESET_TOKEN, 'That reset link is not valid or has expired.')

  // Ending every session is the POINT of a reset (finish-password-reset.ts says why).
  await endAllSessions(app, {
    accountId: result.account_id, accountKind: result.account_kind, requestId, via: 'link',
  })

  return { reset: true }
}

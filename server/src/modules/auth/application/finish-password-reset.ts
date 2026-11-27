import { revokeAllSessions } from '../sessions.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'

/**
 * The end of a password reset, shared by the two ways of proving you may do one
 * (feature 043): the emailed link (`confirm-password-reset.ts`) and the code texted
 * to the number on record (`confirm-password-reset-code.ts`).
 *
 * "This account has a new password, and every session it had is over" is one act,
 * and it lives here once. Two copies is how the SMS reset would one day reactivate
 * an inactive member and the emailed one forget to, or how one of them would leave a
 * stolen session alive. Both callers prove the person first; neither decides what a
 * finished reset means.
 */

/**
 * Set the new password. Runs inside the caller's transaction, so it commits or rolls
 * back with whatever proved the right to do it (consuming a link, say).
 *
 * `onlyStatuses` limits a member change to members in one of those states and the
 * return value says how many rows changed. The code flow passes `['active',
 * 'inactive']`: it verifies the code first and changes the password later, and the
 * member may have been locked or ended in between, in which case NOTHING is changed
 * (0 rows) and the caller refuses. The link flow passes nothing, as before: a link
 * in a locked member's mailbox changes the password and leaves them locked, because
 * unlocking is staff's decision and never a side effect of a reset.
 */
export async function applyNewPassword(client: PoolClient, {
  accountId, accountKind, passwordHash, onlyStatuses,
}: {
  accountId: string
  accountKind: string
  passwordHash: string
  onlyStatuses?: readonly string[]
}): Promise<number> {
  if (accountKind === 'member') {
    // §3.2: a completed reset also reactivates an inactive member.
    const { rowCount } = await client.query(
      `UPDATE members
          SET password_hash = $2, password_reset_required = false,
              status = CASE WHEN status = 'inactive' THEN 'active'::member_status ELSE status END
        WHERE id = $1 AND ($3::text[] IS NULL OR status::text = ANY($3::text[]))`,
      [accountId, passwordHash, onlyStatuses ?? null],
    )
    return rowCount ?? 0
  }
  // Staff accounts have no status gate here: the emailed link is their only way in.
  const { rowCount } = await client.query(
    'UPDATE admin_users SET password_hash = $2 WHERE id = $1',
    [accountId, passwordHash],
  )
  return rowCount ?? 0
}

/**
 * End every session the account has, and record that it happened. Called after the
 * transaction commits, as it always was.
 *
 * Revoking every session is the POINT of a reset: the likely reason for one is that
 * the old credential is compromised. Each id also goes on the denylist, so the
 * access token of a session that was live a moment ago is refused on its very next
 * request rather than when it would have expired (CLAUDE.md, "Authorization is never
 * read from the token").
 *
 * `via` says which proof was used. A reset by code also writes its own
 * `password_reset` entry (`reason: 'sms'`), so the audit log can tell the two apart;
 * the emailed link writes only the `session_revoked` entry it always did. Neither
 * entry carries the code, the password or the number: `detail` is an allowlist.
 */
export async function endAllSessions(app: GwcApp, {
  accountId, accountKind, requestId, via,
}: {
  accountId: string
  accountKind: string
  requestId?: string | null
  via: 'link' | 'sms'
}): Promise<string[]> {
  const revoked = await revokeAllSessions(app.pg, accountId, accountKind, 'password_reset')
  for (const sid of revoked) await app.denylist.add(sid)

  await app.audit({
    action: 'session_revoked', outcome: 'allowed', requestId,
    actorId: accountId, actorKind: accountKind,
    detail: { reason: 'password_reset', count: revoked.length },
  })
  if (via === 'sms') {
    await app.audit({
      action: 'password_reset', outcome: 'allowed', requestId,
      actorId: accountId, actorKind: accountKind,
      detail: { reason: 'sms' },
    })
  }
  return revoked
}

import { revokeSession } from '../sessions.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Idempotent: a client retrying after a network failure must not see an
 * error for a session that is already gone.
 */
export async function signOut(app: GwcApp, { principal, requestId, audit = true }) {
  await revokeSession(app.pg, principal.sid, 'logout')
  await app.denylist.add(principal.sid)
  if (audit) {
    await app.audit({
      action: 'session_revoked', outcome: 'allowed', requestId,
      actorId: principal.id, actorKind: principal.kind,
      detail: { reason: 'logout', sessionId: principal.sid },
    })
  }
}

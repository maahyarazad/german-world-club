import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden } from '../../../authz/require-permission.js'
import { rotateRefreshToken, REFRESH_OUTCOME } from '../sessions.js'

/**
 * Returns a discriminated outcome rather than throwing for every failure:
 * whether the controller needs to clear the auth cookies differs by outcome
 * (a missing token never had cookies worth clearing; a replayed or invalid
 * token does), and that decision belongs to the controller, not here.
 */
export async function refresh(app, { presented, face, requestId }) {
  if (!presented) {
    return { outcome: 'missing', problem: forbidden(PROBLEMS.INVALID_REFRESH_TOKEN, 'No refresh token was presented.') }
  }

  const result = await rotateRefreshToken(app.pg, presented, { face })

  if (result.outcome === REFRESH_OUTCOME.REPLAYED) {
    // A replay is compromise, not a retry: the lineage is gone and the
    // session is over. Both the legitimate holder and the attacker must
    // re-authenticate.
    await app.denylist.add(result.sessionId)
    await app.audit({
      action: 'token_reuse', outcome: 'denied', requestId,
      actorId: result.accountId, actorKind: result.accountKind,
      detail: { sessionId: result.sessionId, reason: 'refresh-token-replay' },
    })
    return { outcome: 'replayed', problem: forbidden(PROBLEMS.SESSION_REVOKED, 'This session has been ended.') }
  }

  if (result.outcome !== REFRESH_OUTCOME.ROTATED) {
    return { outcome: 'invalid', problem: forbidden(PROBLEMS.INVALID_REFRESH_TOKEN, 'That refresh token is not valid.') }
  }

  const { token, expiresIn } = app.mintAccessToken({
    accountId: result.accountId, sessionId: result.sessionId, audience: result.accountKind,
  })

  return { outcome: 'rotated', face, token, expiresIn, refreshToken: result.refreshToken }
}

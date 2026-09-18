import { withTransaction, query } from '../../db/query.js'
import { generateRefreshToken, hashRefreshToken, refreshExpiry } from './tokens.js'

/**
 * Sessions, rotation, and revocation (FR-004, FR-005).
 *
 * Three rules, each enforced where it cannot be forgotten:
 *
 *   1. **One active session per account** is a partial unique index, not an
 *      application check — so two concurrent sign-ins are a constraint
 *      violation handled deterministically rather than a race.
 *   2. **A refresh token is single-use.** Rotation issues a successor and marks
 *      the presented token consumed, inside one transaction.
 *   3. **A replay is compromise, not a retry.** The legitimate holder and an
 *      attacker are indistinguishable at that point, so the safe action is to
 *      end the lineage and force re-authentication.
 */

/** Access-token lifetime, so a denylist entry expires exactly when the token does. */
const DENYLIST_TTL_SECONDS = 600

export const denylistKey = (sid) => `denylist:sid:${sid}`

/**
 * The Redis denylist closes the window between a revocation and the access
 * token's own expiry. Entries expire with the token, so the set stays
 * proportional to *recent revocations* rather than to total sessions.
 *
 * Permission changes never had this window — authorization is not read from the
 * token — so this exists solely for session-level revocation.
 */
export function createDenylist(redis) {
  if (!redis) {
    // Without Redis the denylist is unavailable, so a revoked session's access
    // token stays valid for up to its remaining lifetime. That is why
    // REDIS_URL is required in production; in a single-process development run
    // it is a documented, bounded gap rather than a silent one.
    const local = new Map()
    return {
      async add(sid) {
        local.set(sid, Date.now() + DENYLIST_TTL_SECONDS * 1000)
      },
      async has(sid) {
        const until = local.get(sid)
        if (until === undefined) return false
        if (until < Date.now()) {
          local.delete(sid)
          return false
        }
        return true
      },
      /**
       * Drop expired entries (FR-051's denylist sweep).
       *
       * Only the in-memory fallback needs this: Redis expires its own keys
       * through SETEX. Without it a long-running single-process deployment
       * accumulates one entry per revoked session forever, since `has` only
       * evicts a key somebody happens to ask about again.
       */
      async prune(now = Date.now()) {
        let removed = 0
        for (const [sid, until] of local) {
          if (until < now) {
            local.delete(sid)
            removed += 1
          }
        }
        return removed
      },
    }
  }
  return {
    async add(sid) {
      await redis.setex(denylistKey(sid), DENYLIST_TTL_SECONDS, '1')
    },
    async has(sid) {
      return (await redis.exists(denylistKey(sid))) === 1
    },
    // Redis expires these itself through SETEX, so there is nothing to sweep.
    async prune() {
      return 0
    },
  }
}

/**
 * Sign-in as ONE transaction: revoke any active session, insert the new one,
 * issue the refresh token, update `last_login_at`.
 *
 * The order matters. Revoking first is what lets the partial unique index
 * accept the insert; doing it the other way round makes every sign-in a
 * constraint violation.
 */
export async function startSession(pool, {
  accountId, accountKind, deviceId = null, userAgent = null, ip = null, face = 'web', now = new Date(),
}) {
  return withTransaction(pool, async (client) => {
    const { rows: superseded } = await client.query(
      `UPDATE sessions
          SET revoked_at = now(), revoked_reason = 'superseded'
        WHERE account_id = $1 AND account_kind = $2 AND revoked_at IS NULL
        RETURNING id`,
      [accountId, accountKind],
    )

    const { rows } = await client.query(
      `INSERT INTO sessions (account_id, account_kind, device_id, user_agent, ip_created)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [accountId, accountKind, deviceId, userAgent, ip],
    )
    const session = rows[0]

    const refresh = generateRefreshToken()
    await client.query(
      `INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [session.id, refresh.hash, refreshExpiry(face, now)],
    )

    const table = accountKind === 'admin' ? 'admin_users' : 'members'
    if (table === 'members') {
      await client.query('UPDATE members SET last_login_at = now() WHERE id = $1', [accountId])
    }

    return { sessionId: session.id, refreshToken: refresh.plaintext, supersededSessionIds: superseded.map((r) => r.id) }
  })
}

export const REFRESH_OUTCOME = Object.freeze({
  ROTATED: 'rotated',
  UNKNOWN: 'unknown',
  REPLAYED: 'replayed',
  SESSION_REVOKED: 'session_revoked',
  EXPIRED: 'expired',
})

/**
 * Rotate a refresh token, or detect a replay.
 *
 * The whole decision table of data-model.md §3, in one transaction so a
 * concurrent second presentation cannot slip between the read and the write.
 */
export async function rotateRefreshToken(pool, presentedPlaintext, { face = 'web', now = new Date() } = {}) {
  const presentedHash = hashRefreshToken(presentedPlaintext)

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT rt.id, rt.session_id, rt.consumed_at, rt.expires_at,
              s.account_id, s.account_kind, s.revoked_at, s.device_id
         FROM refresh_tokens rt
         JOIN sessions s ON s.id = rt.session_id
        WHERE rt.token_hash = $1
        FOR UPDATE OF rt`,
      [presentedHash],
    )

    // No such token. There is no session to terminate, and no information to
    // give away about whether one ever existed.
    if (rows.length === 0) return { outcome: REFRESH_OUTCOME.UNKNOWN }

    const token = rows[0]

    if (token.consumed_at !== null) {
      // REPLAY. Revoke the session and delete the lineage — the ancestor chain
      // as well as the descendants, since any of them may be in the attacker's
      // hands.
      await client.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'token_reuse'
          WHERE id = $1 AND revoked_at IS NULL`,
        [token.session_id],
      )
      await client.query('DELETE FROM refresh_tokens WHERE session_id = $1', [token.session_id])
      return {
        outcome: REFRESH_OUTCOME.REPLAYED,
        sessionId: token.session_id,
        accountId: token.account_id,
        accountKind: token.account_kind,
      }
    }

    if (token.revoked_at !== null) return { outcome: REFRESH_OUTCOME.SESSION_REVOKED, sessionId: token.session_id }
    if (new Date(token.expires_at) <= now) return { outcome: REFRESH_OUTCOME.EXPIRED, sessionId: token.session_id }

    await client.query('UPDATE refresh_tokens SET consumed_at = now() WHERE id = $1', [token.id])

    const successor = generateRefreshToken()
    await client.query(
      `INSERT INTO refresh_tokens (session_id, token_hash, parent_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [token.session_id, successor.hash, token.id, refreshExpiry(face, now)],
    )
    await client.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [token.session_id])

    return {
      outcome: REFRESH_OUTCOME.ROTATED,
      sessionId: token.session_id,
      accountId: token.account_id,
      accountKind: token.account_kind,
      deviceId: token.device_id,
      refreshToken: successor.plaintext,
    }
  })
}

/**
 * Revoke a session. **Idempotent**: revoking an already-revoked session is a
 * success, because a client retrying after a network failure must not see an
 * error (auth-api.md, `POST /auth/sign-out`).
 */
// NOTE: the caller's deadline signal is accepted and currently unused —
// `withTransaction` has no signal path yet. T178 propagates it into every `pg`
// query; until then the parameter is dropped rather than silently promised.
export async function revokeSession(pool, sessionId, reason) {
  await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
        WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, reason],
    )
    await client.query('DELETE FROM refresh_tokens WHERE session_id = $1', [sessionId])
  })
  return { sessionId, reason }
}

/** Revoke every session for an account — what a password reset does (§3.2). */
export async function revokeAllSessions(pool, accountId, accountKind, reason, { signal } = {}) {
  const { rows } = await query(
    pool,
    `UPDATE sessions SET revoked_at = now(), revoked_reason = $3
      WHERE account_id = $1 AND account_kind = $2 AND revoked_at IS NULL
      RETURNING id`,
    [accountId, accountKind, reason],
    { signal },
  )
  const ids = rows.map((r) => r.id)
  if (ids.length > 0) {
    await query(pool, 'DELETE FROM refresh_tokens WHERE session_id = ANY($1::uuid[])', [ids], { signal })
  }
  return ids
}

/** Is this session still usable? Read per request, alongside the denylist. */
export async function loadSession(pool, sessionId, { signal } = {}) {
  const { rows } = await query(
    pool,
    'SELECT id, account_id, account_kind, device_id, revoked_at FROM sessions WHERE id = $1',
    [sessionId],
    { signal },
  )
  return rows[0] ?? null
}

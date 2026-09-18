import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { query, withTransaction } from '../../db/query.ts'
import { OTP_TTL_SECONDS, OTP_MAX_ATTEMPTS } from '@gwc/contracts/auth'

/**
 * The mobile second factor (§6.2) and device approval (§6.1).
 *
 * A 4-digit code is only 10,000 possibilities. What makes it safe is not the
 * code but the three things around it: a five-attempt ceiling that invalidates
 * the challenge, a five-minute expiry, and binding to the device that asked.
 * All three are enforced server-side; §6.2's demo-account bypass is an explicit
 * account flag, never an environment condition.
 */

export { OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS }

/** `randomInt` rather than `Math.random`: a predictable second factor is none. */
export const generateCode = () => String(randomInt(0, 10_000)).padStart(4, '0')

/**
 * Hashed with the challenge id as a salt, so two challenges sharing a code do
 * not share a digest — otherwise a database read would let one challenge's
 * digest be matched against another's.
 */
export const hashCode = (code, challengeId) =>
  createHash('sha256').update(`${challengeId}:${code}`, 'utf8').digest()

export const OTP_OUTCOME = Object.freeze({
  VERIFIED: 'verified',
  INVALID: 'invalid',
  EXPIRED: 'expired',
  ATTEMPTS_EXCEEDED: 'attempts_exceeded',
})

export async function issueChallenge(pool, {
  accountId, accountKind, deviceId, purpose = 'login', now = new Date(), signal,
}) {
  const code = generateCode()
  const expiresAt = new Date(now.getTime() + OTP_TTL_SECONDS * 1000)

  const { rows } = await query(
    pool,
    `INSERT INTO otp_challenges (account_id, account_kind, code_hash, device_id, purpose, expires_at)
     VALUES ($1, $2, '\\x00'::bytea, $3, $4, $5)
     RETURNING id`,
    [accountId, accountKind, deviceId, purpose, expiresAt],
    { signal },
  )
  const id = rows[0].id

  // The digest is salted with the row id, which only exists after the insert.
  await query(pool, 'UPDATE otp_challenges SET code_hash = $2 WHERE id = $1', [id, hashCode(code, id)], { signal })

  return { challengeId: id, code, expiresAt }
}

/**
 * Verify a presented code.
 *
 * A `deviceId` mismatch returns `invalid`, **not** a distinct error: a distinct
 * one would let a challenge be probed across devices, which is the thing
 * binding it to a device was meant to prevent (§12.6).
 */
export async function verifyChallenge(pool, { challengeId, code, deviceId, now = new Date() }) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT id, account_id, account_kind, code_hash, device_id, purpose, attempts, expires_at, consumed_at
         FROM otp_challenges WHERE id = $1 FOR UPDATE`,
      [challengeId],
    )
    if (rows.length === 0) return { outcome: OTP_OUTCOME.INVALID }
    const challenge = rows[0]

    if (challenge.consumed_at !== null) return { outcome: OTP_OUTCOME.EXPIRED }
    if (new Date(challenge.expires_at) <= now) return { outcome: OTP_OUTCOME.EXPIRED }

    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      await client.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [challengeId])
      return { outcome: OTP_OUTCOME.ATTEMPTS_EXCEEDED }
    }

    const expected = Buffer.from(challenge.code_hash)
    const presented = hashCode(String(code ?? ''), challengeId)
    const codeMatches = expected.length === presented.length && timingSafeEqual(expected, presented)
    const deviceMatches = challenge.device_id === deviceId

    if (!codeMatches || !deviceMatches) {
      const { rows: after } = await client.query(
        'UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
        [challengeId],
      )
      // Reaching the ceiling invalidates the challenge outright, rather than
      // leaving it available for one more guess per window.
      if (after[0].attempts >= OTP_MAX_ATTEMPTS) {
        await client.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [challengeId])
        return { outcome: OTP_OUTCOME.ATTEMPTS_EXCEEDED }
      }
      return { outcome: OTP_OUTCOME.INVALID, attempts: after[0].attempts }
    }

    await client.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [challengeId])
    return {
      outcome: OTP_OUTCOME.VERIFIED,
      accountId: challenge.account_id,
      accountKind: challenge.account_kind,
      deviceId: challenge.device_id,
      purpose: challenge.purpose,
    }
  })
}

/**
 * Masked for display. The full number is never echoed, because sign-in is
 * reachable before authentication and would otherwise enumerate contact
 * details for an invite-only club.
 */
export function maskPhone(mobile) {
  const digits = String(mobile ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : '••••'
}

/** Load an unconsumed challenge, for the resend path. */
export async function loadChallenge(pool, challengeId, { signal } = {}) {
  const { rows } = await query(
    pool,
    `SELECT id, account_id, account_kind, device_id, purpose, expires_at, consumed_at, created_at
       FROM otp_challenges WHERE id = $1`,
    [challengeId],
    { signal },
  )
  return rows[0] ?? null
}

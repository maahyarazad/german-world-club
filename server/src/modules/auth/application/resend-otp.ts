import { randomUUID } from 'node:crypto'
import { OTP_RESEND_COOLDOWN_SECONDS } from '@gwc/contracts/auth'
import { query } from '../../../db/query.ts'
import { digitsForPurpose, issueChallenge, loadChallenge } from '../otp.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Loads the challenge and its rate-limit key ahead of the route's
 * `preHandler` limiter — keyed on the phone number, not the address, since
 * each send costs real money and an address-keyed limit is trivially
 * bypassed.
 */
export async function loadOtpResendContext(app: GwcApp, challengeId, signal) {
  const challenge = await loadChallenge(app.pg, challengeId, { signal })
  if (!challenge) return { challenge: null, phoneKey: null }
  // A password-reset challenge is not resendable, and must look like it does not exist at all
  // (feature 043, research R17). The id of one is handed to an unauthenticated caller, and for
  // an identifier that matches nobody it is a random uuid; if a real one were resent (or refused
  // as "too soon" inside the cooldown) while a made-up one answered as unknown, one request would
  // tell a stranger whether an identifier has an account. Returning here, BEFORE the members
  // lookup below, also means the same work is done as for an unknown id. To get another code the
  // app asks again at /auth/password-reset/code, which is limited to three an hour per number.
  if (challenge.purpose === 'password_reset') return { challenge: null, phoneKey: null }
  const { rows } = await query(app.pg, 'SELECT mobile FROM members WHERE id = $1', [challenge.account_id], { signal })
  return { challenge, phoneKey: rows[0]?.mobile ?? challenge.account_id }
}

export async function resendOtp(app: GwcApp, { challenge, phoneKey, signal }) {
  // A missing or spent challenge answers the same as a fresh one: the resend
  // endpoint must not report whether a challenge exists.
  if (!challenge || challenge.consumed_at !== null) {
    return { outcome: 'resent', resent: true, cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS, challengeId: randomUUID() }
  }

  const sinceIssue = Date.now() - new Date(challenge.created_at).getTime()
  if (sinceIssue < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
    const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN_SECONDS * 1000 - sinceIssue) / 1000)
    // Header/status shaping is an HTTP concern the controller applies; this
    // layer only reports the outcome and the wait time.
    return { outcome: 'too_soon', retryAfter }
  }

  const fresh = await issueChallenge(app.pg, {
    accountId: challenge.account_id,
    accountKind: challenge.account_kind,
    deviceId: challenge.device_id,
    purpose: challenge.purpose,
    // The length belongs to the purpose: a code issued with the default four digits for a purpose
    // that expects more is a code its own screen refuses every time.
    digits: digitsForPurpose(challenge.purpose),
    signal,
  })
  await app.sendOtp({ mobile: phoneKey, code: fresh.code, route: 'auth.otp.resend', accountId: challenge.account_id })
  return { outcome: 'resent', resent: true, cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS, challengeId: fresh.challengeId }
}

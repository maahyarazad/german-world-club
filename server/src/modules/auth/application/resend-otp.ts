import { OTP_RESEND_COOLDOWN_SECONDS } from '@gwc/contracts/auth'
import { query } from '../../../db/query.ts'
import { issueChallenge, loadChallenge } from '../otp.ts'

/**
 * Loads the challenge and its rate-limit key ahead of the route's
 * `preHandler` limiter — keyed on the phone number, not the address, since
 * each send costs real money and an address-keyed limit is trivially
 * bypassed.
 */
export async function loadOtpResendContext(app, challengeId, signal) {
  const challenge = await loadChallenge(app.pg, challengeId, { signal })
  if (!challenge) return { challenge: null, phoneKey: null }
  const { rows } = await query(app.pg, 'SELECT mobile FROM members WHERE id = $1', [challenge.account_id], { signal })
  return { challenge, phoneKey: rows[0]?.mobile ?? challenge.account_id }
}

export async function resendOtp(app, { challenge, phoneKey, signal }) {
  // A missing or spent challenge answers the same as a fresh one: the resend
  // endpoint must not report whether a challenge exists.
  if (!challenge || challenge.consumed_at !== null) {
    return { outcome: 'resent', resent: true, cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS }
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
    signal,
  })
  await app.sendOtp?.({ mobile: phoneKey, code: fresh.code })
  return { outcome: 'resent', resent: true, cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS }
}

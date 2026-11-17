import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { startSession } from '../sessions.ts'
import { labelForPhone } from '../device-label.ts'
import { verifyChallenge, OTP_OUTCOME } from '../otp.ts'
import type { GwcApp } from '../../../app.ts'

export async function verifyOtp(app: GwcApp, { challengeId, code, deviceId, deviceLabel, ip, userAgent, requestId, signal }) {
  // Only sign-in codes open a session here. Onboarding codes are redeemed by
  // /onboarding/*, which also records what they prove.
  const result = await verifyChallenge(app.pg, { challengeId, code, deviceId, purposes: ['login', 'device_approval'] })

  if (result.outcome === OTP_OUTCOME.EXPIRED) {
    throw forbidden(PROBLEMS.OTP_EXPIRED, 'This code has expired. Request a new one.')
  }
  if (result.outcome === OTP_OUTCOME.ATTEMPTS_EXCEEDED) {
    await app.audit({ action: 'sign_in_refused', outcome: 'denied', requestId, detail: { reason: 'otp-attempts' } })
    throw forbidden(PROBLEMS.OTP_ATTEMPTS_EXCEEDED, 'Too many attempts. Request a new code.')
  }
  if (result.outcome !== OTP_OUTCOME.VERIFIED) {
    // A device mismatch answers identically, so a challenge cannot be probed
    // across devices (§12.6).
    throw forbidden(PROBLEMS.INVALID_OTP, 'That code is not valid.')
  }

  const session = await startSession(app.pg, {
    accountId: result.accountId,
    accountKind: result.accountKind,
    deviceId: result.deviceId,
    userAgent: userAgent ?? null,
    ip,
    face: 'mobile',
    deviceLabel: labelForPhone(deviceLabel),
  })
  for (const sid of session.supersededSessionIds) await app.denylist.add(sid)

  // The code proved this phone: from now on it signs in with the password
  // alone (feature 026, FR-004). Only a member whose application is approved or
  // absent gets that — an applicant resuming onboarding is let in by their code
  // every time, and review.ts marks their phone known when they are approved.
  // `login` codes only: a `device_approval` code is the retired approval flow.
  if (result.accountKind === 'member' && session.memberDeviceId) {
    await query(
      app.pg,
      `UPDATE member_devices SET known_at = coalesce(known_at, now())
        WHERE id = $1
          AND NOT EXISTS (SELECT 1 FROM membership_applications a
                           WHERE a.member_id = member_devices.member_id AND a.state <> 'approved')`,
      [session.memberDeviceId],
      { signal },
    )
  }

  const { token, expiresIn } = app.mintAccessToken({
    accountId: result.accountId, sessionId: session.sessionId, audience: result.accountKind,
  })

  const { rows } = await query(app.pg, 'SELECT display_name FROM members WHERE id = $1', [result.accountId], { signal })

  await app.audit({
    action: 'sign_in', outcome: 'allowed', requestId,
    actorId: result.accountId, actorKind: result.accountKind, detail: { sessionId: session.sessionId },
  })

  return {
    accessToken: token,
    refreshToken: session.refreshToken,
    expiresIn,
    principal: { id: result.accountId, kind: result.accountKind, displayName: rows[0]?.display_name ?? null },
  }
}

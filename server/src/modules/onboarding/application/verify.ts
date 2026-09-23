import { PROBLEMS } from '@gwc/contracts/errors'
import { EMAIL_CODE_LENGTH, EMAIL_CODE_TTL_SECONDS } from '@gwc/contracts/onboarding'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { issueChallenge, verifyChallenge, OTP_OUTCOME, WEB_DEVICE } from '../../auth/otp.ts'
import { startSession } from '../../auth/sessions.ts'
import { loadStatus } from './status.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Steps 3 and 4 of §6.1: prove the mobile number, then the email address.
 *
 * `refuse` is `forbidden` under an honest name: it builds a problem error for
 * whatever status the problem carries, 401 and 409 included — sign-in has used
 * it that way from the start.
 */

/** Map a failed verification to the same refusals /auth/verify-otp gives. */
function refuseOutcome(outcome: string): never {
  if (outcome === OTP_OUTCOME.EXPIRED) throw refuse(PROBLEMS.OTP_EXPIRED, 'This code has expired. Request a new one.')
  if (outcome === OTP_OUTCOME.ATTEMPTS_EXCEEDED) throw refuse(PROBLEMS.OTP_ATTEMPTS_EXCEEDED, 'Too many attempts. Request a new code.')
  throw refuse(PROBLEMS.INVALID_OTP, 'That code is not valid.')
}

/**
 * Verify the SMS code and open the applicant's session.
 *
 * The session is a real one — bound to the device on mobile, a cookie session
 * on the web — and the member gates are what keep it inside `/onboarding/*`
 * until staff approve (10-auth). Issuing it here is what lets either client
 * survive a restart mid-onboarding without asking for the password again.
 */
export async function verifyMobile(
  app: GwcApp,
  { challengeId, code, deviceId, ip, userAgent, requestId }:
    { challengeId: string; code: string; deviceId?: string; ip?: string; userAgent?: string; requestId?: string },
) {
  const result = await verifyChallenge(app.pg, {
    challengeId, code, deviceId: deviceId ?? WEB_DEVICE, purposes: ['mobile_verification'],
  })
  if (result.outcome !== OTP_OUTCOME.VERIFIED) refuseOutcome(result.outcome)
  const memberId = String(result.accountId)

  await app.pg.query(
    'UPDATE members SET mobile_verified_at = now() WHERE id = $1 AND mobile_verified_at IS NULL',
    [memberId],
  )

  // The face decides how the session travels (the controller: tokens in the
  // body for the app, cookies for the browser) and how long it lives.
  const face = deviceId ? 'mobile' : 'web'
  const session = await startSession(app.pg, {
    accountId: memberId, accountKind: 'member', deviceId: deviceId ?? null, userAgent: userAgent ?? null, ip, face,
  })
  for (const sid of session.supersededSessionIds) await app.denylist.add(sid)

  const { token, expiresIn } = app.mintAccessToken({ accountId: memberId, sessionId: session.sessionId, audience: 'member' })
  const { rows } = await app.pg.query('SELECT display_name FROM members WHERE id = $1', [memberId])

  await app.audit({
    action: 'membership_mobile_verified', outcome: 'allowed', requestId,
    actorId: memberId, actorKind: 'member', targetType: 'membership_application', targetId: memberId,
  })

  return {
    face,
    accessToken: token,
    refreshToken: session.refreshToken,
    expiresIn: Number(expiresIn),
    principal: { id: memberId, kind: 'member' as const, displayName: rows[0]?.display_name ?? null },
  }
}

/** `jane@example.com` → `j•••@example.com`. The domain is not the secret. */
export function maskEmail(email: string) {
  const [local = '', domain = ''] = String(email).split('@')
  return `${local.slice(0, 1)}•••@${domain}`
}

/**
 * Mail a six-digit code to the address given at registration.
 *
 * Bound to the session's device like every other challenge, so a code read
 * from somebody else's inbox is useless without the applicant's phone as well.
 */
export async function sendEmailCode(
  app: GwcApp,
  { memberId, deviceId, signal }: { memberId: string; deviceId: string | null; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    'SELECT email, email_confirmed_at, display_name FROM members WHERE id = $1',
    [memberId],
    { signal },
  )
  const member = rows[0]
  if (!member) throw refuse(PROBLEMS.NOT_FOUND, 'No such account.')
  if (member.email_confirmed_at !== null) {
    throw refuse(PROBLEMS.CONFLICT, 'This email address is already confirmed.')
  }

  const challenge = await issueChallenge(app.pg, {
    accountId: memberId,
    accountKind: 'member',
    // A web session has no device; see WEB_DEVICE.
    deviceId: deviceId ?? WEB_DEVICE,
    purpose: 'email_verification',
    digits: EMAIL_CODE_LENGTH,
    ttlSeconds: EMAIL_CODE_TTL_SECONDS,
    signal,
  })

  await app.enqueueMail({
    to: member.email,
    template: 'onboarding.email-code',
    subjectKey: challenge.challengeId,
    variables: { code: challenge.code, name: member.display_name },
  }, { signal })

  return { challengeId: challenge.challengeId, expiresIn: EMAIL_CODE_TTL_SECONDS, sentTo: maskEmail(member.email) }
}

/**
 * Confirm the address, which completes the application and puts it in front
 * of staff (`submitted_at`). Both in one transaction: a confirmed address on an
 * application nobody can see in the queue is an applicant waiting forever.
 */
export async function verifyEmail(
  app: GwcApp,
  { memberId, deviceId, challengeId, code, requestId, signal }:
    { memberId: string; deviceId: string | null; challengeId: string; code: string; requestId?: string; signal?: AbortSignal },
) {
  const result = await verifyChallenge(app.pg, {
    challengeId, code, deviceId: deviceId ?? WEB_DEVICE, purposes: ['email_verification'],
  })
  if (result.outcome !== OTP_OUTCOME.VERIFIED) refuseOutcome(result.outcome)
  // A valid code for somebody else's challenge proves nothing about this
  // account, and answers exactly like a wrong one.
  if (String(result.accountId) !== memberId) refuseOutcome(OTP_OUTCOME.INVALID)

  await withTransaction(app.pg, async (client) => {
    await client.query(
      'UPDATE members SET email_confirmed_at = now() WHERE id = $1 AND email_confirmed_at IS NULL',
      [memberId],
    )
    await client.query(
      `UPDATE membership_applications SET submitted_at = now()
        WHERE member_id = $1 AND submitted_at IS NULL`,
      [memberId],
    )
  }, { signal })

  await app.audit({
    action: 'membership_application_submitted', outcome: 'allowed', requestId,
    actorId: memberId, actorKind: 'member', targetType: 'membership_application', targetId: memberId,
  })

  return loadStatus(app, { memberId, signal })
}

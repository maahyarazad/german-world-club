import { PROBLEMS } from '@gwc/contracts/errors'
import { EMAIL_CODE_LENGTH, EMAIL_CODE_TTL_SECONDS } from '@gwc/contracts/onboarding'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { issueChallenge, verifyChallenge, OTP_OUTCOME, WEB_DEVICE } from '../../auth/otp.ts'
import { startSession } from '../../auth/sessions.ts'
import { loadStatus } from './status.ts'
import { applyDecision, auditAutomaticDecision } from './review.ts'
import type { Decision } from './review.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Steps 3 and 4 of §6.1: prove the mobile number, then the email address.
 *
 * `refuse` is `forbidden` under an honest name: it builds a problem error for
 * whatever status the problem carries, 401 and 409 included — sign-in has used
 * it that way from the start.
 */

/** Shown to the applicant in the denial email; the server emits English (see CLAUDE.md). */
export const NON_GERMAN_DENIAL_REASON = 'Primary language is not German'

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

  // In the request and never the outbox: the applicant is watching the screen
  // for it, and a code delivered late by mail.deliver would already be stale.
  // A failed send is a 503 the app answers with "resend".
  await app.sendMailInstantly({
    to: member.email,
    template: 'onboarding.email-code',
    subjectKey: challenge.challengeId,
    variables: { code: challenge.code, name: member.display_name },
  }, { signal })

  return { challengeId: challenge.challengeId, expiresIn: EMAIL_CODE_TTL_SECONDS, sentTo: maskEmail(member.email) }
}

/**
 * Step 4: correct the email address before it is confirmed.
 *
 * Only while unconfirmed — a confirmed address is changed through the member's
 * profile, not onboarding. A taken address is refused with `email-in-use` so
 * the applicant can choose another. Codes already sent to the old address stop
 * working, and a new one is mailed to the new address.
 */
export async function changeEmail(
  app: GwcApp,
  { memberId, deviceId, email, requestId, signal }:
    { memberId: string; deviceId: string | null; email: string; requestId?: string; signal?: AbortSignal },
) {
  try {
    await withTransaction(app.pg, async (client) => {
      const { rows } = await client.query(
        'SELECT email, email_confirmed_at FROM members WHERE id = $1 FOR UPDATE',
        [memberId],
      )
      const member = rows[0]
      if (!member) throw refuse(PROBLEMS.NOT_FOUND, 'No such account.')
      if (member.email_confirmed_at !== null) {
        throw refuse(PROBLEMS.CONFLICT, 'This email address is already confirmed.')
      }
      const taken = await client.query('SELECT 1 FROM members WHERE email = $1 AND id <> $2', [email, memberId])
      if (taken.rows.length) throw refuse(PROBLEMS.EMAIL_IN_USE, 'This email address is already in use.')

      await client.query('UPDATE members SET email = $2 WHERE id = $1', [memberId, email])
      // A code mailed to the mistyped address must not confirm the new one.
      await client.query(
        `UPDATE otp_challenges SET consumed_at = now()
          WHERE account_id = $1 AND purpose = 'email_verification' AND consumed_at IS NULL`,
        [memberId],
      )
    }, { signal })
  } catch (err) {
    // Two accounts racing for the same address: the unique constraint decides.
    const conflict = err as { code?: string; constraint?: string }
    if (conflict?.code === '23505' && conflict.constraint === 'members_email_key') {
      throw refuse(PROBLEMS.EMAIL_IN_USE, 'This email address is already in use.')
    }
    throw err
  }

  // After the commit, without the addresses: the log records that it changed.
  await app.audit({
    action: 'membership_application_email_changed', outcome: 'allowed', requestId,
    actorId: memberId, actorKind: 'member', targetType: 'membership_application', targetId: memberId,
  })
  return sendEmailCode(app, { memberId, deviceId, signal })
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

  let automaticDenial: Decision | null = null
  await withTransaction(app.pg, async (client) => {
    await client.query(
      'UPDATE members SET email_confirmed_at = now() WHERE id = $1 AND email_confirmed_at IS NULL',
      [memberId],
    )
    const submitted = await client.query(
      `UPDATE membership_applications SET submitted_at = now()
        WHERE member_id = $1 AND submitted_at IS NULL
        RETURNING member_id`,
      [memberId],
    )
    // Phase 1 rules, applied once, at the moment the application is complete
    // (business description). Both happen in this transaction: a member told
    // "denied" or "thank you" must have the decision the mail describes.
    if (submitted.rows.length > 0) {
      const { rows } = await client.query(
        'SELECT primary_language, email, display_name FROM members WHERE id = $1', [memberId],
      )
      const member = rows[0]
      if (member?.primary_language === 'non_german') {
        // Never reaches the staff queue: decided here, by the system.
        automaticDenial = { state: 'denied', reason: NON_GERMAN_DENIAL_REASON }
        await applyDecision(app, client, { memberId, adminId: null, decision: automaticDenial })
      } else if (member?.primary_language === 'german') {
        await app.enqueueMail({
          to: member.email,
          template: 'onboarding.thank-you',
          subjectKey: `application-submitted:${memberId}`,
          variables: { name: member.display_name },
        }, { client })
      }
    }
  }, { signal })

  if (automaticDenial) await auditAutomaticDecision(app, { memberId, decision: automaticDenial })

  await app.audit({
    action: 'membership_application_submitted', outcome: 'allowed', requestId,
    actorId: memberId, actorKind: 'member', targetType: 'membership_application', targetId: memberId,
  })

  return loadStatus(app, { memberId, signal })
}

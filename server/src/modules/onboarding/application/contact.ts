import { PROBLEMS } from '@gwc/contracts/errors'
import { OTP_TTL_SECONDS } from '@gwc/contracts/auth'
import { withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { issueChallenge, maskPhone, WEB_DEVICE } from '../../auth/otp.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'
import type { ChangeContactRequest, RegisterResponse } from '@gwc/contracts/onboarding'

/**
 * Step 3: correct the email address or mobile number of an application whose
 * number is not verified yet (`POST /onboarding/contact`).
 *
 * Authorised by the pending mobile-verification challenge, on the device (or
 * browser) it was issued to — the one thing only the applicant who registered
 * holds. It changes the SAME account, so a typo no longer means registering
 * again and leaving a half-finished account behind.
 *
 * A taken email or number is refused with its own 409, so the applicant can
 * choose another. The old challenge is spent and a new code is texted to the
 * (possibly new) number; both happen in one transaction with the change, so a
 * refused or failed SMS leaves everything as it was.
 */
export async function changeContact(
  app: GwcApp,
  input: ChangeContactRequest & { requestId?: string; signal?: AbortSignal },
): Promise<RegisterResponse> {
  const { challengeId, email, mobile, deviceId, requestId, signal } = input
  if (mobile) app.assertSmsDestination(mobile, 'onboarding.contact')

  let changed: { memberId: string; email: boolean; mobile: boolean }
  let sent: RegisterResponse
  try {
    ({ changed, sent } = await withTransaction(app.pg, async (client: PoolClient) => {
      const { rows } = await client.query(
        `SELECT m.id, m.email, m.mobile
           FROM otp_challenges c
           JOIN members m ON m.id = c.account_id
           JOIN membership_applications a ON a.member_id = m.id
          WHERE c.id = $1 AND c.account_kind = 'member' AND c.purpose = 'mobile_verification'
            AND c.consumed_at IS NULL AND c.device_id = $2
            AND m.mobile_verified_at IS NULL AND a.state = 'pending'
          FOR UPDATE OF c, m`,
        [challengeId, deviceId ?? WEB_DEVICE],
      )
      const member = rows[0]
      // One answer for an unknown, spent, verified or foreign challenge: none
      // of them may be edited, and saying which would help nobody honest.
      if (!member) throw refuse(PROBLEMS.NOT_FOUND, 'There is no pending registration to change.')

      const nextEmail = email ?? member.email
      const nextMobile = mobile ?? member.mobile
      const emailChanged = String(nextEmail).toLowerCase() !== String(member.email).toLowerCase()
      const mobileChanged = nextMobile !== member.mobile

      if (emailChanged) {
        const taken = await client.query('SELECT 1 FROM members WHERE email = $1 AND id <> $2', [nextEmail, member.id])
        if (taken.rows.length) throw refuse(PROBLEMS.EMAIL_IN_USE, 'This email address is already in use.')
      }
      if (mobileChanged) {
        const taken = await client.query('SELECT 1 FROM members WHERE mobile = $1 AND id <> $2', [nextMobile, member.id])
        if (taken.rows.length) throw refuse(PROBLEMS.MOBILE_IN_USE, 'This mobile number is already in use.')
      }

      await client.query('UPDATE members SET email = $2, mobile = $3 WHERE id = $1', [member.id, nextEmail, nextMobile])
      await client.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [challengeId])

      const challenge = await issueChallenge(client, {
        accountId: member.id, accountKind: 'member', deviceId: deviceId ?? WEB_DEVICE, purpose: 'mobile_verification',
      })
      await app.sendOtp({ mobile: nextMobile, code: challenge.code, route: 'onboarding.contact', accountId: member.id })

      return {
        changed: { memberId: String(member.id), email: emailChanged, mobile: mobileChanged },
        sent: { challengeId: challenge.challengeId, expiresIn: OTP_TTL_SECONDS, sentTo: maskPhone(nextMobile) },
      }
    }, { signal }))
  } catch (err) {
    // Two applicants racing for the same value: the unique index decides.
    const constraint = (err as { code?: string; constraint?: string })
    if (constraint?.code === '23505' && constraint.constraint === 'members_email_key') {
      throw refuse(PROBLEMS.EMAIL_IN_USE, 'This email address is already in use.')
    }
    if (constraint?.code === '23505' && constraint.constraint === 'members_mobile_unique') {
      throw refuse(PROBLEMS.MOBILE_IN_USE, 'This mobile number is already in use.')
    }
    throw err
  }

  // After the commit, and without the values themselves: the audit log holds
  // that contact details changed, never the details.
  await app.audit({
    action: 'membership_application_contact_changed', outcome: 'allowed', requestId,
    actorId: changed.memberId, actorKind: 'member',
    targetType: 'membership_application', targetId: changed.memberId,
  })
  return sent
}

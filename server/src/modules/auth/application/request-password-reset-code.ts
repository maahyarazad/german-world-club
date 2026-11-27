import { randomUUID } from 'node:crypto'
import { OTP_RESEND_COOLDOWN_SECONDS, PASSWORD_RESET_CODE_LENGTH } from '@gwc/contracts/auth'
import { query, withTransaction } from '../../../db/query.ts'
import { issueChallenge } from '../otp.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'

/**
 * Asking for a password-reset code from the app (feature 043).
 *
 * THE ANSWER IS THE SAME FOR EVERYONE. This route is unauthenticated, so anything
 * that differs between "an account matched" and "nothing matched" is an
 * account-existence oracle: the status, the body, a field that is present for one
 * and absent for the other, and, less obviously, the TIME the request takes. So an
 * identifier that matches nobody, a member with no verified number, a locked or ended
 * member, a merchant or staff account, a number the club does not text, and a text
 * the provider could not send all answer exactly like the one case that does send:
 * `202 { requested, challengeId, cooldownSeconds }`, where `challengeId` is a random
 * uuid for everyone but the member who really got a code (research R5).
 *
 * That uuid is where the next leak would be, because it is later presented to
 * `/auth/otp/resend` and `/auth/password-reset/code/confirm`. Neither may treat a real
 * challenge differently from an unknown one; see research R17 and the notes there.
 *
 * THE TEXT IS SENT AFTER THE REPLY, not before it. A send takes hundreds of
 * milliseconds and only happens for a real member, so awaiting it would turn the
 * response time into the oracle the body was careful not to be. The price is that a
 * failed send is logged (masked, without the number or the code) and not shown: the
 * person sees the same screen as always and asks again, which is what they would do
 * with any text that never arrives.
 */

export type ResetIdentifier = { email: string } | { mobile: string }

export type ResetContext = {
  /** The member the identifier resolved to, whether or not a code may be sent to them. */
  memberId: string | null
  /** May a code be sent: an active or inactive member with a verified mobile number. */
  eligible: boolean
  /**
   * What the per-number limiter buckets on. The member's NUMBER when the identifier
   * resolved to a member who has one, so asking by email, by number and asking again
   * all draw on one hourly budget; otherwise the identifier itself, so an identifier
   * that matches nobody is limited after exactly three asks like a real one, and the
   * limit cannot be used to find out which accounts exist.
   */
  phoneKey: string
}

export type PasswordResetCodeAnswer = {
  requested: true
  challengeId: string
  cooldownSeconds: number
}

const answer = (challengeId: string): PasswordResetCodeAnswer =>
  ({ requested: true, challengeId, cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS })

/** The statuses that may reset: an inactive member is reactivated by completing one (section 3.2). */
const RESETTABLE = new Set(['active', 'inactive'])

const isEligible = (row: { mobile: string | null; mobile_verified_at: unknown; status: string } | undefined) =>
  !!row && row.mobile != null && row.mobile_verified_at != null && RESETTABLE.has(row.status)

/**
 * Resolve who was asked about, BEFORE the per-number limiter runs (the route's
 * `preHandler` calls this, the same pattern as `loadOtpResendContext`): the limiter's
 * key is the member's number, which is not in the request body.
 *
 * Members only. Merchant, partner and staff accounts have no verified mobile number
 * on file and keep resetting through the emailed link on the website; they are
 * answered like everyone who does not match (spec decision 2).
 */
export async function resolveResetContext(
  app: GwcApp,
  identifier: ResetIdentifier,
  signal?: AbortSignal,
): Promise<ResetContext> {
  const byEmail = 'email' in identifier
  // `members.email` is citext, so the case does not matter; trimmed because a pasted
  // address often carries a space.
  const value = byEmail ? identifier.email.trim().toLowerCase() : identifier.mobile
  const { rows } = await query(
    app.pg,
    byEmail
      ? 'SELECT id, mobile, mobile_verified_at, status FROM members WHERE email = $1'
      : 'SELECT id, mobile, mobile_verified_at, status FROM members WHERE mobile = $1',
    [value],
    { signal },
  )
  const member = rows[0] as { id: string; mobile: string | null; mobile_verified_at: unknown; status: string } | undefined
  return {
    memberId: member?.id ?? null,
    eligible: isEligible(member),
    phoneKey: member?.mobile ?? value,
  }
}

export async function requestPasswordResetCode(
  app: GwcApp,
  { context, deviceId }: { context: ResetContext; deviceId: string },
): Promise<PasswordResetCodeAnswer> {
  // Everyone who is not about to get a code is answered with an id no code belongs to.
  if (!context.eligible || !context.memberId) return answer(randomUUID())
  const memberId = context.memberId

  const issued = await withTransaction(app.pg, async (client: PoolClient) => {
    // One live code per member. The row lock serialises two simultaneous asks, so each
    // sees the other's challenge and retires it: without it both would insert and both
    // codes would be live. The row is read again under the lock because the member may
    // have been locked, or changed their number, since the preHandler looked.
    const { rows } = await client.query(
      'SELECT mobile, mobile_verified_at, status FROM members WHERE id = $1 FOR UPDATE',
      [memberId],
    )
    if (!isEligible(rows[0])) return null

    await client.query(
      `UPDATE otp_challenges SET consumed_at = now()
        WHERE account_id = $1 AND account_kind = 'member'
          AND purpose = 'password_reset' AND consumed_at IS NULL`,
      [memberId],
    )
    // A PoolClient means this challenge commits or rolls back with the rest.
    const challenge = await issueChallenge(client, {
      accountId: memberId, accountKind: 'member', deviceId,
      purpose: 'password_reset', digits: PASSWORD_RESET_CODE_LENGTH,
    })
    return { ...challenge, mobile: rows[0].mobile as string }
  })
  if (!issued) return answer(randomUUID())

  // After the commit, and not awaited (see the header). `sendOtp` applies the country
  // policy and the provider call; a refusal or a failure lands here, is logged without
  // the number, the code or the error's text, and is not shown to anyone.
  void app.sendOtp({ mobile: issued.mobile, code: issued.code, route: 'auth.password-reset', accountId: memberId })
    .catch((err: { name?: string }) => {
      app.log.warn(
        { route: 'auth.password-reset', accountId: memberId, errorName: err?.name ?? 'Error' },
        'PASSWORD_RESET_SMS_NOT_SENT',
      )
    })

  return answer(issued.challengeId)
}

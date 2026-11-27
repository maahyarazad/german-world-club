import { PROBLEMS } from '@gwc/contracts/errors'
import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { hashPassword } from '../passwords.ts'
import { OTP_OUTCOME, verifyChallenge } from '../otp.ts'
import { applyNewPassword, endAllSessions } from './finish-password-reset.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'

/**
 * Completing a password reset with the code that was texted (feature 043): the code and
 * the new password in one request, so nobody is left with a spent code and no password.
 *
 * ONE ANSWER FOR EVERY FAILURE. A wrong, expired, already used or exhausted code, one for
 * another device or another purpose, an id that never existed, and a member who was locked
 * or ended after asking are all `401 invalid-otp`, with the same text. The server's usual
 * answers (`410` for expired, `429` for "too many tries") would let a caller tell a real
 * challenge from the random one a non-matching identifier is given, and so learn who has an
 * account (research R17). The attempt counter and the five-try ceiling still work exactly
 * as before; they just do not announce themselves, and the app shows one message.
 *
 * THE ORDER IS THE POINT. The code is verified FIRST, then the password is hashed: a wrong
 * code costs the server nothing (argon2id is deliberately slow) and spends only a guess.
 * The body was validated before this runs, so a password that is too short has already been
 * refused with a `400` that spent no guess at all. The password changes only for the member
 * the CHALLENGE names, never one named in the request, and only if they can still reset
 * (active or inactive): a member locked between asking and confirming is refused, which is
 * unlocking-by-side-effect prevented.
 */
const refusal = () => forbidden(PROBLEMS.INVALID_OTP, 'That code is not valid.')

export async function confirmPasswordResetCode(
  app: GwcApp,
  { challengeId, code, deviceId, password, requestId }: {
    challengeId: string
    code: string
    deviceId: string
    password: string
    requestId?: string | null
  },
): Promise<{ reset: true }> {
  const verified = await verifyChallenge(app.pg, { challengeId, code, deviceId, purposes: ['password_reset'] })
  if (verified.outcome !== OTP_OUTCOME.VERIFIED || verified.accountKind !== 'member') throw refusal()

  const passwordHash = await hashPassword(password)
  const changed = await withTransaction(app.pg, (client: PoolClient) =>
    applyNewPassword(client, {
      accountId: verified.accountId, accountKind: 'member', passwordHash, onlyStatuses: ['active', 'inactive'],
    }))
  if (changed === 0) throw refusal()

  await endAllSessions(app, { accountId: verified.accountId, accountKind: 'member', requestId, via: 'sms' })
  return { reset: true }
}

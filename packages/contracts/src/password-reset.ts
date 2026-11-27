import { z } from 'zod'
import { PASSWORD_RESET_CODE_LENGTH } from './auth.ts'
import { isValidMobileE164 } from './mobile.ts'

/**
 * Resetting a forgotten password in the app, with a code texted to the number on record
 * (feature 043). The request and confirm shapes the server's routes and the app both use.
 *
 * Its own module, not part of `auth.ts`, on purpose: validating a mobile number pulls in the
 * phone-number metadata library (`mobile.ts`), and `auth.ts` is imported by nearly every web page.
 * Putting these there made the web client load that library everywhere and slowed its tests until
 * they timed out. `onboarding.ts` is separate for the same reason. The one thing the rest of the
 * platform needs from here, the code's length, stays in `auth.ts` beside the other OTP constants.
 */

// Built from the constant so the length is written once. `[0-9]`, not `\d`, which
// in some engines also matches digits from other scripts.
const RESET_CODE = new RegExp('^[0-9]{' + PASSWORD_RESET_CODE_LENGTH + '}$')

const deviceIdSchema = z.string().min(1).max(128)

/**
 * One identifier, an email OR a mobile number, never both and never neither: a
 * union of two STRICT objects, so a body with both (or a stray key) matches
 * neither branch and is refused rather than quietly preferring one.
 *
 * The number is checked the way registration checks it (feature 031): the shape
 * first, then that it exists. The same rule on both sides means the app refuses
 * a number the SMS provider would, instead of the server calling that an outage.
 */
export const passwordResetCodeRequestSchema = z.union([
  z.strictObject({ email: z.string().email().max(320), deviceId: deviceIdSchema }),
  z.strictObject({
    mobile: z.string().refine(isValidMobileE164, 'must be a valid mobile number in international format'),
    deviceId: deviceIdSchema,
  }),
])

/**
 * The code and the new password in one request, so a person cannot be left with a
 * redeemed code and no new password. `deviceId` is part of the proof: a code asked
 * for on one device cannot be redeemed from another.
 */
export const passwordResetCodeConfirmSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(RESET_CODE, 'must be ' + PASSWORD_RESET_CODE_LENGTH + ' digits'),
  deviceId: deviceIdSchema,
  password: z.string().min(8).max(256),
})

/**
 * The answer to asking for a reset code. It is the SAME shape for every identifier,
 * including one that matches nobody, so it cannot say who has an account: for a
 * non-match `challengeId` is a random uuid that no code belongs to.
 */
export const passwordResetCodeAcceptedSchema = z.object({
  requested: z.literal(true),
  challengeId: z.string().uuid(),
  cooldownSeconds: z.number().int().nonnegative(),
})

export type PasswordResetCodeRequest = z.infer<typeof passwordResetCodeRequestSchema>
export type PasswordResetCodeAccepted = z.infer<typeof passwordResetCodeAcceptedSchema>
export type PasswordResetCodeConfirm = z.infer<typeof passwordResetCodeConfirmSchema>

import { z } from 'zod'
import { FLAGS, MODULES, TOKEN_AUDIENCES } from './permissions.ts'

/**
 * Authentication request and response schemas, imported by the API and by
 * every client (§12.15).
 *
 * The mechanism differs per face — cookies for browsers, bearer tokens for
 * mobile — but the rules are computed server-side and are identical for all
 * three, so no client can validate differently from the server.
 */

// --- Requests ---------------------------------------------------------------

export const signInRequestSchema = z.object({
  email: z.string().email().max(320),
  // The lower bound is a usability floor, not a security control: strength is
  // argon2id's job, and a hard maximum stops a megabyte-long password being a
  // free denial-of-service against a deliberately costly hash.
  password: z.string().min(8).max(256),
  deviceId: z.string().min(1).max(128).optional(),
})

export const verifyOtpRequestSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{4}$/, 'must be four digits'),
  deviceId: z.string().min(1).max(128),
})

export const resendOtpRequestSchema = z.object({
  challengeId: z.string().uuid(),
})

export const refreshRequestSchema = z.object({
  // Absent for a browser, which presents the token as a cookie.
  refreshToken: z.string().min(16).max(512).optional(),
})

export const passwordResetRequestSchema = z.object({
  email: z.string().email().max(320),
})

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(16).max(512),
  password: z.string().min(8).max(256),
})

// --- Responses --------------------------------------------------------------

/**
 * `principal` carries identity only — never permissions, never entitlement.
 * A client that needs capabilities calls `GET /auth/me`, which computes them at
 * request time.
 */
export const principalSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(TOKEN_AUDIENCES),
  displayName: z.string().nullable(),
})

/** The seven documented outcomes of `POST /auth/sign-in`. */
export const SIGN_IN_OUTCOMES = Object.freeze([
  'authenticated',
  'otp_required',
  'approval_pending',
  'profile_incomplete',
  'password_reset_required',
])

export const signInResponseSchema = z.object({
  outcome: z.enum(SIGN_IN_OUTCOMES),
  // Present only on `authenticated`, and only for a bearer client.
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().int().positive().optional(),
  principal: principalSchema.optional(),
  challengeId: z.string().uuid().optional(),
  // Masked. The full number is never echoed: sign-in is reachable before
  // authentication and would otherwise enumerate contact details.
  sentTo: z.string().optional(),
})

export const tokenPairResponseSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().int().positive(),
  principal: principalSchema.optional(),
})

export const resendOtpResponseSchema = z.object({
  resent: z.literal(true),
  cooldownSeconds: z.number().int().nonnegative(),
  /**
   * The challenge the NEW code belongs to. A resend mints a fresh challenge
   * (codes are stored hashed, so the old one cannot be re-sent), and without
   * its id a client could only submit the new code against the old challenge
   * — which is refused, every time. For a missing or spent challenge this is a
   * random id of the same shape, so the answer still does not say whether the
   * challenge existed.
   */
  challengeId: z.string().uuid(),
})

export const passwordResetAcceptedSchema = z.object({
  requested: z.literal(true),
})

/**
 * The double-submit token a browser echoes in `x-csrf-token`.
 *
 * Only the cookie face needs it. A bearer client has no ambient credential to
 * forge, so requiring one there would be a round trip for no security.
 */
export const csrfTokenResponseSchema = z.object({
  csrfToken: z.string().min(1),
})

const moduleGrantSchema = z.object(Object.fromEntries(FLAGS.map((f) => [f, z.boolean()])))

/**
 * `GET /auth/me` — the ONLY place capabilities and entitlement cross the wire,
 * and both are computed at request time.
 *
 * Clients use this to decide what to *display*. They never use it to decide
 * what is *allowed*: the server re-checks every operation. A client that hides
 * a button has made a UX decision, not a security one.
 */
export const meResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('member'),
    id: z.string().uuid(),
    displayName: z.string().nullable(),
    emailConfirmed: z.boolean(),
    permissions: z.array(z.string()),
    // Resolved from the membership card's validity window at point of use —
    // never from a token and never from a cached column, because a card that
    // lapses between sign-in and checkout must not still discount (§12.2).
    entitlement: z
      .object({
        package: z.number().int().min(1).max(3).nullable(),
        validUntil: z.string().nullable(),
        eventDiscountPct: z.number().nullable(),
      })
      .nullable(),
  }),
  z.object({
    kind: z.literal('admin'),
    id: z.string().uuid(),
    displayName: z.string().nullable(),
    isAdmin: z.boolean(),
    isSuperadmin: z.boolean(),
    modules: z.record(z.enum(MODULES), moduleGrantSchema),
  }),
])

// --- Token claims -----------------------------------------------------------

/**
 * The COMPLETE access-token claim set. Anything else is a contract violation.
 *
 * No permission flags, no role matrix, no membership tier, no email, no name.
 * `claims.test.js` asserts the exact key set, so a well-meaning addition fails
 * CI rather than silently becoming something a client relies on (FR-006,
 * FR-013).
 */
export const ACCESS_TOKEN_CLAIMS = Object.freeze(['sub', 'sid', 'aud', 'typ', 'jti', 'iat', 'exp'])

export const accessTokenClaimsSchema = z
  .object({
    sub: z.string().uuid(),
    sid: z.string().uuid(),
    aud: z.enum(TOKEN_AUDIENCES),
    typ: z.literal('access'),
    jti: z.string().min(16),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict()

export const ACCESS_TOKEN_TTL_SECONDS = 600
export const REFRESH_TTL_DAYS = Object.freeze({ web: 30, mobile: 90 })
export const OTP_TTL_SECONDS = 300
export const OTP_MAX_ATTEMPTS = 5
export const OTP_RESEND_COOLDOWN_SECONDS = 60
export const PASSWORD_RESET_TTL_SECONDS = 3600

/** Cookie names, shared so a client and the server cannot disagree. */
export const COOKIES = Object.freeze({ access: 'gwc_at', refresh: 'gwc_rt', csrf: 'gwc_csrf' })

// ---------------------------------------------------------------------------
// Types (feature 007). Derived from the schemas above so there is still exactly
// one definition per shape while both exist. T086 removes the schemas and these
// become the definition.
// ---------------------------------------------------------------------------

export type SignInRequest = z.infer<typeof signInRequestSchema>
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>
export type ResendOtpRequest = z.infer<typeof resendOtpRequestSchema>
export type RefreshRequest = z.infer<typeof refreshRequestSchema>
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>
export type Principal = z.infer<typeof principalSchema>
export type SignInResponse = z.infer<typeof signInResponseSchema>
export type TokenPairResponse = z.infer<typeof tokenPairResponseSchema>
export type ResendOtpResponse = z.infer<typeof resendOtpResponseSchema>
export type PasswordResetAccepted = z.infer<typeof passwordResetAcceptedSchema>
export type CsrfTokenResponse = z.infer<typeof csrfTokenResponseSchema>
export type MeResponse = z.infer<typeof meResponseSchema>
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>

import { z } from 'zod'
import { principalSchema } from './auth.ts'

/**
 * Onboarding, Phase 1 (feature 009): register → country → verify mobile →
 * verify email → wait for staff approval. The same flow on both faces: the
 * mobile app and the web console.
 *
 * The one difference between them is the device. The app sends `deviceId`,
 * which binds the application's approval to that phone (§6.1, §12.6) and gets
 * its session back as bearer tokens. The web sends none: its session arrives
 * as cookies, and approving a web application approves the member, not a
 * device — the web has no device binding anywhere on this platform.
 *
 * Staff approval is the gate, not an invitation (the business decision recorded
 * in specs/009-expo-client/spec.md). Registration is therefore open, and
 * everything an applicant can reach before approval is confined to
 * `/onboarding/*` — every other member route refuses them at the auth gate.
 */

/** `diverse` is the third legal gender entry in Germany; the club is German. */
export const GENDERS = Object.freeze(['female', 'male', 'diverse', 'prefer_not_to_say'] as const)

/**
 * Where an applicant is, derived from server state on every read — never
 * stored as its own column, so it cannot disagree with the facts it summarises.
 */
export const ONBOARDING_STEPS = Object.freeze([
  'verify_mobile',
  'verify_email',
  'awaiting_approval',
  'approved',
  'denied',
] as const)

/** Phase 2 profiling branches on this value (German vs. non-German residence). */
export const GERMANY = 'DE'

/**
 * Email codes are longer and live longer than SMS codes.
 *
 * Longer, because the person guessing is the applicant themselves — someone
 * registering with an address they do not own — and they hold a session, so
 * the ceiling is the only thing standing between them and a verified address
 * that belongs to somebody else. Longer-lived, because mail is queued (it is
 * never sent inside the request) and five minutes is less than a slow
 * provider's retry interval.
 */
export const EMAIL_CODE_LENGTH = 6
export const EMAIL_CODE_TTL_SECONDS = 1800

const E164 = /^\+[1-9][0-9]{6,14}$/

/** A calendar date, not an instant: a birthday has no time zone. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`)
    // Round-tripping rejects 2023-02-30, which Date would silently roll over.
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
  }, 'is not a real date')
  .refine((value) => value >= '1900-01-01' && new Date(`${value}T00:00:00Z`) < new Date(), 'must be in the past')

export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code')

export const registerRequestSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(256),
  mobile: z.string().regex(E164, 'must be in international format, e.g. +4915112345678'),
  birthday: isoDateSchema,
  gender: z.enum(GENDERS),
  countryOfResidence: countryCodeSchema,
  /** Mobile only. Absent marks the web face. */
  deviceId: z.string().min(1).max(128).optional(),
})

/**
 * The same shape whether or not the address was already taken.
 *
 * Registration is reachable before authentication, and an answer that differed
 * for a known address would turn it into a membership oracle. The owner of an
 * address that is already registered is told by mail instead.
 */
export const registerResponseSchema = z.object({
  challengeId: z.string().uuid(),
  expiresIn: z.number().int().positive(),
  /** Masked. The full number is never echoed pre-authentication. */
  sentTo: z.string(),
})

export const verifyMobileRequestSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{4}$/, 'must be four digits'),
  /** Must match the registration: present on mobile, absent on the web. */
  deviceId: z.string().min(1).max(128).optional(),
})

/**
 * A token pair, issued once the mobile number is proven.
 *
 * It opens `/onboarding/*` and nothing else until staff approve: the member
 * gates in 10-auth refuse an unapproved applicant on every other route. That is
 * what lets the app resume onboarding after a restart without a password.
 *
 * The tokens are in the body for the mobile face only. The web face receives
 * them as httpOnly cookies and never sees them — a token a page script can
 * read is a token any injected script can read too.
 */
export const verifyMobileResponseSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().int().positive(),
  principal: principalSchema,
})

export const emailCodeSentSchema = z.object({
  challengeId: z.string().uuid(),
  expiresIn: z.number().int().positive(),
  /** Masked, e.g. `j•••@example.com`. */
  sentTo: z.string(),
})

export const verifyEmailRequestSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`), `must be ${EMAIL_CODE_LENGTH} digits`),
})

export const onboardingStatusSchema = z.object({
  step: z.enum(ONBOARDING_STEPS),
  /** Only on `denied`. Staff must give one (§6.1), and it was also emailed. */
  denialReason: z.string().nullable(),
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
})

// --- Staff review -------------------------------------------------------------

export const APPLICATION_STATES = Object.freeze(['pending', 'approved', 'denied'] as const)

export const applicationSchema = z.object({
  memberId: z.string().uuid(),
  fullName: z.string().nullable(),
  email: z.string(),
  mobile: z.string().nullable(),
  birthday: z.string().nullable(),
  gender: z.string().nullable(),
  countryOfResidence: z.string().nullable(),
  /** Null when the application was made on the web. */
  deviceId: z.string().nullable(),
  state: z.enum(APPLICATION_STATES),
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  denialReason: z.string().nullable(),
})

export const applicationListSchema = z.object({ items: z.array(applicationSchema) })

export const denyApplicationRequestSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
})

export type Gender = (typeof GENDERS)[number]
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]
export type ApplicationState = (typeof APPLICATION_STATES)[number]
export type RegisterRequest = z.infer<typeof registerRequestSchema>
export type RegisterResponse = z.infer<typeof registerResponseSchema>
export type VerifyMobileRequest = z.infer<typeof verifyMobileRequestSchema>
export type VerifyMobileResponse = z.infer<typeof verifyMobileResponseSchema>
export type EmailCodeSent = z.infer<typeof emailCodeSentSchema>
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>
export type Application = z.infer<typeof applicationSchema>
export type DenyApplicationRequest = z.infer<typeof denyApplicationRequestSchema>

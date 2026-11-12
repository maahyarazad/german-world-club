import { z } from 'zod'

/**
 * Referral links and XP (feature 018, specs/018-referral-xp/).
 *
 * The server decides everything here: whether a code is valid, who a referral
 * belongs to, what it earned. What clients may do with these helpers is
 * *format* — show a typed code as `ABCD-EFGH` — never decide (Principle I). The
 * server normalises again on every request and is the authority.
 */

/**
 * Crockford base-32: digits and capitals without I, L, O and U.
 *
 * Read aloud across a table at an event, "I" and "1" and "O" and "0" are the
 * same sound; U is dropped so no code spells an obvious word by accident.
 */
export const REFERRAL_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const REFERRAL_CODE_LENGTH = 8

/** A normalised code, as stored. */
export const REFERRAL_CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/

/**
 * Turn whatever somebody typed into the stored form, or `null` if it cannot be
 * a code.
 *
 * Case and separators are forgiven, and the confusable letters map to the digit
 * they are mistaken for — someone who heard "I" and typed it should still land
 * on the right link. `null` is not a refusal the client shows: an invalid code
 * is sent like any other and ignored by the server (FR-006).
 */
export function normaliseReferralCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
  return REFERRAL_CODE.test(code) ? code : null
}

/** `ABCDEFGH` → `ABCD-EFGH`, for display. Anything that is not a code is returned as typed. */
export function formatReferralCode(code: string): string {
  const normalised = normaliseReferralCode(code)
  return normalised ? `${normalised.slice(0, 4)}-${normalised.slice(4)}` : code
}

/**
 * How far a referred person got. Computed on read from onboarding's own rows,
 * never stored (research R14): a stored stage is a second copy that would have
 * to be kept in step with every onboarding write.
 */
export const REFERRAL_STAGES = Object.freeze(['registered', 'approved', 'joined', 'did_not_join'] as const)
export type ReferralStage = (typeof REFERRAL_STAGES)[number]

/** Who can own a link: every principal that can sign in. `admin` is staff. */
export const REFERRAL_OWNER_KINDS = Object.freeze(['member', 'merchant', 'partner', 'admin'] as const)
export type ReferralOwnerKind = (typeof REFERRAL_OWNER_KINDS)[number]

const iso = z.string()
const reason = z.string().trim().min(1).max(500)

export const referralLinkSchema = z.object({
  /** Normalised; format it with `formatReferralCode` to show it. */
  code: z.string(),
  /** `https://<canonical>/r/<code>`. */
  url: z.string(),
  createdAt: iso,
})

export const stageCountsSchema = z.object({
  registered: z.number().int(),
  approved: z.number().int(),
  joined: z.number().int(),
  did_not_join: z.number().int(),
})

export const referralSummarySchema = z.object({
  link: referralLinkSchema,
  /** The sum of the owner's XP history. Never stored separately (FR-015). XP, not money (FR-016). */
  xpBalance: z.number().int(),
  counts: stageCountsSchema,
})

export const referralSchema = z.object({
  id: z.string().uuid(),
  /** Handle if the person has one, else "First L." — nothing else about them (FR-018). */
  refereeName: z.string(),
  stage: z.enum(REFERRAL_STAGES),
  registeredAt: iso,
  approvedAt: iso.nullable(),
  joinedAt: iso.nullable(),
  /** When the application was denied. Never why. */
  endedAt: iso.nullable(),
  /** The award this referral earned, net of any reversal. */
  xpAwarded: z.number().int(),
})

export const XP_ENTRY_KINDS = Object.freeze(['award', 'reversal'] as const)

export const xpEntrySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(XP_ENTRY_KINDS),
  /** Positive for an award, negative for a reversal. */
  amount: z.number().int(),
  /** `award`: "referral". `reversal`: the staff member's reason, verbatim. */
  reason: z.string(),
  referralId: z.string().uuid(),
  /** The referee's display name, so the history reads "Referral: Jana K." without a second request. */
  refereeName: z.string(),
  /** On a reversal, the award it cancels. */
  reversesEntryId: z.string().uuid().nullable(),
  /** On an award, whether it has been reversed — staff need it to hide Reverse. */
  reversed: z.boolean(),
  createdAt: iso,
})

/** Keyset-paged list. The cursor is opaque. */
export const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() })

export const referralPageSchema = pageOf(referralSchema)
export const xpEntryPageSchema = pageOf(xpEntrySchema)

export const pageQuerySchema = z.object({ cursor: z.string().max(200).optional() })

// --- Staff ---------------------------------------------------------------------

export const staffReferralOwnerSchema = z.object({
  ownerKind: z.enum(REFERRAL_OWNER_KINDS),
  ownerId: z.string().uuid(),
  name: z.string().nullable(),
  link: z.object({
    id: z.string().uuid(),
    code: z.string(),
    state: z.enum(['active', 'retired', 'disabled']),
  }).nullable(),
  xpBalance: z.number().int(),
  counts: stageCountsSchema,
})

export const staffOwnerQuerySchema = z.object({
  kind: z.enum(REFERRAL_OWNER_KINDS).optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(200).optional(),
})

export const disableLinkRequestSchema = z.object({ reason })
export const reverseXpRequestSchema = z.object({ reason })

export const XP_RATE_MIN = 1
export const XP_RATE_MAX = 100_000

export const xpRateSchema = z.object({
  xp: z.number().int(),
  effectiveFrom: iso,
  /** The staff member's name; `null` for the migration's initial rate. */
  setBy: z.string().nullable(),
  reason: z.string(),
})

export const setXpRateRequestSchema = z.object({
  xp: z.number().int().min(XP_RATE_MIN).max(XP_RATE_MAX),
  reason,
})

export type ReferralLink = z.infer<typeof referralLinkSchema>
export type StageCounts = z.infer<typeof stageCountsSchema>
export type ReferralSummary = z.infer<typeof referralSummarySchema>
export type Referral = z.infer<typeof referralSchema>
export type XpEntry = z.infer<typeof xpEntrySchema>
export type ReferralPage = z.infer<typeof referralPageSchema>
export type XpEntryPage = z.infer<typeof xpEntryPageSchema>
export type StaffReferralOwner = z.infer<typeof staffReferralOwnerSchema>
export type DisableLinkRequest = z.infer<typeof disableLinkRequestSchema>
export type ReverseXpRequest = z.infer<typeof reverseXpRequestSchema>
export type XpRate = z.infer<typeof xpRateSchema>
export type SetXpRateRequest = z.infer<typeof setXpRateRequestSchema>

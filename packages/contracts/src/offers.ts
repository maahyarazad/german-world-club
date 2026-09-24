import { z } from 'zod'
import { mediaItemSchema } from './media.ts'

/**
 * A merchant offer as a member sees it (feature 011, research R11).
 *
 * The minimum a push deep link needs to land on something real. No list
 * endpoint and no publishing route come with it: those belong to the merchant
 * portal. The merchant block is the public face from `organisation_profiles`
 * only — never `legal_name` or fee tier, which are contract data.
 */

export const BENEFIT_KINDS = Object.freeze(
  ['percentage', 'fixed_amount', 'member_price', 'value_add'] as const,
)
export type BenefitKind = (typeof BENEFIT_KINDS)[number]

export const memberOfferSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  benefit: z.object({
    kind: z.enum(BENEFIT_KINDS),
    /** A percentage for `percentage`, a currency amount otherwise; null when the kind needs none. */
    value: z.number().nullable(),
  }),
  regularPriceCents: z.number().int().nullable(),
  memberPriceCents: z.number().int().nullable(),
  currency: z.string(),
  validFrom: z.string(),
  validUntil: z.string(),
  conditions: z.string().nullable(),
  merchant: z.object({
    displayName: z.string(),
    slug: z.string(),
    /** A derivative, never the original upload. */
    logo: mediaItemSchema.nullable(),
  }),
})

export const offerIdParamSchema = z.object({ id: z.string().uuid() })

export type MemberOffer = z.infer<typeof memberOfferSchema>

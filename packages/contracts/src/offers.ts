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
  ['percentage', 'fixed_amount', 'member_price', 'value_add', 'freebie', 'bogo'] as const,
)
export type BenefitKind = (typeof BENEFIT_KINDS)[number]

/**
 * The kinds a merchant may choose for a NEW offer (feature 035, FR-007): a
 * discount (a percentage or a fixed amount), a freebie, or buy one get one.
 * `member_price` and `value_add` stay valid on offers that already have them,
 * but are not offered any more.
 */
export const NEW_OFFER_KINDS = Object.freeze(['percentage', 'fixed_amount', 'freebie', 'bogo'] as const)

/** An offer carries at most this many images and videos. */
export const MAX_OFFER_MEDIA = 10

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
  /** How many times one account may redeem it; null means no limit. */
  perPersonLimit: z.number().int().nullable(),
  category: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    nameDe: z.string(),
    nameEn: z.string(),
  }),
  /** The offer's images and videos in order, derivatives only. */
  media: z.array(mediaItemSchema),
  merchant: z.object({
    displayName: z.string(),
    slug: z.string(),
    /** A derivative, never the original upload. */
    logo: mediaItemSchema.nullable(),
  }),
})

export const offerIdParamSchema = z.object({ id: z.string().uuid() })

export type MemberOffer = z.infer<typeof memberOfferSchema>
export type OfferCategory = z.infer<typeof offerCategorySchema>
export type MerchantOffer = z.infer<typeof merchantOfferSchema>
export type CreateOfferRequest = z.infer<typeof createOfferRequestSchema>
export type UpdateOfferRequest = z.infer<typeof updateOfferRequestSchema>
export type OfferListItem = z.infer<typeof offerListItemSchema>
export type BrowseCategory = z.infer<typeof browseCategorySchema>

// ---------------------------------------------------------------------------
// Categories (feature 035)
// ---------------------------------------------------------------------------

export const offerCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  nameDe: z.string(),
  nameEn: z.string(),
  position: z.number().int(),
  visible: z.boolean(),
  /** Offers filed under it. Staff see every category with its count. */
  offerCount: z.number().int(),
})

export const offerCategoryListSchema = z.object({ items: z.array(offerCategorySchema) })

export const createOfferCategoryRequestSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'lower case letters, digits and hyphens'),
  nameDe: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().min(1).max(80),
})

export const updateOfferCategoryRequestSchema = z.object({
  nameDe: z.string().trim().min(1).max(80).optional(),
  nameEn: z.string().trim().min(1).max(80).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  visible: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// Merchant offers (feature 035)
// ---------------------------------------------------------------------------

/** What a merchant sets on an offer. Prices are in the currency's minor unit. */
const offerFields = {
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  /**
   * Optional in the shape on purpose: a missing category is the specific refusal
   * `offer-category-required` (422), which the clients can say something useful
   * about, rather than a generic field error.
   */
  categoryId: z.string().uuid().nullable().optional(),
  benefitKind: z.enum(NEW_OFFER_KINDS),
  /** A percentage (1-100) for `percentage`, a currency amount for `fixed_amount`; null otherwise. */
  benefitValue: z.number().positive().nullable().optional(),
  regularPriceCents: z.number().int().positive().nullable().optional(),
  memberPriceCents: z.number().int().positive().nullable().optional(),
  currency: z.string().length(3).optional(),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime(),
  conditions: z.string().trim().max(2000).nullable().optional(),
  /** Units available in total; null means unlimited. */
  remaining: z.number().int().positive().nullable().optional(),
  /** Per account; null means unlimited. */
  perPersonLimit: z.number().int().positive().nullable().optional(),
}

export const createOfferRequestSchema = z.object(offerFields)

export const updateOfferRequestSchema = createOfferRequestSchema.partial().extend({
  /** The offer's `updated_at` to the microsecond: a stale edit is a 409. */
  version: z.string(),
})

export const setOfferMediaRequestSchema = z.object({
  /** Replaces the whole set; the order given is the display order, the first leads. */
  /**
   * Bounded loosely here on purpose: more than `MAX_OFFER_MEDIA` is the specific
   * refusal `offers/media-limit` (422) from the application, which says what the
   * limit is, rather than a generic 400 from the shape check.
   */
  assetIds: z.array(z.string().uuid()).max(100),
})

export const setOfferOrderRequestSchema = z.object({ ids: z.array(z.string().uuid()).max(500) })

export const OFFER_STATES = Object.freeze(['draft', 'pending', 'published', 'rejected', 'withdrawn'] as const)

/** An offer as its own merchant sees it, in any state. */
export const merchantOfferSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(OFFER_STATES),
  title: z.string(),
  description: z.string().nullable(),
  categoryId: z.string().uuid(),
  benefit: z.object({ kind: z.enum(BENEFIT_KINDS), value: z.number().nullable() }),
  regularPriceCents: z.number().int().nullable(),
  memberPriceCents: z.number().int().nullable(),
  currency: z.string(),
  validFrom: z.string(),
  validUntil: z.string(),
  conditions: z.string().nullable(),
  remaining: z.number().int().nullable(),
  perPersonLimit: z.number().int().nullable(),
  sortPosition: z.number().int(),
  publishedAt: z.string().nullable(),
  media: z.array(mediaItemSchema),
  /** The offer's `updated_at` to the microsecond. */
  version: z.string(),
})

export const merchantOfferListSchema = z.object({ items: z.array(merchantOfferSchema) })

// ---------------------------------------------------------------------------
// Browsing (feature 035): every account kind sees the same list
// ---------------------------------------------------------------------------

export const offerListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  benefit: z.object({ kind: z.enum(BENEFIT_KINDS), value: z.number().nullable() }),
  currency: z.string(),
  validUntil: z.string(),
  categoryId: z.string().uuid(),
  /** True when no unit remains: shown as sold out, and redemption is refused. */
  soldOut: z.boolean(),
  /** A derivative of the lead image (a video's poster), or null. Never an original. */
  thumbnail: mediaItemSchema.nullable(),
  merchant: z.object({ displayName: z.string(), slug: z.string(), logo: mediaItemSchema.nullable() }),
})

export const offerListSchema = z.object({
  items: z.array(offerListItemSchema),
  nextCursor: z.string().nullable(),
})

export const offerListQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  cursor: z.string().optional(),
})

export const browseCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  nameDe: z.string(),
  nameEn: z.string(),
  /** Visible offers in it right now. */
  offerCount: z.number().int(),
})

export const browseCategoryListSchema = z.object({ items: z.array(browseCategorySchema) })

import { z } from 'zod'
import { mediaItemSchema } from './media.ts'

/**
 * A merchant's store (feature 035, specs/035-merchant-store-offers).
 *
 * One per merchant organisation, enforced by the database. Name and logo come
 * from the organisation's public profile, so a rename there is one change, and
 * no contract data (`legal_name`, fee tier) can reach a store payload.
 */

/** A store as its own merchant sees it. */
export const storeSchema = z.object({
  id: z.string().uuid(),
  /** From the organisation profile; null until the merchant has set a public name. */
  displayName: z.string().nullable(),
  logo: mediaItemSchema.nullable(),
  description: z.string().nullable(),
  /** A wide image shown across the top. Derivatives only. */
  cover: mediaItemSchema.nullable(),
  /** The gallery, in order. At most `MAX_STORE_MEDIA`. Derivatives only. */
  media: z.array(mediaItemSchema),
  openingHours: z.string().nullable(),
  active: z.boolean(),
  /**
   * A code, never staff's free-text reason: the console translates it. Null
   * while the store is active.
   */
  deactivationNotice: z.enum(['deactivated']).nullable(),
  /** The edit-conflict version: the row's `updated_at` to the microsecond. */
  version: z.string(),
})

export const createStoreRequestSchema = z.object({
  description: z.string().trim().max(2000).nullable().optional(),
  openingHours: z.string().trim().max(500).nullable().optional(),
})

export const updateStoreRequestSchema = z.object({
  version: z.string(),
  description: z.string().trim().max(2000).nullable().optional(),
  openingHours: z.string().trim().max(500).nullable().optional(),
})

export const setStoreCoverRequestSchema = z.object({ assetId: z.string().uuid().nullable() })

export const setStoreMediaRequestSchema = z.object({
  /** Replaces the whole gallery; the order given is the display order. */
  /** Bounded loosely: more than `MAX_STORE_MEDIA` is the application's 422 `offers/media-limit`. */
  assetIds: z.array(z.string().uuid()).max(100),
})

/**
 * A store as any other signed-in account sees it, one tap from an offer
 * (feature 035 follow-up). The wide cover, the description, the opening hours and
 * the gallery — and nothing that is the merchant's or the club's business: no
 * version, no active flag (an inactive store is a 404, not a notice), no contract
 * data. Derivatives only.
 */
export const storeProfileSchema = z.object({
  displayName: z.string(),
  /** The organisation's slug: the same one an offer's `merchant` block carries. */
  slug: z.string(),
  logo: mediaItemSchema.nullable(),
  description: z.string().nullable(),
  cover: mediaItemSchema.nullable(),
  media: z.array(mediaItemSchema),
  openingHours: z.string().nullable(),
})

export const storeSlugParamSchema = z.object({ slug: z.string().min(1).max(200) })

/** A store as staff see it in the list. */
export const adminStoreSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  displayName: z.string().nullable(),
  slug: z.string(),
  active: z.boolean(),
  deactivatedAt: z.string().nullable(),
  deactivationReason: z.string().nullable(),
  offerCount: z.number().int(),
})

export const adminStoreListSchema = z.object({ items: z.array(adminStoreSchema) })

/**
 * `active` is accepted as a boolean or as 0 / 1, because the club's staff set
 * the flag "to false or 0". Everything is normalised to a boolean here, once,
 * so no handler has to know that two spellings exist.
 */
export const setStoreActiveRequestSchema = z.object({
  active: z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => v === true || v === 1),
  /** Required when deactivating; the handler enforces it, because it depends on the value. */
  reason: z.string().trim().min(3).max(2000).optional(),
})

export const storeIdParamSchema = z.object({ id: z.string().uuid() })

export type Store = z.infer<typeof storeSchema>
export type StoreProfile = z.infer<typeof storeProfileSchema>
export type AdminStore = z.infer<typeof adminStoreSchema>
export type CreateStoreRequest = z.infer<typeof createStoreRequestSchema>
export type UpdateStoreRequest = z.infer<typeof updateStoreRequestSchema>
export type SetStoreActiveRequest = z.infer<typeof setStoreActiveRequestSchema>

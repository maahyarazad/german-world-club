import { z } from 'zod'

/**
 * Media ingest and delivery contracts (media-pipeline.md).
 *
 * Shared by the API, the web client and the mobile app. Constitution Principle
 * I: one definition, imported everywhere, so a field renamed here is a type
 * error in every consumer rather than a runtime surprise in one of them.
 */

export const ASSET_KINDS = Object.freeze(['image', 'video'])
export const ASSET_STATES = Object.freeze(['processing', 'ready', 'failed'])
export const VARIANTS = Object.freeze(['thumb', 'small', 'medium', 'large', 'poster', 'video'])
export const FORMATS = Object.freeze(['webp', 'png', 'jpeg', 'webm'])

/** Width caps, mirrored from derive-image.js so clients can build a srcset. */
export const BREAKPOINT_WIDTHS = Object.freeze({ thumb: 160, small: 400, medium: 800, large: 1600 })

/** The 25 MB streaming cap and the pixel bound, so a client can refuse early. */
export const MEDIA_MAX_BYTES = 26_214_400
export const MEDIA_MAX_PIXELS = 50_000_000

/**
 * §10.1 calls out galleries needing alt text, so `alt` is required at ingest
 * rather than nullable-and-backfilled. An image with no alt text is one that
 * cannot be published, and discovering that at publish time means going back to
 * whoever uploaded it weeks earlier.
 */
export const altSchema = z.string().trim().min(1).max(300)

export const variantSchema = z.object({
  variant: z.enum(VARIANTS),
  format: z.enum(FORMATS),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  url: z.string(),
})

export const assetSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(ASSET_KINDS),
  mime: z.string(),
  // Present even while a video is `processing`, because §10.9's layout-shift
  // requirement needs dimensions at first render and cannot wait for a
  // transcode (FR-055).
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().positive().nullable().optional(),
  alt: altSchema,
  state: z.enum(ASSET_STATES),
  failureReason: z.string().nullable().optional(),
  bytes: z.number().int().positive(),
  createdAt: z.string(),
  variants: z.array(variantSchema),
})

/** 201 for an image (every variant present), 202 for a queued video. */
export const uploadAcceptedSchema = assetSchema

export const uploadRequestSchema = z.object({
  alt: altSchema,
  kind: z.enum(ASSET_KINDS).optional(),
})

export const assetIdParamSchema = z.object({ id: z.string().uuid() })

/**
 * The strict shape of a delivery URL. For clients *constructing* one — a
 * checksum that does not match this can never address a stored variant.
 */
export const deliveryParamSchema = z.object({
  checksum: z.string().regex(/^[0-9a-f]{64}$/, 'a content-addressed sha256 hex digest'),
  variant: z.enum(VARIANTS),
  ext: z.enum(['webp', 'png', 'jpg', 'jpeg', 'webm']),
})

/**
 * The shape the *server* validates against, deliberately permissive.
 *
 * A malformed checksum is not a malformed request — it is a URL that names
 * nothing, and §10.6 requires those to answer an honest 404. Validating with
 * the strict schema above would return 400 to a crawler following a stale link,
 * which is both wrong and a soft-404 in the other direction: a 400 is not a
 * signal to drop the URL from an index, and the URL is never coming back.
 */
export const deliveryLookupParamSchema = z.object({
  checksum: z.string(),
  variant: z.string(),
  ext: z.string(),
})

export const deleteResultSchema = z.object({
  id: z.string().uuid(),
  deleted: z.literal(true),
  /**
   * False when another asset shares the checksum: content-addressed storage
   * means the bytes are still in use, and removing them would break the other
   * asset's URLs.
   */
  bytesRemoved: z.boolean(),
})

/** Immutable because the path is content-addressed — see media-pipeline.md §2. */
export const DELIVERY_CACHE_CONTROL = 'public, max-age=31536000, immutable'

// ---------------------------------------------------------------------------
// Types (feature 007). Derived from the schemas above so there is still exactly
// one definition per shape while both exist. T086 removes the schemas and these
// become the definition.
// ---------------------------------------------------------------------------

export type Alt = z.infer<typeof altSchema>
export type Variant = z.infer<typeof variantSchema>
export type Asset = z.infer<typeof assetSchema>
export type UploadAccepted = z.infer<typeof uploadAcceptedSchema>
export type UploadRequest = z.infer<typeof uploadRequestSchema>
export type AssetIdParam = z.infer<typeof assetIdParamSchema>
export type DeliveryParam = z.infer<typeof deliveryParamSchema>
export type DeliveryLookupParam = z.infer<typeof deliveryLookupParamSchema>
export type DeleteResult = z.infer<typeof deleteResultSchema>

/**
 * Member marketplace — the shapes the server and every client share
 * (BUSINESS_DESCRIPTION.md §7, feature 008).
 *
 * The category field definitions live here rather than in either client
 * because the console's compose form and the server's validation must be the
 * same definition (Principle I). A client MAY shape its form from this; it is
 * never the enforcement point. The server reads the same definitions in
 * `server/src/modules/marketplace/categories.ts`.
 */

// ---------------------------------------------------------------------------
// Enumerations the server branches on
// ---------------------------------------------------------------------------

export const MARKETPLACE_CATEGORIES = Object.freeze(
  ['vehicle', 'property', 'job', 'general'] as const,
)
export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number]

/** Every listing is one or the other (FR-007). */
export const MARKETPLACE_MODES = Object.freeze(['offer', 'request'] as const)
export type MarketplaceMode = (typeof MARKETPLACE_MODES)[number]

/**
 * `sold` and `filled` are both terminal successes and both exist because they
 * are not the same event — a vehicle sells, a job is filled. `hidden` is
 * reachable only by moderation, and is separate from `withdrawn` so the owner
 * can see it was hidden rather than find it silently gone.
 */
export const MARKETPLACE_STATES = Object.freeze(
  ['draft', 'active', 'sold', 'filled', 'withdrawn', 'expired', 'hidden'] as const,
)
export type MarketplaceState = (typeof MARKETPLACE_STATES)[number]

/** A contact *preference*. The value it resolves to is never stored on a listing. */
export const CONTACT_METHODS = Object.freeze(
  ['platform_message', 'email_relay', 'phone'] as const,
)
export type ContactMethod = (typeof CONTACT_METHODS)[number]

export const GENERAL_KINDS = Object.freeze(['product', 'service'] as const)
export type GeneralKind = (typeof GENERAL_KINDS)[number]

export const REPORT_STATES = Object.freeze(['open', 'upheld', 'dismissed'] as const)
export type ReportState = (typeof REPORT_STATES)[number]

/** States a listing is visible in the member index in. */
export const VISIBLE_STATES = Object.freeze(['active'] as const)

/** Only the owner may reach these, and only from `active`. */
export const OWNER_TERMINAL_STATES = Object.freeze(
  ['sold', 'filled', 'withdrawn'] as const,
)

// ---------------------------------------------------------------------------
// Category field definitions — one definition, two readers
// ---------------------------------------------------------------------------

export type FieldKind =
  | 'text' | 'integer' | 'decimal' | 'money' | 'enum' | 'date' | 'boolean'

export type FieldDef = {
  key: string
  kind: FieldKind
  required: boolean
  /** Enumerations the SERVER branches on. Display labels are client-side i18n. */
  options?: readonly string[]
  min?: number
  max?: number
  /**
   * Whether the index may filter on it.
   *
   * Declared here rather than only in the UI because a filter with no index
   * behind it is a sequential scan that looks fine until the corpus grows.
   * `tests/marketplace/definitions.test.ts` asserts every filterable field has
   * a backing index in 019_marketplace.sql.
   */
  filterable?: boolean
}

export type CategoryDef = {
  category: MarketplaceCategory
  fields: readonly FieldDef[]
}

/** Money is always integer minor units plus a currency, never a float. */
const money = (key: string, required = false): FieldDef =>
  ({ key, kind: 'money', required, min: 0, filterable: true })

/**
 * Declared before freezing so the object literal gets its contextual type.
 * `Object.freeze` on a bare literal infers `kind: string`, which does not
 * satisfy `FieldKind` — the annotation has to reach the literal, not the
 * frozen result.
 */
const DEFS: Record<MarketplaceCategory, CategoryDef> = {
    vehicle: {
      category: 'vehicle',
      fields: Object.freeze([
        { key: 'make', kind: 'text', required: true, max: 60, filterable: true },
        { key: 'model', kind: 'text', required: false, max: 60 },
        { key: 'year', kind: 'integer', required: false, min: 1900, max: 2100 },
        { key: 'mileage_km', kind: 'integer', required: false, min: 0 },
        money('price_minor'),
        { key: 'fuel', kind: 'enum', required: false,
          options: Object.freeze(['petrol', 'diesel', 'hybrid', 'electric', 'other']) },
        { key: 'transmission', kind: 'enum', required: false,
          options: Object.freeze(['manual', 'automatic']) },
        { key: 'body_type', kind: 'text', required: false, max: 40 },
        { key: 'condition', kind: 'enum', required: false,
          options: Object.freeze(['new', 'used']) },
      ]),
    },

    property: {
      category: 'property',
      fields: Object.freeze([
        // NOT the same axis as `mode`: a *request* to *rent* is coherent, and
        // collapsing the two would make it unexpressible.
        { key: 'deal', kind: 'enum', required: true,
          options: Object.freeze(['rent', 'sale']), filterable: true },
        // Half-rooms are a real German convention.
        { key: 'rooms', kind: 'decimal', required: false, min: 0, filterable: true },
        { key: 'size_sqm', kind: 'decimal', required: false, min: 0 },
        money('price_minor'),
        { key: 'city', kind: 'text', required: true, max: 80, filterable: true },
        { key: 'postal_code', kind: 'text', required: false, max: 12 },
        { key: 'available_from', kind: 'date', required: false },
      ]),
    },

    job: {
      category: 'job',
      fields: Object.freeze([
        { key: 'employment_type', kind: 'enum', required: true,
          options: Object.freeze(['full_time', 'part_time', 'contract', 'internship']) },
        { key: 'seniority', kind: 'enum', required: false,
          options: Object.freeze(['junior', 'mid', 'senior', 'lead']), filterable: true },
        { key: 'department', kind: 'text', required: false, max: 80 },
        { key: 'city', kind: 'text', required: true, max: 80, filterable: true },
        { key: 'remote', kind: 'enum', required: false,
          options: Object.freeze(['onsite', 'hybrid', 'remote']) },
        money('salary_min_minor'),
        money('salary_max_minor'),
      ]),
    },

    /**
     * Deliberately the loosest of the four.
     *
     * `general` exists so an arbitrary product or service has somewhere to go,
     * and over-structuring it would defeat that — a member selling a bicycle
     * repair service should not be asked for a mileage.
     */
    general: {
      category: 'general',
      fields: Object.freeze([
        { key: 'kind', kind: 'enum', required: true,
          options: GENERAL_KINDS, filterable: true },
        money('price_minor'),
        { key: 'condition', kind: 'enum', required: false,
          options: Object.freeze(['new', 'used', 'n/a']) },
      ]),
    },
}

export const CATEGORY_DEFS: Readonly<Record<MarketplaceCategory, CategoryDef>> =
  Object.freeze(DEFS)

/** Required field keys for a category — what the server refuses without. */
export const requiredFieldsFor = (category: MarketplaceCategory): readonly string[] =>
  CATEGORY_DEFS[category].fields.filter((f) => f.required).map((f) => f.key)

/** Filterable field keys — must each have a backing index. */
export const filterableFieldsFor = (category: MarketplaceCategory): readonly string[] =>
  CATEGORY_DEFS[category].fields.filter((f) => f.filterable).map((f) => f.key)

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/**
 * One media item on a listing.
 *
 * A listing may carry one photo, several photos, or a video (FR-039). `url` is
 * always a DERIVATIVE — the original is never served. For a video the index
 * uses `posterUrl`, so a browse page never autoplays and never waits on a
 * transcode (FR-040).
 */
export type ListingMedia = {
  assetId: string
  kind: 'image' | 'video'
  position: number
  url: string
  posterUrl?: string
  width?: number
  height?: number
}

/**
 * How to reach the seller.
 *
 * An affordance, never a value. The listing stores a *preference*; the server
 * resolves it against the owner's §7 privacy settings at render time and omits
 * what they do not permit. No email address or phone number appears here.
 */
export type ContactAffordance = {
  method: ContactMethod
  available: boolean
}

/** The category-specific block. Which one is present follows `category`. */
export type ListingDetails = Record<string, unknown>

export type Listing = {
  id: string
  category: MarketplaceCategory
  mode: MarketplaceMode
  title: string
  body: string
  state: MarketplaceState
  /** Display identity only — never the owner's contact details. */
  owner: { id: string; displayName: string }
  media: readonly ListingMedia[]
  details: ListingDetails
  /** Present on vehicles only; keys from the live catalogue. */
  features?: readonly string[]
  contact: ContactAffordance
  createdAt: string
  publishedAt?: string | null
  /** Null means unlimited — a choice, not a missing value (FR-028). */
  expiresAt?: string | null
}

export type CreateListingRequest = {
  category: MarketplaceCategory
  mode: MarketplaceMode
  title: string
  body: string
  details: ListingDetails
  features?: readonly string[]
  contactMethod?: ContactMethod
  /** Omit or send null for unlimited. */
  expiresAt?: string | null
  termsVersion: string
}

export type ListingQuery = {
  category?: MarketplaceCategory
  mode?: MarketplaceMode
  cursor?: string
  /** Coerced, defaulted to 20 and bounded at 50 IN THE HANDLER, not only here. */
  limit?: number
  [filter: string]: unknown
}

export type ListingPage = {
  items: readonly Listing[]
  nextCursor: string | null
}

export type VehicleFeature = {
  key: string
  group: string
  position: number
}

export type CategoriesResponse = {
  categories: readonly CategoryDef[]
  vehicleFeatures: readonly VehicleFeature[]
}

export type ReportRequest = { reason: string }

export type TermsResponse = { version: string; acceptedVersion: string | null }

/** Aggregate counts for the public discovery page. No listing ever appears. */
export type MarketplaceSummary = {
  total: number
  byCategory: Readonly<Record<MarketplaceCategory, number>>
}

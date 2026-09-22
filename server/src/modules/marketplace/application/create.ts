import { PROBLEMS } from '@gwc/contracts/errors'
import { withTransaction } from '../../../db/query.ts'
import { reserve, SCOPE, QuotaExceededError } from '../../../db/counters.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { validateDetails, detailColumns } from '../categories.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'
import type {
  CreateListingRequest, MarketplaceCategory,
} from '@gwc/contracts/marketplace'

/**
 * Creating a listing (§7, FR-001…FR-002, FR-021, FR-028).
 *
 * Framework-free: takes `app` plus plain data, returns plain data. The
 * `marketplace_post` flag is NOT checked here — it is declared on the route as
 * `config.auth.requires`, which `plugins/10-auth.ts` resolves from server-held
 * state per request and audits on denial. Checking it twice would put the rule
 * in two places, and the route declaration is the one that shows up in a diff.
 */

/** How many live listings one member may hold. Configuration, not a constant of nature. */
export const DEFAULT_LISTING_QUOTA = 20

export type CreateInput = CreateListingRequest & {
  memberId: string
  requestId?: string
  signal?: AbortSignal
}

/** Raised when the member has not accepted the current terms (FR-002). */
export class TermsNotAcceptedError extends Error {
  readonly currentVersion: string
  constructor(currentVersion: string) {
    super('The current marketplace terms have not been accepted.')
    this.name = 'TermsNotAcceptedError'
    this.currentVersion = currentVersion
  }
}

/** Raised when the category's own fields do not validate (FR-009). */
export class DetailsInvalidError extends Error {
  readonly problems: { field: string; reason: string }[]
  constructor(problems: { field: string; reason: string }[]) {
    super(`Invalid ${problems.length === 1 ? 'field' : 'fields'}: ${problems.map((p) => p.field).join(', ')}`)
    this.name = 'DetailsInvalidError'
    this.problems = problems
  }
}

/** The terms version currently in force. */
export const currentTermsVersion = (app: GwcApp): string =>
  String(app.env.MARKETPLACE_TERMS_VERSION ?? 'v1')

export async function createListing(app: GwcApp, input: CreateInput) {
  const {
    memberId, category, mode, title, body, details = {}, features = [],
    contactMethod = 'platform_message', expiresAt = null, termsVersion, signal,
  } = input

  const current = currentTermsVersion(app)

  // The version the client claims to accept must be the current one, AND the
  // member must actually have accepted it. Checking only the payload would let
  // a client assert acceptance it never made.
  if (termsVersion !== current) throw new TermsNotAcceptedError(current)

  const problems = validateDetails(category as MarketplaceCategory, details)
  if (problems.length > 0) throw new DetailsInvalidError(problems)

  return withTransaction(app.pg, async (client: PoolClient) => {
    const { rows: accepted } = await client.query(
      'SELECT 1 FROM marketplace_terms_acceptances WHERE member_id = $1 AND version = $2',
      [memberId, current],
    )
    if (accepted.length === 0) throw new TermsNotAcceptedError(current)

    // A business quota, under a row lock. Not the rate limiter: retrying
    // changes nothing until the member withdraws something, which is why this
    // surfaces as 422 and never 429 (FR-021).
    await reserve(client, SCOPE.MARKETPLACE_LISTINGS, memberId, 1, {
      defaultLimit: Number(app.env.MARKETPLACE_LISTING_QUOTA ?? DEFAULT_LISTING_QUOTA),
    })

    const { rows } = await client.query(
      `INSERT INTO marketplace_listings
         (owner_id, category, mode, title, body, state, contact_method,
          terms_version, published_at, expires_at, state_changed_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, now(), $8, now())
       RETURNING id, category, mode, title, body, state, contact_method,
                 created_at, published_at, expires_at`,
      [memberId, category, mode, title, body, contactMethod, current, expiresAt],
    )
    const listing = rows[0]!

    const { columns, values } = detailColumns(category as MarketplaceCategory, details)
    if (columns.length > 0) {
      const placeholders = values.map((_, i) => `$${i + 2}`).join(', ')
      await client.query(
        `INSERT INTO ${detailTableFor(category as MarketplaceCategory)}
           (listing_id, ${columns.join(', ')}) VALUES ($1, ${placeholders})`,
        [listing.id, ...values],
      )
    } else {
      await client.query(
        `INSERT INTO ${detailTableFor(category as MarketplaceCategory)} (listing_id) VALUES ($1)`,
        [listing.id],
      )
    }

    if (category === 'vehicle' && features.length > 0) {
      // A feature the catalogue does not know is a foreign-key violation
      // rather than a row nobody can ever filter on (research.md R3).
      await client.query(
        `INSERT INTO marketplace_vehicle_features (listing_id, feature_id)
         SELECT $1, id FROM vehicle_features WHERE key = ANY($2::citext[]) AND retired_at IS NULL`,
        [listing.id, features],
      )
    }

    return listing
  }, { signal })
}

/**
 * Deliberately a lookup rather than string interpolation of the category.
 *
 * The category reaches here from a request body. Interpolating it into SQL
 * would be an injection even though the enum makes it "safe", and the next
 * person to add a category should not have to notice that.
 */
function detailTableFor(category: MarketplaceCategory): string {
  const table = {
    vehicle: 'marketplace_vehicle_details',
    property: 'marketplace_property_details',
    job: 'marketplace_job_details',
    general: 'marketplace_general_details',
  }[category]
  if (!table) throw forbidden(PROBLEMS.VALIDATION_FAILED, `Unknown category "${category}".`)
  return table
}

export { QuotaExceededError }

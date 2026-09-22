import { PROBLEMS } from '@gwc/contracts/errors'
import { CATEGORY_DEFS } from '@gwc/contracts/marketplace'
import { query } from '../../db/query.ts'
import {
  createListing, currentTermsVersion, TermsNotAcceptedError, DetailsInvalidError,
  QuotaExceededError,
} from './application/create.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type { CreateListingRequest } from '@gwc/contracts/marketplace'

/**
 * Request and reply shaping for the marketplace. Every rule lives in
 * `application/`; this pulls plain data off `request` and puts plain data on
 * `reply` (feature 006's split).
 */
export function createMarketplaceController(app: GwcApp) {
  return {
    create: async (request: GwcRequest, reply: GwcReply) => {
      const principal = request.principal!
      try {
        // The route's Zod schema validates this shape today. After feature
        // 007 Phase 6 removes that schema the cast is an assertion the runtime
        // does not check — which is why validateDetails() and the CHECK
        // constraints in 019_marketplace.sql do the real work.
        const body = request.body as CreateListingRequest
        const listing = await createListing(app, {
          ...body,
          memberId: String(principal.id),
          requestId: request.id,
          signal: request.deadlineSignal,
        })
        return reply.code(201).send(toListingResponse(listing))
      } catch (err) {
        if (err instanceof TermsNotAcceptedError) {
          return reply.code(400).send({
            ...PROBLEMS.VALIDATION_FAILED,
            detail: `The current marketplace terms (${err.currentVersion}) must be accepted before posting.`,
            instance: request.url,
          })
        }
        if (err instanceof QuotaExceededError) {
          // 422, never 429. A 429 means "retry later and it will work"; a
          // quota means retrying changes nothing until the member withdraws
          // something, and a client shown 429 would retry forever.
          return reply.code(PROBLEMS.QUOTA_EXCEEDED.status).send({
            ...PROBLEMS.QUOTA_EXCEEDED,
            detail: `Listing quota reached: ${err.used} of ${err.limit} in use.`,
            instance: request.url,
          })
        }
        if (err instanceof DetailsInvalidError) {
          return reply.code(400).send({
            ...PROBLEMS.VALIDATION_FAILED,
            detail: err.problems.map((p) => `${p.field} ${p.reason}`).join('; '),
            instance: request.url,
          })
        }
        throw err
      }
    },

    terms: async (request: GwcRequest, reply: GwcReply) => {
      const principal = request.principal!
      const version = currentTermsVersion(app)
      const { rows } = await query(
        app.pg,
        `SELECT version FROM marketplace_terms_acceptances
          WHERE member_id = $1 ORDER BY accepted_at DESC LIMIT 1`,
        [principal.id],
        { signal: request.deadlineSignal },
      )
      return reply.send({ version, acceptedVersion: rows[0]?.version ?? null })
    },

    acceptTerms: async (request: GwcRequest, reply: GwcReply) => {
      const principal = request.principal!
      const version = currentTermsVersion(app)
      // Append-only: accepting v2 keeps the v1 row, which is the record of what
      // they agreed to when they posted their earlier listings.
      await query(
        app.pg,
        `INSERT INTO marketplace_terms_acceptances (member_id, version)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [principal.id, version],
        { signal: request.deadlineSignal },
      )
      return reply.send({ version, acceptedVersion: version })
    },

    /**
     * The field definitions plus the LIVE feature catalogue.
     *
     * The client's only source for the ~40 vehicle features. Hard-coding them
     * in the console would be a second home for a rule, and a retired feature
     * would keep being offered.
     *
     * No labels: the server emits no localised text, so the client keys its
     * own i18n off `key`.
     */
    categories: async (request: GwcRequest, reply: GwcReply) => {
      const { rows } = await query(
        app.pg,
        `SELECT key, grouping, position FROM vehicle_features
          WHERE retired_at IS NULL ORDER BY grouping, position, key`,
        [],
        { signal: request.deadlineSignal },
      )
      return reply.send({
        categories: Object.values(CATEGORY_DEFS),
        vehicleFeatures: rows.map((r) => ({
          key: String(r.key), group: String(r.grouping), position: Number(r.position),
        })),
      })
    },
  }
}

/** Columns named explicitly; never SELECT *. See contracts/marketplace-api.md. */
function toListingResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    category: row.category,
    mode: row.mode,
    title: row.title,
    body: row.body,
    state: row.state,
    contactMethod: row.contact_method,
    createdAt: row.created_at,
    publishedAt: row.published_at ?? null,
    // Null means unlimited — a choice, not a missing value (FR-028).
    expiresAt: row.expires_at ?? null,
  }
}

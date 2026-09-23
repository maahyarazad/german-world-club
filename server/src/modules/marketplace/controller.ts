import { PROBLEMS } from '@gwc/contracts/errors'
import { CATEGORY_DEFS } from '@gwc/contracts/marketplace'
import { query } from '../../db/query.ts'
import {
  createListing, currentTermsVersion, TermsNotAcceptedError, DetailsInvalidError,
  QuotaExceededError,
} from './application/create.ts'
import { browseListings, findVisibleListing, UnknownFilterError } from './application/browse.ts'
import { attachMedia, detachMedia, mediaForListings } from './application/media.ts'
import {
  inquire, ListingNotFoundError, ListingNotInquirableError, SelfInquiryError,
} from '../messaging/application/inquire.ts'
import { notifyAfterCommit } from '../messaging/application/converse.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type { CreateListingRequest } from '@gwc/contracts/marketplace'
import type { MediaItem } from './application/media.ts'

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

    browse: async (request: GwcRequest, reply: GwcReply) => {
      const q = (request.query ?? {}) as Record<string, string>
      const limit = boundedLimit(q.limit)

      try {
        const cursor = q.cursor ? decodeCursor(q.cursor) : null
        const detail = Object.fromEntries(
          Object.entries(q).filter(([k]) => !RESERVED.has(k)),
        )

        const { rows, hasMore } = await browseListings(app, {
          category: q.category as never,
          mode: q.mode,
          limit,
          cursor,
          detail,
          signal: request.deadlineSignal,
        })

        // One query for the whole page, not one per listing: the index shows
        // a thumbnail for every row, and N+1 here is the difference between a
        // browse page and a browse outage.
        const media = await mediaForListings(app, rows.map((r) => String(r.id)),
          { signal: request.deadlineSignal })

        const last = rows[rows.length - 1]
        return reply.send({
          items: rows.map((r) => toListingResponse(r, media.get(String(r.id)) ?? [])),
          nextCursor: hasMore && last ? encodeCursor(last.created_at, String(last.id)) : null,
        })
      } catch (err) {
        if (err instanceof UnknownFilterError) {
          return reply.code(400).send({
            ...PROBLEMS.VALIDATION_FAILED, detail: err.message, instance: request.url,
          })
        }
        throw err
      }
    },

    findOne: async (request: GwcRequest, reply: GwcReply) => {
      const { id } = request.params as { id: string }
      const { row, state } = await findVisibleListing(app, id, { signal: request.deadlineSignal })

      if (row) {
        const media = await mediaForListings(app, [String(row.id)],
          { signal: request.deadlineSignal })
        return reply.send(toListingResponse(row, media.get(String(row.id)) ?? []))
      }

      // §12 rule 13: never a 200 carrying fallback content. `gone` for a
      // listing that existed and stopped being visible, `not found` for one
      // that never did — the distinction a member can act on.
      const problem = state ? PROBLEMS.GONE : PROBLEMS.NOT_FOUND
      return reply.code(problem.status).send({ ...problem, instance: request.url })
    },

    inquire: async (request: GwcRequest, reply: GwcReply) => {
      const principal = request.principal!
      const { id } = request.params as { id: string }
      const { body } = request.body as { body: string }

      try {
        const result = await inquire(app, {
          listingId: id,
          inquirerId: String(principal.id),
          body,
          signal: request.deadlineSignal,
        })

        // Persisted. Only now is anyone told (Technology Baseline ordering).
        await notifyAfterCommit(app, {
          conversationId: result.conversationId,
          messageId: String(result.message.id),
          senderId: String(principal.id),
        })

        return reply.code(201).send({
          conversationId: result.conversationId,
          created: result.created,
          message: {
            id: result.message.id,
            conversationId: result.message.conversation_id,
            senderId: result.message.sender_id,
            body: result.message.body,
            createdAt: result.message.created_at,
          },
        })
      } catch (err) {
        if (err instanceof ListingNotFoundError) {
          return reply.code(PROBLEMS.NOT_FOUND.status).send({
            ...PROBLEMS.NOT_FOUND, instance: request.url,
          })
        }
        if (err instanceof ListingNotInquirableError) {
          // 410, not 404: the listing existed and stopped accepting enquiries.
          // Existing conversations about it stay readable (FR-027), so "gone"
          // describes the enquiry route, not the correspondence.
          return reply.code(PROBLEMS.GONE.status).send({
            ...PROBLEMS.GONE, detail: err.message, instance: request.url,
          })
        }
        if (err instanceof SelfInquiryError) {
          return reply.code(400).send({
            ...PROBLEMS.VALIDATION_FAILED, detail: err.message, instance: request.url,
          })
        }
        throw err
      }
    },

    // ---- Media -------------------------------------------------------------
    //
    // Attaching is a LINK, not an upload: the bytes went through `modules/media`
    // already, which is what inspected them, stripped their metadata and
    // derived them. Nothing about that pipeline is reimplemented here.

    attachMedia: async (request: GwcRequest, reply: GwcReply) => {
      const principal = request.principal!
      const { id } = request.params as { id: string }
      const { assetId } = request.body as { assetId: string }

      const linked = await attachMedia(app, {
        listingId: id,
        ownerId: String(principal.id),
        assetId,
        signal: request.deadlineSignal,
      })
      return reply.code(201).send(linked)
    },

    detachMedia: async (request: GwcRequest, reply: GwcReply) => {
      const principal = request.principal!
      const { id, assetId } = request.params as { id: string; assetId: string }

      const result = await detachMedia(app, {
        listingId: id,
        ownerId: String(principal.id),
        assetId,
        signal: request.deadlineSignal,
      })
      return reply.send(result)
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

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/** Bounds from contracts/marketplace-api.md. */
export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 50

/**
 * Coerce, default and bound `limit` — here, in the handler, not only in the
 * route's Zod schema.
 *
 * Feature 007 Phase 6 deletes that schema. `specs/007-typescript-migration/
 * data-model.md` §4b traced the existing campaignQuery.limit from
 * request.query into a SQL LIMIT and found that removing its schema without
 * replacing the coercion produces three regressions at once: the string "50"
 * instead of 50, `undefined` instead of the default when the parameter is
 * absent, and no upper bound at all, so `?limit=1000000` is served.
 *
 * This is the second such parameter in the codebase. All three are asserted in
 * tests/marketplace/limit.test.ts.
 */
export function boundedLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT
  return Math.min(Math.floor(n), MAX_LIMIT)
}

/**
 * An opaque keyset cursor over `(created_at, id)`.
 *
 * Opaque so its shape is not a promise to clients. Unparseable is a 400, never
 * a silent reset to page one — silently restarting is how a client loops
 * forever without noticing.
 */
export function encodeCursor(createdAt: string | Date, id: string): string {
  return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`).toString('base64url')
}

export function decodeCursor(raw: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
    throw new UnknownFilterError('cursor')
  }
  return { createdAt, id }
}

/** Query keys that are not category-specific filters. */
const RESERVED = new Set(['category', 'mode', 'limit', 'cursor'])

/**
 * T066 — resolve the stored contact *preference* into what a reader may act on.
 *
 * A listing stores a preference and **never a value** (research.md R9).
 * Copying an email address onto a listing row would make the row a second,
 * stale, unprotected home for it, and a member tightening their settings later
 * would not retroactively protect listings already posted. So resolution
 * happens here, at render time, where the answer is always live.
 *
 * What it resolves *against* is the honest limit of this feature: §7's privacy
 * settings are not modelled — `members` has no such columns — so there is
 * nothing that could authorise releasing an address or a number, and both
 * resolve to unavailable. `platform_message` is available because US5 built the
 * messaging behind it.
 *
 * This is deliberately not a stub that emits a value "for now". An endpoint
 * that leaked a contact value before the settings existed to restrict it is the
 * exact failure R9 and FR-026 exist to prevent, and it would be invisible until
 * someone complained. When the settings land, this function gains a lookup and
 * its callers do not change.
 */
function resolveContact(preference: unknown) {
  const method = String(preference ?? 'platform_message')
  return {
    method,
    // Whether a reader can act on it now, so a client renders "Message seller"
    // rather than a dead button.
    available: method === 'platform_message',
    // Never a value. There is no field here to hold one.
    via: method === 'platform_message' ? 'inquire' : null,
  }
}

/** Columns named explicitly; never SELECT *. See contracts/marketplace-api.md. */
function toListingResponse(row: Record<string, unknown>, media: MediaItem[] = []) {
  return {
    id: row.id,
    category: row.category,
    mode: row.mode,
    title: row.title,
    body: row.body,
    state: row.state,
    contact: resolveContact(row.contact_method),
    // Retained alongside `contact` because clients already branch on it; it is
    // the preference, which is public, not a value.
    contactMethod: row.contact_method,
    createdAt: row.created_at,
    publishedAt: row.published_at ?? null,
    // Null means unlimited — a choice, not a missing value (FR-028).
    expiresAt: row.expires_at ?? null,
    ...(row.owner_id
      ? { owner: { id: row.owner_id, displayName: row.owner_display_name ?? null } }
      : {}),
    ...(row.details ? { details: row.details } : {}),
    media,
  }
}

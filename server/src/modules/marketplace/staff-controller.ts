import { PROBLEMS } from '@gwc/contracts/errors'
import {
  loadForModeration, hideListing, restoreListing, removeListing, listReports, resolveReport,
  ListingNotFoundError, ReportNotFoundError, ReasonRequiredError,
} from './application/moderate.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/** Request and reply shaping for staff moderation. The rules live in `application/moderate.ts`. */
export function createMarketplaceStaffController(app: GwcApp) {
  const withErrors = (fn: (request: GwcRequest, reply: GwcReply) => Promise<unknown>) =>
    async (request: GwcRequest, reply: GwcReply) => {
      try {
        return await fn(request, reply)
      } catch (err) {
        if (err instanceof ListingNotFoundError || err instanceof ReportNotFoundError) {
          return reply.code(PROBLEMS.NOT_FOUND.status).send({ ...PROBLEMS.NOT_FOUND, instance: request.url })
        }
        if (err instanceof ReasonRequiredError) {
          return reply.code(400).send({
            ...PROBLEMS.VALIDATION_FAILED, detail: err.message, instance: request.url,
          })
        }
        throw err
      }
    }

  return {
    reports: withErrors(async (request, reply) => {
      const { state } = (request.query ?? {}) as { state?: string }
      const rows = await listReports(app, { state, signal: request.deadlineSignal })
      return reply.send({ items: rows.map(toReportResponse) })
    }),

    getListing: withErrors(async (request, reply) => {
      const { id } = request.params as { id: string }
      const row = await loadForModeration(app, { listingId: id, signal: request.deadlineSignal })
      return reply.send(toListingResponse(row))
    }),

    hide: withErrors(async (request, reply) => {
      const principal = request.principal!
      const { id } = request.params as { id: string }
      const { reason } = request.body as { reason: string }
      const result = await hideListing(app, {
        listingId: id, actorId: String(principal.id), reason,
        requestId: request.id, signal: request.deadlineSignal,
      })
      return reply.send({ id: result.id, state: result.state, stateChangedAt: result.state_changed_at })
    }),

    restore: withErrors(async (request, reply) => {
      const principal = request.principal!
      const { id } = request.params as { id: string }
      const { reason } = request.body as { reason: string }
      const result = await restoreListing(app, {
        listingId: id, actorId: String(principal.id), reason,
        requestId: request.id, signal: request.deadlineSignal,
      })
      return reply.send({ id: result.id, state: result.state, stateChangedAt: result.state_changed_at })
    }),

    remove: withErrors(async (request, reply) => {
      const principal = request.principal!
      const { id } = request.params as { id: string }
      const { reason } = request.body as { reason: string }
      const result = await removeListing(app, {
        listingId: id, actorId: String(principal.id), reason,
        requestId: request.id, signal: request.deadlineSignal,
      })
      return reply.send(result)
    }),

    resolveReport: withErrors(async (request, reply) => {
      const principal = request.principal!
      const { id } = request.params as { id: string }
      const { outcome, reason } = request.body as { outcome: 'upheld' | 'dismissed'; reason: string }
      const result = await resolveReport(app, {
        reportId: id, actorId: String(principal.id), outcome, reason,
        requestId: request.id, signal: request.deadlineSignal,
      })
      return reply.send({ id: result.id, listingId: result.listing_id, state: result.state })
    }),
  }
}

function toReportResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    listingId: row.listing_id,
    reporterId: row.reporter_id,
    reason: row.reason,
    state: row.state,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
    resolvedBy: row.resolved_by ?? null,
    listingTitle: row.listing_title,
    listingState: row.listing_state,
  }
}

/**
 * Named fields only — this is a staff view of a member's listing, and the
 * same explicit-columns discipline applies regardless of who is reading it.
 */
function toListingResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerDisplayName: row.owner_display_name ?? null,
    category: row.category,
    mode: row.mode,
    title: row.title,
    body: row.body,
    state: row.state,
    contactMethod: row.contact_method,
    createdAt: row.created_at,
    publishedAt: row.published_at ?? null,
    expiresAt: row.expires_at ?? null,
    stateChangedAt: row.state_changed_at,
  }
}

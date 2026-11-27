import { redeemOffer } from './application/redeem.ts'
import { listOwnRedemptions } from './application/mine.ts'
import { getVisibleStore } from '../stores/application/profile.ts'
import { getMemberOffer } from '../offers/application/offer.ts'
import { listVisibleOffers, listBrowseCategories } from '../offers/application/browse.ts'
import type { Redeemer } from './application/redeem.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Browsing and redeeming merchant offers, for every kind of account.
 *
 * One handler set, registered once per audience (a route has exactly one
 * audience, so widening a route would put the organisation gates on member
 * traffic). Who is redeeming comes from the session: the principal's kind and
 * id, plus the organisation for a merchant or partner user. Nothing about the
 * redeemer is read from the request, so no body can say "redeem as someone else".
 */
export function createClubOffersController(app: GwcApp) {
  const redeemer = (request: GwcRequest): Redeemer => {
    const principal = request.principal!
    return {
      kind: principal.kind as Redeemer['kind'],
      id: String(principal.id),
      organisationId: principal.organisationId ? String(principal.organisationId) : undefined,
    }
  }

  return {
    list: async (request: GwcRequest, reply: GwcReply) => {
      const { categoryId, cursor, q } = (request.query ?? {}) as { categoryId?: string; cursor?: string; q?: string }
      return reply.send(await listVisibleOffers(app, { categoryId, cursor, q, signal: request.deadlineSignal }))
    },

    categories: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await listBrowseCategories(app, { signal: request.deadlineSignal })),

    detail: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await getMemberOffer(app, { id: (request.params as { id: string }).id, signal: request.deadlineSignal })),

    // The store behind an offer, addressed by the slug the offer's merchant block carries.
    store: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await getVisibleStore(app, { slug: (request.params as { slug: string }).slug, signal: request.deadlineSignal })),

    redeem: async (request: GwcRequest, reply: GwcReply) => {
      const { id } = request.params as { id: string }
      const { requestId } = request.body as { requestId: string }
      const { redemption, replay } = await redeemOffer(app, { offerId: id, requestId, redeemer: redeemer(request) })
      // 201 for a new redemption, 200 for the original answered again.
      return reply.code(replay ? 200 : 201).send(redemption)
    },

    mine: async (request: GwcRequest, reply: GwcReply) => {
      const { cursor } = (request.query ?? {}) as { cursor?: string }
      return reply.send(await listOwnRedemptions(app, { redeemer: redeemer(request), cursor, signal: request.deadlineSignal }))
    },
  }
}

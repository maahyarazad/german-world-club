import {
  listOwnOffers, createOffer, updateOffer, publishOffer, withdrawOffer, setOfferOrder,
} from './application/merchant-offers.ts'
import { setOfferMedia, setMainMedia } from './application/offer-media.ts'
import { listChoosableCategories } from '../offer-categories/application/categories.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type { CreateOfferRequest, UpdateOfferRequest } from '@gwc/contracts/offers'

/** Request and reply shaping for a merchant's own offers. The rules live in `application/`. */
export function createMerchantOfferController(app: GwcApp) {
  // The organisation is read from the database on this request (10-auth), not
  // taken from the token or the URL.
  const org = (request: GwcRequest) => String(request.principal!.organisationId)
  const actor = (request: GwcRequest) => ({ id: String(request.principal!.id), kind: 'merchant' as const, requestId: request.id })
  const offerId = (request: GwcRequest) => (request.params as { id: string }).id

  return {
    list: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await listOwnOffers(app, { organisationId: org(request) })),

    create: async (request: GwcRequest, reply: GwcReply) =>
      reply.code(201).send(await createOffer(app, {
        organisationId: org(request), actor: actor(request), body: request.body as CreateOfferRequest,
      })),

    update: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await updateOffer(app, {
        organisationId: org(request), actor: actor(request), offerId: offerId(request), body: request.body as UpdateOfferRequest,
      })),

    setMedia: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await setOfferMedia(app, {
        organisationId: org(request), actor: actor(request), offerId: offerId(request),
        assetIds: (request.body as { assetIds: string[] }).assetIds,
      })),

    setMainMedia: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await setMainMedia(app, {
        scope: { organisationId: org(request) }, actor: actor(request), offerId: offerId(request),
        assetId: (request.body as { assetId: string }).assetId,
      })),

    publish: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await publishOffer(app, { organisationId: org(request), actor: actor(request), offerId: offerId(request) })),

    withdraw: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await withdrawOffer(app, { organisationId: org(request), actor: actor(request), offerId: offerId(request) })),

    order: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await setOfferOrder(app, {
        organisationId: org(request), ids: (request.body as { ids: string[] }).ids,
      })),

    categories: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await listChoosableCategories(app, { signal: request.deadlineSignal })),
  }
}

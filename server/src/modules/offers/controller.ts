import { getMemberOffer } from './application/offer.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

export function createOfferController(app: GwcApp) {
  return {
    detail: async (request: GwcRequest, reply: GwcReply) => {
      const { id } = request.params as { id: string }
      const offer = await getMemberOffer(app, { id, signal: request.deadlineSignal })
      return reply.send(offer)
    },
  }
}

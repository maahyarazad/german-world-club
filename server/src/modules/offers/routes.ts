import fp from 'fastify-plugin'
import { memberOfferSchema, offerIdParamSchema } from '@gwc/contracts/offers'
import { createOfferController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Member offers (feature 011): schema, posture and wiring.
 *
 *   GET /member/offers/:id    one published, currently valid offer   (member)
 *
 * Exists so an offer notification lands on something (research R11). There is
 * deliberately no list and no publishing route: those are the merchant
 * portal's. Under `/member/` for the same reason as events — member JSON must
 * not inherit the crawl posture of a public page surface, and the `member-api`
 * surface row already declares the prefix gated and never indexed.
 */
export default fp(
  async function offerRoutes(app: GwcApp) {
    const controller = createOfferController(app)

    app.get(
      '/member/offers/:id',
      {
        config: { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('member-api') },
        onRequest: app.guard,
        schema: { params: offerIdParamSchema, response: { 200: memberOfferSchema } },
      },
      controller.detail,
    )
  },
  { name: 'offer-routes', dependencies: ['auth', 'rate-limit'] },
)

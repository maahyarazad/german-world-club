import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  createOfferRequestSchema, updateOfferRequestSchema, setOfferMediaRequestSchema, setOfferOrderRequestSchema,
  merchantOfferSchema, merchantOfferListSchema, offerCategoryListSchema,
} from '@gwc/contracts/offers'
import { createMerchantOfferController } from './merchant-controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * A merchant's own offers (feature 035): schema, posture and wiring.
 *
 *   GET  /merchant/offers                   own offers, any state
 *   POST /merchant/offers                   a draft (a category is required)
 *   PATCH /merchant/offers/:id              edit; a stale `version` is 409
 *   PUT  /merchant/offers/:id/media         the images and videos, at most 10, replaced as a whole
 *   POST /merchant/offers/:id/publish       draft or withdrawn -> published; no approval step
 *   POST /merchant/offers/:id/withdraw      published -> withdrawn
 *   PUT  /merchant/offers/order             the merchant's display order
 *   GET  /merchant/categories               the categories a merchant may choose
 *
 * `/merchant/offers/order` is a literal segment next to `/:id`: the router
 * prefers the literal, and the two use different methods anyway.
 *
 * Every id in a path is scoped to the principal's organisation inside the
 * handler's transaction, so another merchant's offer answers 404, identical to
 * an unknown id.
 */
export default fp(
  async function merchantOfferRoutes(app: GwcApp) {
    const controller = createMerchantOfferController(app)
    const read = { auth: { audience: 'merchant' }, budget: 'member-read', rateLimit: app.bucket('member-api') } as const
    const write = { auth: { audience: 'merchant' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') } as const
    const idParam = z.object({ id: z.string().uuid() })

    app.get('/merchant/offers', {
      config: read, onRequest: app.guard, schema: { response: { 200: merchantOfferListSchema } },
    }, controller.list)

    app.post('/merchant/offers', {
      config: write, onRequest: app.guard, schema: { body: createOfferRequestSchema, response: { 201: merchantOfferSchema } },
    }, controller.create)

    app.put('/merchant/offers/order', {
      config: write, onRequest: app.guard, schema: { body: setOfferOrderRequestSchema, response: { 200: merchantOfferListSchema } },
    }, controller.order)

    app.patch('/merchant/offers/:id', {
      config: write, onRequest: app.guard,
      schema: { params: idParam, body: updateOfferRequestSchema, response: { 200: merchantOfferSchema } },
    }, controller.update)

    app.put('/merchant/offers/:id/media', {
      config: write, onRequest: app.guard,
      schema: { params: idParam, body: setOfferMediaRequestSchema, response: { 200: merchantOfferSchema } },
    }, controller.setMedia)

    app.post('/merchant/offers/:id/publish', {
      config: write, onRequest: app.guard, schema: { params: idParam, response: { 200: merchantOfferSchema } },
    }, controller.publish)

    app.post('/merchant/offers/:id/withdraw', {
      config: write, onRequest: app.guard, schema: { params: idParam, response: { 200: merchantOfferSchema } },
    }, controller.withdraw)

    app.get('/merchant/categories', {
      config: read, onRequest: app.guard, schema: { response: { 200: offerCategoryListSchema } },
    }, controller.categories)
  },
  { name: 'merchant-offer-routes', dependencies: ['auth', 'rate-limit'] },
)

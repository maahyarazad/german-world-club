import fp from 'fastify-plugin'
import {
  storeSchema, createStoreRequestSchema, updateStoreRequestSchema,
  setStoreCoverRequestSchema, setStoreMediaRequestSchema,
} from '@gwc/contracts/stores'
import { createStoreController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * A merchant's own store (feature 035): schema, posture and wiring.
 *
 *   GET   /merchant/store         the store, or 404 `store-not-found` before it exists
 *   POST  /merchant/store         create it; a second one is 409 `store-exists`
 *   PATCH /merchant/store         description and opening hours (a stale version is 409)
 *   PUT   /merchant/store/cover   the wide cover; anything not about 16:9 is 422
 *   PUT   /merchant/store/media   the gallery, at most 10, replaced as a whole
 *
 * Merchant-only by audience, so a partner or member token is refused before a
 * handler runs. There is no id in any path: "mine" cannot be pointed at anyone
 * else's row, which is why there is no object guard to forget here.
 */
export default fp(
  async function storeRoutes(app: GwcApp) {
    const controller = createStoreController(app)
    const read = { auth: { audience: 'merchant' }, budget: 'member-read', rateLimit: app.bucket('member-api') } as const
    const write = { auth: { audience: 'merchant' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') } as const

    app.get('/merchant/store', { config: read, onRequest: app.guard, schema: { response: { 200: storeSchema } } }, controller.get)
    app.post('/merchant/store', {
      config: write, onRequest: app.guard, schema: { body: createStoreRequestSchema, response: { 201: storeSchema } },
    }, controller.create)
    app.patch('/merchant/store', {
      config: write, onRequest: app.guard, schema: { body: updateStoreRequestSchema, response: { 200: storeSchema } },
    }, controller.update)
    app.put('/merchant/store/cover', {
      config: write, onRequest: app.guard, schema: { body: setStoreCoverRequestSchema, response: { 200: storeSchema } },
    }, controller.setCover)
    app.put('/merchant/store/media', {
      config: write, onRequest: app.guard, schema: { body: setStoreMediaRequestSchema, response: { 200: storeSchema } },
    }, controller.setMedia)
  },
  { name: 'store-routes', dependencies: ['auth', 'rate-limit'] },
)

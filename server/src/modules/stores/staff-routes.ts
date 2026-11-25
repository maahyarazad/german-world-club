import fp from 'fastify-plugin'
import { adminStoreListSchema, adminStoreSchema, setStoreActiveRequestSchema, storeIdParamSchema } from '@gwc/contracts/stores'
import { createStoreStaffController } from './staff-controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Staff control of merchant stores (feature 035): schema, posture and wiring.
 *
 *   GET /admin/stores              every store, with its organisation and offer count   read
 *   PUT /admin/stores/:id/active   { active: false | true | 0 | 1, reason }              status
 *
 * Gated on the `merchant_offers` module. `write`, `edit` and `delete` are not
 * used here on purpose: staff switch the shop window on and off, they do not
 * rewrite what a merchant says, and a store is never deleted.
 *
 * `PUT` because setting the flag to a value is idempotent: sending the same
 * request twice leaves the store as one did. `/admin` is already gated and
 * never indexed in `seo/surfaces.ts`.
 */
export default fp(
  async function storeStaffRoutes(app: GwcApp) {
    const controller = createStoreStaffController(app)

    app.get('/admin/stores', {
      config: { auth: { audience: 'staff', module: 'merchant_offers', flag: 'read' }, budget: 'admin-read', rateLimit: app.bucket('admin-api') },
      onRequest: app.guard,
      schema: { response: { 200: adminStoreListSchema } },
    }, controller.list)

    app.put('/admin/stores/:id/active', {
      config: { auth: { audience: 'staff', module: 'merchant_offers', flag: 'status' }, budget: 'admin-write', rateLimit: app.bucket('admin-api') },
      onRequest: app.guard,
      schema: { params: storeIdParamSchema, body: setStoreActiveRequestSchema, response: { 200: adminStoreSchema } },
    }, controller.setActive)
  },
  { name: 'store-staff-routes', dependencies: ['auth', 'rate-limit'] },
)

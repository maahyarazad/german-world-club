import fp from 'fastify-plugin'
import { offerIdParamSchema, setMainMediaRequestSchema, offerMediaSchema } from '@gwc/contracts/offers'
import { createOfferStaffController } from './staff-controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Staff choosing an offer's main media (feature 042): schema, posture and wiring.
 *
 *   PUT /admin/offers/:id/main-media   { assetId }   which existing file leads    edit
 *
 * Gated on `merchant_offers.edit`, **and the handler narrows it to a super admin**.
 * The posture vocabulary has no "superadmin only", so this follows the dashboard
 * figures (`admin-dashboard/controller.ts`): declare the module here so the route
 * stays inside the authz matrix, refuse everyone else in the handler. A super admin
 * bypasses the module check by itself; a staff account that merely holds
 * `merchant_offers.edit` for categories gets past the gate and is stopped there.
 *
 * What it can do is deliberately small: move a file the offer ALREADY has to the
 * front. Staff do not upload, remove or reorder a merchant's files, so what a
 * merchant said is still what a merchant said (the stance `stores/staff-routes.ts` states).
 *
 * `PUT` because naming the same main file twice leaves the offer as once did.
 * `/admin` is already gated and never indexed in `seo/surfaces.ts`.
 */
export default fp(
  async function offerStaffRoutes(app: GwcApp) {
    const controller = createOfferStaffController(app)

    app.put('/admin/offers/:id/main-media', {
      config: { auth: { audience: 'staff', module: 'merchant_offers', flag: 'edit' }, budget: 'admin-write', rateLimit: app.bucket('admin-api') },
      onRequest: app.guard,
      schema: { params: offerIdParamSchema, body: setMainMediaRequestSchema, response: { 200: offerMediaSchema } },
    }, controller.setMainMedia)
  },
  { name: 'offer-staff-routes', dependencies: ['auth', 'rate-limit'] },
)

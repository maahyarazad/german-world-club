import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  memberOfferSchema, offerListSchema, offerListQuerySchema, browseCategoryListSchema,
} from '@gwc/contracts/offers'
import { storeProfileSchema, storeSlugParamSchema } from '@gwc/contracts/stores'
import { redeemRequestSchema, redemptionSchema, redemptionListSchema, redemptionQuerySchema } from '@gwc/contracts/redemptions'
import { createClubOffersController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Browsing and redeeming merchant offers (feature 035): schema, posture and wiring.
 *
 *   GET  <prefix>                   the offers a person may see now, by category
 *   GET  <prefix>/categories        the categories, with how many offers are visible in each
 *   GET  <prefix>/redemptions       what this account has redeemed
 *   GET  <prefix>/stores/:slug      the store behind an offer, by the slug on its merchant block
 *   GET  <prefix>/:id               one visible offer
 *   POST <prefix>/:id/redemptions   redeem it
 *
 * One handler set, four mounts, because a route has exactly one audience:
 *
 *   member   /member/offers
 *   staff    /admin/club-offers       any staff account (`anyStaff`), no module
 *   merchant /merchant/club-offers
 *   partner  /partner/club-offers
 *
 * `/member/offers/:id` already existed (feature 011) so a notification lands on
 * something; it stays where it is (modules/offers/routes.ts) and the three other
 * mounts get the same detail handler here.
 *
 * Staff browse and redeem as people, not as moderators, so the staff mount
 * declares `anyStaff` like the referral routes do: authenticated staff, with no
 * module grant, and no route here reads or changes anyone else's data.
 *
 * `/redemptions` is registered before `/:id`: the router would prefer the
 * literal anyway, and this makes the order the reader sees the order that wins.
 */
const MOUNTS = [
  { prefix: '/member/offers', auth: { audience: 'member' } },
  { prefix: '/admin/club-offers', auth: { audience: 'staff', anyStaff: true } },
  { prefix: '/merchant/club-offers', auth: { audience: 'merchant' } },
  { prefix: '/partner/club-offers', auth: { audience: 'partner' } },
] as const

export default fp(
  async function clubOfferRoutes(app: GwcApp) {
    const controller = createClubOffersController(app)
    const idParam = z.object({ id: z.string().uuid() })

    for (const { prefix, auth } of MOUNTS) {
      const read = {
        auth, budget: 'marketplace', rateLimit: app.bucket(auth.audience === 'staff' ? 'admin-api' : 'member-api'),
      } as const
      const write = {
        auth, budget: 'member-write', rateLimit: app.bucket('write-heavy'),
      } as const

      app.get(prefix, {
        config: read, onRequest: app.guard, schema: { querystring: offerListQuerySchema, response: { 200: offerListSchema } },
      }, controller.list)

      app.get(`${prefix}/categories`, {
        config: read, onRequest: app.guard, schema: { response: { 200: browseCategoryListSchema } },
      }, controller.categories)

      app.get(`${prefix}/redemptions`, {
        config: read, onRequest: app.guard, schema: { querystring: redemptionQuerySchema, response: { 200: redemptionListSchema } },
      }, controller.mine)

      app.get(`${prefix}/stores/:slug`, {
        config: { ...read, budget: 'member-read' }, onRequest: app.guard,
        schema: { params: storeSlugParamSchema, response: { 200: storeProfileSchema } },
      }, controller.store)

      // `GET /member/offers/:id` already exists (feature 011, so a notification
      // lands on something) and keeps its own registration; the other three
      // mounts get the same handler here.
      if (prefix !== '/member/offers') {
        app.get(`${prefix}/:id`, {
          config: { ...read, budget: 'member-read' }, onRequest: app.guard,
          schema: { params: idParam, response: { 200: memberOfferSchema } },
        }, controller.detail)
      }

      app.post(`${prefix}/:id/redemptions`, {
        config: write, onRequest: app.guard,
        schema: { params: idParam, body: redeemRequestSchema, response: { 200: redemptionSchema, 201: redemptionSchema } },
      }, controller.redeem)
    }
  },
  { name: 'club-offer-routes', dependencies: ['auth', 'rate-limit'] },
)

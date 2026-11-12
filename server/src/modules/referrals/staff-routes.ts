import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  REFERRAL_OWNER_KINDS, disableLinkRequestSchema, reverseXpRequestSchema, setXpRateRequestSchema,
  staffOwnerQuerySchema, staffReferralOwnerSchema, referralPageSchema, xpEntryPageSchema, xpEntrySchema,
  xpRateSchema, pageQuerySchema, pageOf,
} from '@gwc/contracts/referrals'
import { createReferralsStaffController } from './staff-controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Staff oversight of referrals and XP (feature 018 US4, contracts/http-api.md §3).
 *
 * On the `referrals` module, not `members`: XP is to become money, and
 * granting member administration must not quietly grant control over it
 * (research R12).
 *
 *   read    view anyone's link, referrals, XP and the rate history
 *   status  disable a link, reverse an award — state changes, a reason each
 *   edit    change the XP rate
 *
 * `write` and `delete` are used by NOTHING here, on purpose: staff create no
 * referral, and nothing in the ledger is ever deleted. A staff member's OWN
 * link lives at /admin/referrals/me (routes.ts) and needs no grant.
 *
 * `/admin` is gated and never indexed in seo/surfaces.ts already.
 */
const posture = (app: GwcApp, flag: 'read' | 'status' | 'edit') => ({
  config: {
    auth: { audience: 'staff' as const, module: 'referrals' as const, flag },
    budget: 'admin-read', rateLimit: app.bucket('admin-api'),
  },
  onRequest: app.guard,
})

export default fp(
  async function referralStaffRoutes(app: GwcApp) {
    const controller = createReferralsStaffController(app)
    const ownerParams = z.object({ kind: z.enum(REFERRAL_OWNER_KINDS), id: z.string().uuid() })

    app.get('/admin/referrals/owners', {
      ...posture(app, 'read'),
      schema: { querystring: staffOwnerQuerySchema, response: { 200: pageOf(staffReferralOwnerSchema) } },
    }, controller.owners)

    app.get('/admin/referrals/owners/:kind/:id', {
      ...posture(app, 'read'),
      schema: { params: ownerParams, response: { 200: staffReferralOwnerSchema } },
    }, controller.owner)

    app.get('/admin/referrals/owners/:kind/:id/referrals', {
      ...posture(app, 'read'),
      schema: { params: ownerParams, querystring: pageQuerySchema, response: { 200: referralPageSchema } },
    }, controller.ownerReferrals)

    app.get('/admin/referrals/owners/:kind/:id/xp', {
      ...posture(app, 'read'),
      schema: { params: ownerParams, querystring: pageQuerySchema, response: { 200: xpEntryPageSchema } },
    }, controller.ownerXp)

    app.post('/admin/referrals/links/:linkId/disable', {
      ...posture(app, 'status'),
      schema: {
        params: z.object({ linkId: z.string().uuid() }),
        body: disableLinkRequestSchema,
        response: { 200: z.object({ id: z.string().uuid(), state: z.literal('disabled') }) },
      },
    }, controller.disable)

    app.post('/admin/referrals/xp/:entryId/reverse', {
      ...posture(app, 'status'),
      schema: { params: z.object({ entryId: z.string().uuid() }), body: reverseXpRequestSchema, response: { 200: xpEntrySchema } },
    }, controller.reverse)

    app.get('/admin/referrals/xp-rate', {
      ...posture(app, 'read'),
      schema: { response: { 200: z.object({ current: xpRateSchema, history: z.array(xpRateSchema) }) } },
    }, controller.rate)

    app.put('/admin/referrals/xp-rate', {
      ...posture(app, 'edit'),
      schema: { body: setXpRateRequestSchema, response: { 200: xpRateSchema } },
    }, controller.setRate)
  },
  { name: 'referral-staff-routes', dependencies: ['auth', 'rate-limit'] },
)

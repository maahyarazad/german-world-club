import fp from 'fastify-plugin'
import { referralSummarySchema, referralPageSchema, xpEntryPageSchema, pageQuerySchema } from '@gwc/contracts/referrals'
import { createReferralsController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * A person's own referral link, referrals and XP (feature 018,
 * contracts/http-api.md §2): schema, posture and wiring.
 *
 * The same handlers are mounted once per audience, the way /media is (research
 * R13). A route's audience is one value and a token for one audience never
 * satisfies another, so "every principal" is four mounts, not one route with a
 * list:
 *
 *   /referrals            members — no `onboarding` or `profiling` flag, so
 *                         10-auth refuses applicants who are not yet approved
 *                         or not yet profiled (FR-001), with no code of ours
 *   /referrals/merchant   merchant users
 *   /referrals/partner    partner users
 *   /admin/referrals/me   every staff member (`anyStaff`): having a link needs
 *                         no grant, overseeing other people's does (staff-routes.ts)
 */
export const OWNER_MOUNTS = [
  { prefix: '/referrals', auth: { audience: 'member' }, budget: 'member-read', bucket: 'member-api' },
  { prefix: '/referrals/merchant', auth: { audience: 'merchant' }, budget: 'member-read', bucket: 'member-api' },
  { prefix: '/referrals/partner', auth: { audience: 'partner' }, budget: 'member-read', bucket: 'member-api' },
  { prefix: '/admin/referrals/me', auth: { audience: 'staff', anyStaff: true }, budget: 'admin-read', bucket: 'admin-api' },
] as const

export default fp(
  async function referralRoutes(app: GwcApp) {
    const controller = createReferralsController(app)

    for (const mount of OWNER_MOUNTS) {
      app.get(
        mount.prefix,
        {
          config: { auth: mount.auth, budget: mount.budget, rateLimit: app.bucket(mount.bucket) },
          onRequest: app.guard,
          schema: { response: { 200: referralSummarySchema } },
        },
        controller.summary,
      )

      // US3: who came through the link and how far they got, and the XP
      // history — keyset-paged, newest first.
      app.get(
        `${mount.prefix}/referrals`,
        {
          config: { auth: mount.auth, budget: mount.budget, rateLimit: app.bucket(mount.bucket) },
          onRequest: app.guard,
          schema: { querystring: pageQuerySchema, response: { 200: referralPageSchema } },
        },
        controller.referrals,
      )
      app.get(
        `${mount.prefix}/xp`,
        {
          config: { auth: mount.auth, budget: mount.budget, rateLimit: app.bucket(mount.bucket) },
          onRequest: app.guard,
          schema: { querystring: pageQuerySchema, response: { 200: xpEntryPageSchema } },
        },
        controller.xp,
      )

      // A write, so the write-heavy bucket: replacing in a loop would mint codes
      // (each one unique forever) for no purpose but to burn through them.
      app.post(
        `${mount.prefix}/link/replace`,
        {
          config: { auth: mount.auth, budget: mount.budget, rateLimit: app.bucket('write-heavy') },
          onRequest: app.guard,
          schema: { response: { 200: referralSummarySchema } },
        },
        controller.replace,
      )
    }
  },
  { name: 'referral-routes', dependencies: ['auth', 'rate-limit'] },
)

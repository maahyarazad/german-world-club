import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  APPLICATION_STATES, applicationSchema, applicationListSchema, denyApplicationRequestSchema,
} from '@gwc/contracts/onboarding'
import { createOnboardingStaffController } from './staff-controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Staff review of membership applications (§6.1 step 5).
 *
 * On the existing `members` module: deciding who becomes a member is member
 * administration, and a separate module would let somebody approve applicants
 * without being trusted with the member records they create. Reading the queue
 * is `read`; deciding is `status`, the flag §11 uses for state changes — not
 * `write` or `edit`, because reviewing an application changes no member data.
 */
export default fp(
  async function onboardingStaffRoutes(app: GwcApp) {
    const controller = createOnboardingStaffController(app)
    const params = z.object({ memberId: z.string().uuid() })

    app.get(
      '/admin/onboarding/applications',
      {
        config: {
          auth: { audience: 'staff', module: 'members', flag: 'read' },
          budget: 'admin-read', rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: {
          querystring: z.object({ state: z.enum(APPLICATION_STATES).optional() }),
          response: { 200: applicationListSchema },
        },
      },
      controller.list,
    )

    app.post(
      '/admin/onboarding/applications/:memberId/approve',
      {
        config: {
          auth: { audience: 'staff', module: 'members', flag: 'status' },
          budget: 'admin-read', rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: { params, response: { 200: applicationSchema } },
      },
      controller.approve,
    )

    app.post(
      '/admin/onboarding/applications/:memberId/deny',
      {
        config: {
          auth: { audience: 'staff', module: 'members', flag: 'status' },
          budget: 'admin-read', rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: { params, body: denyApplicationRequestSchema, response: { 200: applicationSchema } },
      },
      controller.deny,
    )
  },
  { name: 'onboarding-staff-routes', dependencies: ['auth', 'rate-limit'] },
)

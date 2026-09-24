import fp from 'fastify-plugin'
import { z } from 'zod'
import { designationHistorySchema, designationReasonSchema } from '@gwc/contracts/profile'
import { createProfileStaffController } from './staff-controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Staff management of member designations (feature 010, US6), on the existing
 * `members` module: `read` to see the history, `write` to grant or revoke.
 * Only `influencer` exists, so it is part of the path rather than a parameter
 * a client could put anything in.
 */
export default fp(
  async function profileStaffRoutes(app: GwcApp) {
    const controller = createProfileStaffController(app)
    const params = z.object({ id: z.string().uuid() })
    const gate = (flag: 'read' | 'write') => ({
      auth: { audience: 'staff', module: 'members', flag },
      // The staff budget class every admin route uses, writes included
      // (config/budgets.ts has no separate admin-write class).
      budget: 'admin-read',
      rateLimit: app.bucket('admin-api'),
    } as const)

    app.get(
      '/admin/members/by-handle/:handle',
      {
        config: gate('read'),
        onRequest: app.guard,
        schema: {
          params: z.object({ handle: z.string().min(1).max(31) }),
          response: {
            200: z.object({ id: z.string(), displayName: z.string().nullable(), handle: z.string(), status: z.string() }),
          },
        },
      },
      controller.byHandle,
    )

    app.get(
      '/admin/members/:id/designations',
      { config: gate('read'), onRequest: app.guard, schema: { params, response: { 200: designationHistorySchema } } },
      controller.history,
    )
    app.post(
      '/admin/members/:id/designations/influencer',
      {
        config: gate('write'),
        onRequest: app.guard,
        schema: { params, body: designationReasonSchema, response: { 200: designationHistorySchema } },
      },
      controller.grant,
    )
    // DELETE with a body: the reason is part of the revocation, and a query
    // string would put it in every access log.
    app.delete(
      '/admin/members/:id/designations/influencer',
      {
        config: gate('write'),
        onRequest: app.guard,
        schema: { params, body: designationReasonSchema, response: { 200: designationHistorySchema } },
      },
      controller.revoke,
    )
  },
  { name: 'profile-staff-routes', dependencies: ['auth', 'rate-limit'] },
)

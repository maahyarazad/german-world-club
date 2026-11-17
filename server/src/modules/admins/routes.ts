import fp from 'fastify-plugin'
import { z } from 'zod'
import { adminAccountSchema, adminListResponseSchema, updateAdminRequestSchema } from '@gwc/contracts/admin'
import { createAdminsController } from './controller.ts'
import type { FastifyReply } from 'fastify'
import type { GwcApp } from '../../app.ts'

/**
 * Roles & permissions (feature 028, contracts/admin-api.md).
 *
 * The `admins` module had no routes, which is the whole reason the console said
 * "Not available yet": availability is derived from registered routes. Rules
 * that depend on the TARGET (only a superadmin manages an administrator, nobody
 * demotes themselves, one superadmin must remain) live in `application/` and run
 * inside the handler's transaction; a route declaration cannot express them.
 */
export default fp(
  async function adminRoutes(app: GwcApp) {
    const controller = createAdminsController(app)
    const read = {
      auth: { audience: 'staff', module: 'admins', flag: 'read' }, budget: 'admin-read', rateLimit: app.bucket('admin-api'),
    } as const

    const write = {
      auth: { audience: 'staff', module: 'admins', flag: 'edit' }, budget: 'admin-write', rateLimit: app.bucket('admin-api'),
    } as const

    app.addHook('onSend', async (request, reply: FastifyReply, payload) => {
      if (request.url.startsWith('/admin/admins')) reply.header('cache-control', 'private, no-store')
      return payload
    })

    app.get(
      '/admin/admins',
      { config: read, onRequest: app.guard, schema: { response: { 200: adminListResponseSchema } } },
      controller.list,
    )

    app.patch(
      '/admin/admins/:id',
      {
        config: write,
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string().uuid() }),
          body: updateAdminRequestSchema,
          response: { 200: adminAccountSchema },
        },
      },
      controller.update,
    )
  },
  { name: 'admin-routes' },
)

import fp from 'fastify-plugin'
import { dashboardFiguresResponseSchema } from '@gwc/contracts/admin'
import { createAdminDashboardController } from './controller.ts'
import type { FastifyReply } from 'fastify'
import type { GwcApp } from '../../app.ts'

/**
 * The superadmin dashboard figures (feature 028, contracts/admin-api.md).
 *
 * `/admin` is already a gated, never-indexed surface. Responses are
 * `private, no-store`: a count of the club's members is not for a shared cache.
 */
export default fp(
  async function adminDashboardRoutes(app: GwcApp) {
    const controller = createAdminDashboardController(app)

    app.addHook('onSend', async (request, reply: FastifyReply, payload) => {
      if (request.url.startsWith('/admin/dashboard')) reply.header('cache-control', 'private, no-store')
      return payload
    })

    app.get(
      '/admin/dashboard/figures',
      {
        config: {
          auth: { audience: 'staff', module: 'admins', flag: 'read' },
          budget: 'admin-read',
          rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: { response: { 200: dashboardFiguresResponseSchema } },
      },
      controller.figures,
    )
  },
  { name: 'admin-dashboard-routes' },
)

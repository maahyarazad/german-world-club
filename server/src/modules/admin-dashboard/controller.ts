import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden } from '../../authz/require-permission.ts'
import { computeFigures } from './application/figures.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/** Request and reply shaping for the superadmin dashboard. The counts live in `application/`. */
export function createAdminDashboardController(app: GwcApp) {
  return {
    figures: async (request: GwcRequest, reply: GwcReply) => {
      // The posture vocabulary has no "superadmin only" (plan D6), so the route
      // declares module `admins` + `read` and the handler refuses everyone else.
      // A superadmin bypasses the module check; a plain staff member holding
      // `admins.read` gets past it and stops here.
      if (!request.permissions?.isSuperadmin) {
        await app.auditDenial(request, { requiredPermission: 'superadmin', targetType: 'dashboard', targetId: null })
        throw forbidden(PROBLEMS.CANNOT_MANAGE_ADMIN, 'Only a superadmin may view club-wide figures.')
      }
      return reply.send(await computeFigures(app.pg, {
        signal: request.deadlineSignal,
        log: (key, error) => app.log.error({ err: error, figure: key }, 'DASHBOARD_FIGURE_FAILED'),
      }))
    },
  }
}

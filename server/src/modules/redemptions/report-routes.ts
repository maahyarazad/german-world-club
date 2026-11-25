import fp from 'fastify-plugin'
import { redemptionReportQuerySchema, redemptionReportSchema } from '@gwc/contracts/redemptions'
import type { RedemptionReportQuery } from '@gwc/contracts/redemptions'
import { redemptionReport } from './application/report.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Redemption reports (feature 035): schema, posture and wiring.
 *
 *   GET /merchant/reports/redemptions   a merchant's own organisation only
 *   GET /admin/reports/redemptions      the whole platform; `merchant_offers.read`
 *
 * The same function answers both, with the scope fixed by the route: the merchant
 * route passes the organisation from the session and ignores any
 * `organisationId` in the query, so a parameter cannot widen it. A superadmin
 * passes the module check by the usual rule; any other staff member needs the
 * grant, and one without it is refused before the handler runs.
 */
export default fp(
  async function redemptionReportRoutes(app: GwcApp) {
    app.get('/merchant/reports/redemptions', {
      config: { auth: { audience: 'merchant' }, budget: 'admin-read', rateLimit: app.bucket('member-api') },
      onRequest: app.guard,
      schema: { querystring: redemptionReportQuerySchema, response: { 200: redemptionReportSchema } },
    }, async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await redemptionReport(app, {
        scope: { organisationId: String(request.principal!.organisationId) },
        filters: request.query as RedemptionReportQuery,
        signal: request.deadlineSignal,
      })))

    app.get('/admin/reports/redemptions', {
      config: {
        auth: { audience: 'staff', module: 'merchant_offers', flag: 'read' },
        budget: 'admin-read', rateLimit: app.bucket('admin-api'),
      },
      onRequest: app.guard,
      schema: { querystring: redemptionReportQuerySchema, response: { 200: redemptionReportSchema } },
    }, async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await redemptionReport(app, {
        scope: 'platform', filters: request.query as RedemptionReportQuery, signal: request.deadlineSignal,
      })))
  },
  { name: 'redemption-report-routes', dependencies: ['auth', 'rate-limit'] },
)

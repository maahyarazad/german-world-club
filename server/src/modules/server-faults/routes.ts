import fp from 'fastify-plugin'
import { z } from 'zod'
import { REQUEST_ID, CLIENT_REQUEST_ID } from '@gwc/contracts/request-id'
import { FINGERPRINT } from '@gwc/contracts/server-faults'
import { createServerFaultsController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Staff reads of server fault records (feature 012, contracts/server-faults-api.md).
 *
 * Gated on the `server_faults` module, `read` only. `write`, `edit`, `delete`
 * and `status` are used by NOTHING here, on purpose: a record is never edited,
 * and only the retention job removes one. A reader who finds only GET routes
 * should see that as the decision, not an omission — the lookup suite asserts
 * every other method answers 404.
 *
 * `/admin` is already gated and never indexed in `seo/surfaces.ts`, so the
 * crawl posture is inherited rather than declared again here.
 */

const posture = (app: GwcApp) => ({
  config: {
    auth: { audience: 'staff' as const, module: 'server_faults' as const, flag: 'read' as const },
    budget: 'admin-read', rateLimit: app.bucket('admin-api'),
  },
  onRequest: app.guard,
})

const date = z.union([z.string(), z.date()])

export const faultSummarySchema = z.object({
  id: z.string(),
  occurredAt: date,
  requestId: z.string(),
  clientRequestId: z.union([z.string(), z.null()]),
  method: z.string(),
  route: z.union([z.string(), z.null()]),
  status: z.number(),
  errorName: z.string(),
  errorCode: z.union([z.string(), z.null()]),
  message: z.string(),
  principalKind: z.union([z.string(), z.null()]),
  principalId: z.union([z.string(), z.null()]),
  fingerprint: z.string(),
})

const faultSchema = faultSummarySchema.extend({ stack: z.union([z.string(), z.null()]) })

export default fp(
  async function serverFaultRoutes(app: GwcApp) {
    const controller = createServerFaultsController(app)

    app.get(
      '/admin/server-faults',
      {
        ...posture(app),
        schema: {
          querystring: z.object({
            // Opaque; list.ts decodes it and refuses one it did not issue.
            before: z.string().max(200).optional(),
            fingerprint: z.string().regex(FINGERPRINT).optional(),
            clientRequestId: z.string().regex(CLIENT_REQUEST_ID).optional(),
            limit: z.coerce.number().int().min(1).max(100).default(50),
          }),
          response: {
            200: z.object({
              items: z.array(faultSummarySchema),
              nextCursor: z.union([z.string(), z.null()]),
              suppressedLast24h: z.number(),
            }),
          },
        },
      },
      controller.list,
    )

    app.get(
      '/admin/server-faults/by-request/:requestId',
      {
        ...posture(app),
        schema: {
          // A ULID only. A client's own correlation id is a list filter, never
          // a lookup key (research R10).
          params: z.object({ requestId: z.string().regex(REQUEST_ID) }),
          response: { 200: z.object({ item: faultSchema }) },
        },
      },
      controller.lookup,
    )
  },
  { name: 'server-fault-routes' },
)

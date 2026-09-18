import fp from 'fastify-plugin'
import { z } from 'zod'
import { createOrganisationsController } from './controller.js'

/**
 * The merchant and partner portals' first surface (FR-012, data-model.md §1):
 * schema, access posture, and wiring to `controller.js` only. See
 * `application/get-organisation.js` for the scope-guarded lookups.
 *
 * Two routes per kind, deliberately:
 *
 *  - `/{kind}/organisation` — "mine", which needs no id and so cannot be
 *    pointed at anyone else's row.
 *  - `/{kind}/organisations/:id` — the same row by id, which *can* be pointed
 *    at anyone else's row and is therefore the one with the object guard on it.
 *
 * The second route is not a convenience. Every organisation-scoped route this
 * platform grows will take an id, and having one now means the scoping rule is
 * written, tested and enforced before there are ten routes to retrofit it onto.
 *
 * Merchant and partner get separate paths rather than one `/organisation`
 * serving both. The audience is declared per route and checked at token
 * verification, so two paths means a merchant token is refused at
 * `/partner/...` before any handler runs — the isolation is in the route table
 * rather than in a branch inside a handler that someone can later forget.
 */

const organisationSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['merchant', 'partner']),
  legalName: z.string(),
  slug: z.string(),
  status: z.string(),
  contractStart: z.string().nullable(),
  contractEnd: z.string().nullable(),
  feeTier: z.string().nullable(),
  locationCount: z.number().int().nullable(),
  employeeCount: z.number().int().nullable(),
  role: z.enum(['owner', 'manager', 'staff']),
})

export default fp(
  async function organisationRoutes(app) {
    const controller = createOrganisationsController(app)
    const params = z.object({ id: z.string().uuid() })

    for (const kind of ['merchant', 'partner']) {
      app.get(
        `/${kind}/organisation`,
        {
          config: { auth: { audience: kind }, budget: 'member-read', rateLimit: app.bucket('member-api') },
          onRequest: app.guard,
          schema: { response: { 200: organisationSchema } },
        },
        controller.getOwn,
      )

      app.get(
        `/${kind}/organisations/:id`,
        {
          config: { auth: { audience: kind }, budget: 'member-read', rateLimit: app.bucket('member-api') },
          onRequest: app.guard,
          schema: { params, response: { 200: organisationSchema } },
        },
        controller.getById,
      )
    }
  },
  { name: 'organisation-routes', dependencies: ['auth', 'rate-limit'] },
)

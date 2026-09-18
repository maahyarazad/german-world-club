import fp from 'fastify-plugin'
import { z } from 'zod'
import { withTransaction } from '../db/query.js'
import { guardOrganisationScope } from '../authz/object-guards.js'

/**
 * The merchant and partner portals' first surface (FR-012, data-model.md §1).
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

const asDate = (value) => (value === null || value === undefined ? null : new Date(value).toISOString().slice(0, 10))

const toResponse = (row, role) => ({
  id: row.id,
  kind: row.kind,
  legalName: row.legal_name,
  slug: row.slug,
  status: row.status,
  contractStart: asDate(row.contract_start),
  contractEnd: asDate(row.contract_end),
  feeTier: row.fee_tier ?? null,
  locationCount: row.location_count ?? null,
  employeeCount: row.employee_count ?? null,
  role,
})

export default fp(
  async function organisationRoutes(app) {
    const params = z.object({ id: z.string().uuid() })

    const load = (client, id) =>
      client
        .query('SELECT * FROM organisations WHERE id = $1', [id])
        .then(({ rows }) => rows[0] ?? null)

    for (const kind of ['merchant', 'partner']) {
      app.get(
        `/${kind}/organisation`,
        {
          config: { auth: { audience: kind }, budget: 'member-read', rateLimit: app.bucket('member-api') },
          onRequest: app.guard,
          schema: { response: { 200: organisationSchema } },
        },
        async (request, reply) => {
          // `organisationId` comes from the database on this request, not from
          // the token (10-auth.js), so a principal moved between organisations
          // reads the new one immediately.
          const row = await load(app.pg, request.principal.organisationId)
          return reply.send(toResponse(row, request.principal.role))
        },
      )

      app.get(
        `/${kind}/organisations/:id`,
        {
          config: { auth: { audience: kind }, budget: 'member-read', rateLimit: app.bucket('member-api') },
          onRequest: app.guard,
          schema: { params, response: { 200: organisationSchema } },
        },
        async (request, reply) => {
          const row = await withTransaction(app.pg, async (client) => {
            // Loaded inside the transaction and guarded before anything is
            // returned — the same ordering every object guard uses, so a read
            // route and a write route enforce scope identically.
            const target = await load(client, request.params.id)
            await guardOrganisationScope(app, request, target)
            return target
          })
          return reply.send(toResponse(row, request.principal.role))
        },
      )
    }
  },
  { name: 'organisation-routes', dependencies: ['auth', 'rate-limit'] },
)

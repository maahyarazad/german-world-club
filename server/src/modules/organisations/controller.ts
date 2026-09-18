import { loadOwnOrganisation, loadOrganisationById } from './application/get-organisation.ts'

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

export function createOrganisationsController(app) {
  return {
    getOwn: async (request, reply) => {
      const row = await loadOwnOrganisation(app, { organisationId: request.principal.organisationId })
      return reply.send(toResponse(row, request.principal.role))
    },

    getById: async (request, reply) => {
      const row = await loadOrganisationById(app, request, { id: request.params.id })
      return reply.send(toResponse(row, request.principal.role))
    },
  }
}

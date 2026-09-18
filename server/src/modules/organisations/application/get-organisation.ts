import { withTransaction } from '../../../db/query.ts'
import { guardOrganisationScope } from '../../../authz/object-guards.ts'
import type { FastifyRequest } from 'fastify'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'

const load = (client: PoolClient, id) =>
  client
    .query('SELECT * FROM organisations WHERE id = $1', [id])
    .then(({ rows }) => rows[0] ?? null)

/**
 * `organisationId` comes from the database on this request, not from the
 * token (10-auth.js), so a principal moved between organisations reads the
 * new one immediately.
 */
export async function loadOwnOrganisation(app: GwcApp, { organisationId }) {
  return load(app.pg, organisationId)
}

/**
 * Loaded inside the transaction and guarded before anything is returned —
 * the same ordering every object guard uses, so a read route and a write
 * route enforce scope identically.
 *
 * `guardOrganisationScope` takes the raw `request`: it is the shared Layer-2
 * object guard used across the codebase, keyed off `request.principal`.
 */
export async function loadOrganisationById(app: GwcApp, request: FastifyRequest, { id }) {
  return withTransaction(app.pg, async (client: PoolClient) => {
    const target = await load(client, id)
    await guardOrganisationScope(app, request, target)
    return target
  })
}

import { FLAGS, MODULES } from '@gwc/contracts/permissions'
import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Only the modules where at least one flag is true.
 *
 * Absence is denial everywhere else in this system, and it has to mean the
 * same thing here. Sending nineteen all-false objects would say nothing
 * while inviting a client to render a sidebar entry for every module in
 * existence — which is exactly the drift the capability contract exists to
 * prevent.
 *
 * A superadmin bypasses the module matrix at enforcement time (the absence of
 * the check, not a wildcard grant), so their snapshot is reported as every
 * flag on every module. The console needs the effective answer, not the
 * stored one.
 */
export function grantedModules(snapshot) {
  const allFlags = () => Object.fromEntries(FLAGS.map((flag) => [flag, true]))

  if (snapshot.isSuperadmin) {
    return Object.fromEntries(MODULES.map((module) => [module, allFlags()]))
  }

  const granted = {}
  for (const [module, grant] of Object.entries(snapshot.modules ?? {})) {
    if (FLAGS.some((flag) => grant?.[flag] === true)) {
      granted[module] = Object.fromEntries(FLAGS.map((flag) => [flag, grant?.[flag] === true]))
    }
  }
  return granted
}

/**
 * GET /auth/session — the capability snapshot the console boots from.
 *
 * Everything here is resolved at request time from server-held state. None
 * of it is a token claim, so a grant revoked a second ago is already gone
 * from this response (Constitution Principle II).
 */
export async function loadSession(app: GwcApp, { principal, permissions, signal }) {
  if (principal.kind === 'merchant' || principal.kind === 'partner') {
    return loadOrganisationSession(app, { principal, signal })
  }

  const snapshot = permissions ?? (await app.permissions.resolve(principal.id, { signal }))

  return {
    kind: 'staff',
    id: principal.id,
    displayName: snapshot.displayName ?? null,
    isSuperadmin: snapshot.isSuperadmin,
    modules: grantedModules(snapshot),
    available: app.availableModules(),
  }
}

/**
 * The organisation variant (contracts/capability-api.md: merchant, partner).
 *
 * No module matrix — an organisation principal's reach is its own
 * organisation and its role there, both of which `applyOrganisationGates`
 * has already resolved from the database for this request and refused on if
 * either the person or the organisation is not active. Read again here only
 * for the organisation's name, which the gate does not load.
 *
 * `available` is empty rather than `app.availableModules()`: that list answers
 * "which staff modules have a server surface", which says nothing about what
 * an organisation principal may reach, and a console that read it would offer
 * them the Admin Panel's navigation.
 */
async function loadOrganisationSession(
  app: GwcApp,
  { principal, signal }: {
    principal: { id: string; kind: 'merchant' | 'partner'; organisationId?: string }
    signal?: AbortSignal
  },
) {
  const { rows } = await query(
    app.pg,
    `SELECT ou.display_name, ou.role, o.id AS organisation_id, o.legal_name, o.status
       FROM organisation_users ou
       JOIN organisations o ON o.id = ou.organisation_id
      WHERE ou.id = $1 AND o.id = $2`,
    [principal.id, principal.organisationId],
    { signal },
  )
  const row = rows[0]
  // The gate ran on this same request, so a missing row means the account
  // or its organisation changed in between — the same answer the gate gives.
  if (!row) throw forbidden(PROBLEMS.SESSION_REVOKED, 'This account no longer exists.')

  return {
    kind: principal.kind,
    id: principal.id,
    displayName: row.display_name ?? null,
    organisationId: row.organisation_id,
    organisationName: row.legal_name,
    organisationStatus: row.status,
    role: row.role,
    available: [],
  }
}

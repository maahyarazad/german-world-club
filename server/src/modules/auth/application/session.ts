import { FLAGS, MODULES } from '@gwc/contracts/permissions'

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
export async function loadSession(app, { principal, permissions, signal }) {
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

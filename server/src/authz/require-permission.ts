import { PROBLEMS } from '@gwc/contracts/errors'
import { permits } from './permissions.ts'

/**
 * Layer 1 — module capability (FR-007, FR-008, FR-015).
 *
 * A `preHandler` that reads the route's own declaration and the caller's
 * server-side snapshot. It answers exactly one question: may this principal use
 * this flag on this module at all?
 *
 * What it deliberately does **not** answer is whether they may use it on *this
 * particular row*. That depends on the target, is invisible in a route
 * declaration, and lives in `object-guards.js` — collapsing the two is how the
 * escalation path in FR-009 gets lost.
 */

export class AuthorizationError extends Error {
  constructor(problem, detail) {
    super(detail ?? problem.title)
    this.name = 'AuthorizationError'
    this.problem = problem
    this.statusCode = problem.status
    // `detail` is safe to show: it names a required permission, not an internal.
    this.safeDetail = detail
  }
}

export const forbidden = (problem, detail) => new AuthorizationError(problem, detail)

/**
 * Build the preHandler. `app` supplies the resolver and the audit writer, so
 * the same function serves every staff route without each one wiring them.
 */
export function makeRequirePermission(app) {
  return async function requirePermission(request) {
    const auth = request.routeOptions?.config?.auth
    if (auth?.audience !== 'staff') return

    const principal = request.principal
    if (!principal) throw forbidden(PROBLEMS.UNAUTHENTICATED, 'Authentication required.')

    const snapshot = await app.permissions.resolve(principal.id, { signal: request.deadlineSignal })

    if (!snapshot.isActive) {
      await app.auditDenial(request, { requiredPermission: `${auth.module}.${auth.flag}`, reason: 'account-inactive' })
      throw forbidden(PROBLEMS.ACCOUNT_INACTIVE, 'This staff account is not active.')
    }

    /**
     * An `anyStaff` route has no module to check.
     *
     * The account still had to authenticate as staff and still had to pass the
     * active-account check above — this is not an unguarded route, it is a
     * route whose posture is "any authenticated staff principal". The
     * capability endpoint is the case it exists for: a staff member must be
     * able to read their own grants without already holding one.
     *
     * Placed after the active check and before the superadmin bypass so the
     * ordering reads the same for every staff route.
     */
    if (auth.anyStaff === true) {
      request.permissions = snapshot
      return
    }

    // FR-008: a superadmin bypasses the module matrix entirely. Not a wildcard
    // grant — the absence of the check.
    if (snapshot.isSuperadmin) {
      request.permissions = snapshot
      return
    }

    if (!permits(snapshot, auth.module, auth.flag)) {
      await app.auditDenial(request, { requiredPermission: `${auth.module}.${auth.flag}` })
      throw forbidden(
        PROBLEMS.INSUFFICIENT_PERMISSION,
        `Requires '${auth.flag}' on module '${auth.module}'.`,
      )
    }

    request.permissions = snapshot
  }
}

import fp from 'fastify-plugin'
import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../db/query.js'
import { createDenylist, loadSession } from '../auth/sessions.js'
import { createPermissionResolver } from '../authz/permissions.js'
import { makeRequirePermission, forbidden } from '../authz/require-permission.js'

/**
 * Authentication, and the member-side gates (FR-003, FR-010, FR-011, FR-012).
 *
 * This plugin turns a verified token into `request.principal` and then decides
 * whether that principal may proceed *at all* — status, email confirmation,
 * device approval, session revocation. It runs before Layer 1, because a
 * suspended account should never reach a permission check.
 *
 * Every one of these reads live state. None of them is a token claim, for the
 * same reason permissions are not: a member can be locked between sign-in and
 * their next request, and the next request is when it must take effect.
 */

/** The token audience each route audience expects. */
const TOKEN_AUDIENCE = Object.freeze({ member: 'member', staff: 'admin' })

/** §3.2's state machine, with the remedy each refusal carries. */
const STATUS_REFUSAL = Object.freeze({
  locked: { problem: PROBLEMS.ACCOUNT_LOCKED, detail: 'This account is locked. Please contact support.' },
  inactive: { problem: PROBLEMS.ACCOUNT_INACTIVE, detail: 'This account is inactive. Reset your password to reactivate it.' },
  ended: { problem: PROBLEMS.MEMBERSHIP_ENDED, detail: 'This membership has ended.' },
})

export default fp(
  async function auth(app) {
    const denylist = createDenylist(app.redis)
    const permissions = createPermissionResolver(app.pg)

    app.decorate('denylist', denylist)
    app.decorate('permissions', permissions)
    app.decorateRequest('principal', null)
    app.decorateRequest('permissions', null)

    /** One place every denial is recorded from, so FR-015 cannot be half-applied. */
    app.decorate('auditDenial', async (request, { requiredPermission = null, targetType = null, targetId = null, reason = null } = {}) => {
      try {
        await app.audit({
          action: 'permission_denied',
          outcome: 'denied',
          requestId: request.id,
          actorId: request.principal?.id ?? null,
          actorKind: request.principal?.kind ?? null,
          targetType,
          targetId,
          requiredPermission,
          detail: reason ? { reason } : null,
        })
      } catch (err) {
        // An audit failure must not convert a clean 403 into a 500; the denial
        // still stands and the write failure is itself logged.
        request.log.error({ err }, 'audit write failed')
      }
    })

    /** Load the live member row behind a token. */
    async function loadMember(memberId, signal) {
      const { rows } = await query(
        app.pg,
        `SELECT id, email_confirmed_at, status, display_name, permissions
           FROM members WHERE id = $1`,
        [memberId],
        { signal },
      )
      return rows[0] ?? null
    }

    async function deviceApproved(memberId, deviceId, signal) {
      if (!deviceId) return true // web has no device binding (§6.1 is mobile)
      const { rows } = await query(
        app.pg,
        'SELECT state FROM device_approvals WHERE member_id = $1 AND device_id = $2',
        [memberId, deviceId],
        { signal },
      )
      // Absence is not approval. A new device simply has no row, which is how
      // §12.6's "changing device invalidates approval" falls out of the key.
      return rows[0]?.state === 'approved'
    }

    /**
     * The authentication preHandler. Registered per route by `app.authenticate`
     * rather than globally, so a public route costs nothing.
     */
    app.decorate('authenticate', async function authenticate(request) {
      const auth = request.routeOptions?.config?.auth
      if (!auth || auth.audience === 'public') return

      const expected = TOKEN_AUDIENCE[auth.audience]

      let claims
      try {
        claims = await app.verifyAccessToken(request, expected)
      } catch (err) {
        // A member token on a staff route fails HERE — at verification, before
        // any handler — which is what FR-003 asks for.
        //
        // It is a 403, not a 401: the credential is valid, it simply is not for
        // this audience. Answering 401 would invite the client to re-
        // authenticate, which cannot help, and would blur the distinction
        // http-conventions.md §2 draws between the two.
        if (err.code === 'FST_JWT_BAD_AUDIENCE') {
          await app.auditDenial(request, { requiredPermission: `audience:${expected}`, reason: 'audience-mismatch' })
          throw forbidden(PROBLEMS.INSUFFICIENT_PERMISSION, 'This credential is not valid for this interface.')
        }
        throw forbidden(PROBLEMS.UNAUTHENTICATED, 'A valid access token is required.')
      }

      // Session-level revocation. The denylist closes the window between a
      // revocation and the token's own ten-minute expiry.
      if (await denylist.has(claims.sid)) {
        throw forbidden(PROBLEMS.SESSION_REVOKED, 'This session has been ended.')
      }

      const session = await loadSession(app.pg, claims.sid, { signal: request.deadlineSignal })
      if (!session || session.revoked_at !== null) {
        throw forbidden(PROBLEMS.SESSION_REVOKED, 'This session has been ended.')
      }

      request.principal = {
        id: claims.sub,
        kind: claims.aud,
        sid: claims.sid,
        deviceId: session.device_id ?? null,
      }

      if (claims.aud === 'member') {
        await applyMemberGates(request, auth)
      }
    })

    /** FR-010, FR-011, FR-012 — state gates, not permissions. */
    async function applyMemberGates(request, auth) {
      const member = await loadMember(request.principal.id, request.deadlineSignal)
      if (!member) throw forbidden(PROBLEMS.SESSION_REVOKED, 'This account no longer exists.')

      const refusal = STATUS_REFUSAL[member.status]
      if (refusal) throw forbidden(refusal.problem, refusal.detail)

      if (member.email_confirmed_at === null) {
        throw forbidden(PROBLEMS.PROFILE_INCOMPLETE, 'Confirm your email address to continue.')
      }

      if (!(await deviceApproved(member.id, request.principal.deviceId, request.deadlineSignal))) {
        throw forbidden(PROBLEMS.APPROVAL_PENDING, 'This device is waiting for approval.')
      }

      // Per-member permission flags (§7). Members have no module matrix; these
      // are the whole of their grantable capability set.
      const granted = member.permissions ?? {}
      request.permissions = { kind: 'member', flags: granted, displayName: member.display_name }

      if (auth.requires && granted[auth.requires] !== true) {
        await app.auditDenial(request, { requiredPermission: auth.requires })
        throw forbidden(PROBLEMS.PERMISSION_REQUIRED, `This action requires the '${auth.requires}' permission.`)
      }
    }

    app.decorate('requirePermission', makeRequirePermission(app))

    /**
     * The hook chain every non-public route uses. One value, so a route cannot
     * apply authentication without authorization — the pair travels together.
     *
     * Attached at **onRequest**, not `preHandler`: schema validation runs
     * between the two, and an unauthenticated caller must be told 401 rather
     * than handed a 400 describing the body the route expects. Answering the
     * validation error first would let anyone map the admin API's shape
     * without a credential.
     */
    app.decorate('guard', [app.authenticate, app.requirePermission])
  },
  { name: 'auth', dependencies: ['jwt', 'db', 'redis', 'deadline'] },
)

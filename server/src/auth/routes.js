import fp from 'fastify-plugin'
import { PROBLEMS } from '@gwc/contracts/errors'
import {
  signInRequestSchema, signInResponseSchema,
  verifyOtpRequestSchema, resendOtpRequestSchema, resendOtpResponseSchema,
  refreshRequestSchema, tokenPairResponseSchema,
  passwordResetRequestSchema, passwordResetConfirmSchema, passwordResetAcceptedSchema,
  meResponseSchema,
  COOKIES, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TTL_DAYS,
  OTP_TTL_SECONDS, OTP_RESEND_COOLDOWN_SECONDS, PASSWORD_RESET_TTL_SECONDS,
} from '@gwc/contracts/auth'
import { sessionResponseSchema } from '@gwc/contracts/capabilities'
import { csrfTokenResponseSchema } from '@gwc/contracts/auth'
import { FLAGS, MODULES } from '@gwc/contracts/permissions'
import { z } from 'zod'

import { query, withTransaction } from '../db/query.js'
import {
  verifyPassword, verifyAgainstDummy, hashPassword, credentialState, CREDENTIAL_STATE,
} from './passwords.js'
import { generateOpaqueToken, hashRefreshToken } from './tokens.js'
import {
  startSession, rotateRefreshToken, revokeSession, revokeAllSessions, REFRESH_OUTCOME,
} from './sessions.js'
import { issueChallenge, verifyChallenge, loadChallenge, maskPhone, OTP_OUTCOME } from './otp.js'
import { forbidden } from '../authz/require-permission.js'

/**
 * The authentication endpoints (auth-api.md).
 *
 * Two rules run through all of them and are worth stating once:
 *
 *   - **Non-enumeration.** An unknown address and a wrong password are
 *     indistinguishable in body, status code and timing, and a reset request
 *     always returns 202. Account existence is not a public fact for an
 *     invite-only club (§3.1).
 *   - **A status gate issues no token** (FR-010). Each returns its §3.2 remedy
 *     instead: locked ⇒ contact support, inactive ⇒ reset to reactivate, ended
 *     ⇒ no remedy.
 */

/** Gated and credential responses are never cached — by a browser or a proxy. */
const NO_STORE = 'private, no-store'

/** A member signing in from a device is on mobile; anyone else is a browser. */
const faceFor = (body) => (body?.deviceId ? 'mobile' : 'web')

function setAuthCookies(reply, { accessToken, refreshToken, secure }) {
  reply.setCookie(COOKIES.access, accessToken, {
    httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: ACCESS_TOKEN_TTL_SECONDS,
  })
  if (refreshToken) {
    // Scoped to the one path that consumes it, and SameSite=Strict: a refresh
    // token is the credential that outlives the browser session, so it travels
    // as narrowly as possible.
    reply.setCookie(COOKIES.refresh, refreshToken, {
      httpOnly: true, secure, sameSite: 'strict', path: '/auth/refresh',
      maxAge: REFRESH_TTL_DAYS.web * 86_400,
    })
  }
}

function clearAuthCookies(reply) {
  reply.clearCookie(COOKIES.access, { path: '/' })
  reply.clearCookie(COOKIES.refresh, { path: '/auth/refresh' })
}

/**
 * Entitlement at point of use (FR-013, §12.2).
 *
 * No membership-card table is in scope, so this resolves to `null`. It exists
 * now so the *contract* is fixed here: entitlement is looked up from the card's
 * validity window at the moment it is needed, and the card feature supplies a
 * query rather than a new rule. A cached tier column is exactly how a lapsed
 * card would keep granting free events.
 */
/**
 * Only the modules where at least one flag is true.
 *
 * Absence is denial everywhere else in this system, and it has to mean the same
 * thing here. Sending nineteen all-false objects would say nothing while
 * inviting a client to render a sidebar entry for every module in existence —
 * which is exactly the drift the capability contract exists to prevent.
 *
 * A superadmin bypasses the module matrix at enforcement time (the absence of
 * the check, not a wildcard grant), so their snapshot is reported as every flag
 * on every module. The console needs the effective answer, not the stored one.
 */
function grantedModules(snapshot) {
  const allFlags = () => Object.fromEntries(FLAGS.map((flag) => [flag, true]))

  // A superadmin holds no rows at all — the bypass is the *absence* of the
  // check, not a wildcard grant — so reading their stored matrix would answer
  // "nothing" for the one account that may do everything. The console needs
  // the effective answer.
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

export async function resolveEntitlement() {
  return null
}

export default fp(
  async function authRoutes(app) {
    const secureCookies = app.env.isProduction

    // Both sign-in buckets are checked independently (SC-013). Per-address
    // alone is defeated by a botnet spraying one account; per-account alone
    // lets one address enumerate the member base and is itself an
    // account-lockout weapon.
    // `rateLimitIndependent`, not `rateLimit`: the route already spends the
    // per-address bucket at onRequest, and a plain second limiter would see the
    // library's once-per-request marker and never count. See 07-rate-limit.js.
    const limitSignInAccount = app.rateLimitIndependent({
      ...app.bucket('sign-in-account'),
      keyGenerator: (request) => `sign-in-account:${String(request.body?.email ?? '').toLowerCase()}`,
    })
    const limitOtpSend = app.rateLimit({
      ...app.bucket('otp-send'),
      keyGenerator: (request) => `otp-send:${request.otpPhoneKey ?? request.ip}`,
    })

    const publicAuth = (bucket) => ({
      config: { auth: { audience: 'public' }, budget: 'auth', rateLimit: app.bucket(bucket) },
    })

    /** Every auth response carries no-store: a cached credential response is a leak. */
    app.addHook('onSend', async (request, reply, payload) => {
      if (request.url.startsWith('/auth/')) reply.header('cache-control', NO_STORE)
      return payload
    })

    // ---- Account lookup -----------------------------------------------------

    async function findAccount(email, signal) {
      const { rows: members } = await query(
        app.pg,
        `SELECT id, email, password_hash, password_reset_required, status, email_confirmed_at,
                mobile, mobile_verified_at, display_name
           FROM members WHERE email = $1`,
        [email],
        { signal },
      )
      if (members.length > 0) return { kind: 'member', row: members[0] }

      const { rows: admins } = await query(
        app.pg,
        'SELECT id, email, password_hash, is_active, is_admin, is_superadmin, display_name FROM admin_users WHERE email = $1',
        [email],
        { signal },
      )
      if (admins.length > 0) return { kind: 'admin', row: admins[0] }

      /**
       * Organisation principals — club merchants and corporate club partners.
       *
       * Looked up last because they are the smallest population, and resolved
       * here rather than through a parallel auth path: they ride the same
       * sessions, the same refresh rotation and the same denylist, each of
       * which is already correct once.
       *
       * `email` is unique per organisation rather than globally, so the same
       * address could in principle act for two. The first active row wins for
       * sign-in; picking an organisation is a later problem and not one a
       * credential should silently answer.
       */
      const { rows: orgUsers } = await query(
        app.pg,
        `SELECT ou.id, ou.email, ou.password_hash, ou.status, ou.role, ou.display_name,
                ou.organisation_id, o.kind AS organisation_kind, o.status AS organisation_status,
                o.legal_name AS organisation_name
           FROM organisation_users ou
           JOIN organisations o ON o.id = ou.organisation_id
          WHERE ou.email = $1
          ORDER BY (ou.status = 'active') DESC, ou.created_at ASC
          LIMIT 1`,
        [email],
        { signal },
      )
      if (orgUsers.length > 0) {
        return { kind: orgUsers[0].organisation_kind, row: orgUsers[0] }
      }

      return null
    }

    const invalidCredentials = () =>
      forbidden(PROBLEMS.INVALID_CREDENTIALS, 'Those credentials are not valid.')

    // ---- GET /auth/csrf -----------------------------------------------------

    /**
     * Mints the CSRF secret cookie and returns the matching token.
     *
     * Without this the double-submit check in app.js could never pass from a
     * browser: the secret cookie was configured but nothing ever called
     * `reply.generateCsrf()`, so every cookie-borne POST — sign-out, every
     * write in the console — was refused with "Missing csrf secret". The check
     * was doing its job; there was simply no way to satisfy it.
     *
     * Public, because it has to be: the console needs a token after a page
     * reload, before it knows whether it is signed in. That is safe. The token
     * is worthless without the secret cookie set by this same response, and an
     * attacker's page cannot read either — the point of a double submit is that
     * the attacker can send the cookie but cannot read it to echo it back.
     *
     * `no-store`, and a fresh secret each call: a token left in a shared cache
     * would let one visitor's token be replayed by the next.
     */
    app.get(
      '/auth/csrf',
      {
        config: { auth: { audience: 'public' }, budget: 'auth' },
        schema: { response: { 200: csrfTokenResponseSchema } },
      },
      async (request, reply) => {
        reply.header('cache-control', NO_STORE)
        return reply.send({ csrfToken: reply.generateCsrf() })
      },
    )

    // ---- POST /auth/sign-in -------------------------------------------------

    app.post(
      '/auth/sign-in',
      {
        ...publicAuth('sign-in-ip'),
        preHandler: limitSignInAccount,
        schema: { body: signInRequestSchema, response: { 200: signInResponseSchema } },
      },
      async (request, reply) => {
        const { email, password, deviceId } = request.body
        const signal = request.deadlineSignal
        const face = faceFor(request.body)
        const account = await findAccount(email, signal)

        // The dummy verification runs for a missing account, so an unknown
        // address costs the same time as a wrong password.
        if (!account) {
          await verifyAgainstDummy(password)
          await app.audit({ action: 'sign_in_refused', outcome: 'denied', requestId: request.id, detail: { reason: 'no-account' } })
          throw invalidCredentials()
        }

        const { kind, row } = account

        // A legacy MD5 value is treated as already public and is never
        // verified; the account resets instead (FR-014).
        if (credentialState(row) === CREDENTIAL_STATE.RESET_REQUIRED) {
          await verifyAgainstDummy(password)
          await app.audit({
            action: 'sign_in_refused', outcome: 'denied', requestId: request.id,
            actorId: row.id, actorKind: kind, detail: { reason: 'password_reset_required' },
          })
          return reply.send({ outcome: 'password_reset_required' })
        }

        if (!(await verifyPassword(row.password_hash, password))) {
          await app.audit({
            action: 'sign_in_refused', outcome: 'denied', requestId: request.id,
            actorId: row.id, actorKind: kind, detail: { reason: 'bad-password' },
          })
          throw invalidCredentials()
        }

        // ---- Status gates. None of these issues a token (FR-010). ----------
        if (kind === 'member') {
          if (row.status === 'locked') throw forbidden(PROBLEMS.ACCOUNT_LOCKED, 'This account is locked. Please contact support.')
          if (row.status === 'inactive') throw forbidden(PROBLEMS.ACCOUNT_INACTIVE, 'This account is inactive. Reset your password to reactivate it.')
          if (row.status === 'ended') throw forbidden(PROBLEMS.MEMBERSHIP_ENDED, 'This membership has ended.')

          if (row.email_confirmed_at === null) {
            return reply.send({ outcome: 'profile_incomplete' })
          }

          if (deviceId) {
            const { rows: approvals } = await query(
              app.pg,
              'SELECT state FROM device_approvals WHERE member_id = $1 AND device_id = $2',
              [row.id, deviceId],
              { signal },
            )
            if (approvals[0]?.state !== 'approved') {
              return reply.send({ outcome: 'approval_pending' })
            }

            // §6.2: mobile sign-in takes a second factor. No token is issued
            // yet — the challenge is.
            if (row.mobile_verified_at !== null) {
              const challenge = await issueChallenge(app.pg, {
                accountId: row.id, accountKind: 'member', deviceId, purpose: 'login', signal,
              })
              await app.sendOtp?.({ mobile: row.mobile, code: challenge.code })
              return reply.send({
                outcome: 'otp_required',
                challengeId: challenge.challengeId,
                expiresIn: OTP_TTL_SECONDS,
                // Masked: the full number is never echoed pre-authentication.
                sentTo: maskPhone(row.mobile),
              })
            }
          }
        } else if (kind === 'merchant' || kind === 'partner') {
          // The same status vocabulary members use, and the same refusals — an
          // organisation principal is a person with an account, not a special
          // case with its own rules.
          if (row.status === 'locked') throw forbidden(PROBLEMS.ACCOUNT_LOCKED, 'This account is locked. Please contact support.')
          if (row.status !== 'active') throw forbidden(PROBLEMS.ACCOUNT_INACTIVE, 'This account is not active.')
          // An organisation that is suspended or ended cannot be worked on,
          // whatever the state of the person's own account.
          if (row.organisation_status !== 'active' && row.organisation_status !== 'pending') {
            throw forbidden(PROBLEMS.ACCOUNT_INACTIVE, 'This organisation is not active.')
          }
        } else if (!row.is_active) {
          throw forbidden(PROBLEMS.ACCOUNT_INACTIVE, 'This staff account is not active.')
        }

        const session = await startSession(app.pg, {
          accountId: row.id,
          accountKind: kind,
          deviceId: deviceId ?? null,
          userAgent: request.headers['user-agent'] ?? null,
          ip: request.ip,
          face,
        })

        for (const sid of session.supersededSessionIds) await app.denylist.add(sid)

        const { token, expiresIn } = app.mintAccessToken({
          accountId: row.id, sessionId: session.sessionId, audience: kind,
        })

        await app.audit({
          action: 'sign_in', outcome: 'allowed', requestId: request.id,
          actorId: row.id, actorKind: kind, detail: { sessionId: session.sessionId },
        })

        const principal = { id: row.id, kind, displayName: row.display_name ?? null }

        if (face === 'web') {
          setAuthCookies(reply, { accessToken: token, refreshToken: session.refreshToken, secure: secureCookies })
          return reply.send({ outcome: 'authenticated', expiresIn, principal })
        }
        return reply.send({
          outcome: 'authenticated',
          accessToken: token,
          refreshToken: session.refreshToken,
          expiresIn,
          principal,
        })
      },
    )

    // ---- POST /auth/verify-otp ---------------------------------------------

    app.post(
      '/auth/verify-otp',
      {
        ...publicAuth('otp-verify'),
        schema: { body: verifyOtpRequestSchema, response: { 200: tokenPairResponseSchema } },
      },
      async (request, reply) => {
        const { challengeId, code, deviceId } = request.body
        const result = await verifyChallenge(app.pg, { challengeId, code, deviceId })

        if (result.outcome === OTP_OUTCOME.EXPIRED) {
          throw forbidden(PROBLEMS.OTP_EXPIRED, 'This code has expired. Request a new one.')
        }
        if (result.outcome === OTP_OUTCOME.ATTEMPTS_EXCEEDED) {
          await app.audit({ action: 'sign_in_refused', outcome: 'denied', requestId: request.id, detail: { reason: 'otp-attempts' } })
          throw forbidden(PROBLEMS.OTP_ATTEMPTS_EXCEEDED, 'Too many attempts. Request a new code.')
        }
        if (result.outcome !== OTP_OUTCOME.VERIFIED) {
          // A device mismatch answers identically, so a challenge cannot be
          // probed across devices (§12.6).
          throw forbidden(PROBLEMS.INVALID_OTP, 'That code is not valid.')
        }

        const session = await startSession(app.pg, {
          accountId: result.accountId,
          accountKind: result.accountKind,
          deviceId: result.deviceId,
          userAgent: request.headers['user-agent'] ?? null,
          ip: request.ip,
          face: 'mobile',
        })
        for (const sid of session.supersededSessionIds) await app.denylist.add(sid)

        const { token, expiresIn } = app.mintAccessToken({
          accountId: result.accountId, sessionId: session.sessionId, audience: result.accountKind,
        })

        const { rows } = await query(app.pg, 'SELECT display_name FROM members WHERE id = $1', [result.accountId], { signal: request.deadlineSignal })

        await app.audit({
          action: 'sign_in', outcome: 'allowed', requestId: request.id,
          actorId: result.accountId, actorKind: result.accountKind, detail: { sessionId: session.sessionId },
        })

        return reply.send({
          accessToken: token,
          refreshToken: session.refreshToken,
          expiresIn,
          principal: { id: result.accountId, kind: result.accountKind, displayName: rows[0]?.display_name ?? null },
        })
      },
    )

    // ---- POST /auth/otp/resend ---------------------------------------------

    app.post(
      '/auth/otp/resend',
      {
        ...publicAuth('otp-verify'),
        // Keyed on the phone number, not the address: each send costs real
        // money and an address-keyed limit is trivially bypassed.
        preHandler: [
          async (request) => {
            const challenge = await loadChallenge(app.pg, request.body?.challengeId, { signal: request.deadlineSignal })
            request.otpChallenge = challenge
            if (!challenge) return
            const { rows } = await query(app.pg, 'SELECT mobile FROM members WHERE id = $1', [challenge.account_id], { signal: request.deadlineSignal })
            request.otpPhoneKey = rows[0]?.mobile ?? challenge.account_id
          },
          limitOtpSend,
        ],
        schema: { body: resendOtpRequestSchema, response: { 202: resendOtpResponseSchema } },
      },
      async (request, reply) => {
        const challenge = request.otpChallenge
        // A missing or spent challenge answers the same as a fresh one: the
        // resend endpoint must not report whether a challenge exists.
        if (!challenge || challenge.consumed_at !== null) {
          return reply.code(202).send({ resent: true, cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS })
        }

        const sinceIssue = Date.now() - new Date(challenge.created_at).getTime()
        if (sinceIssue < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
          const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN_SECONDS * 1000 - sinceIssue) / 1000)
          reply.header('retry-after', String(retryAfter))
          throw forbidden(PROBLEMS.RATE_LIMITED, `Wait ${retryAfter}s before requesting another code.`)
        }

        const fresh = await issueChallenge(app.pg, {
          accountId: challenge.account_id,
          accountKind: challenge.account_kind,
          deviceId: challenge.device_id,
          purpose: challenge.purpose,
          signal: request.deadlineSignal,
        })
        await app.sendOtp?.({ mobile: request.otpPhoneKey, code: fresh.code })
        return reply.code(202).send({ resent: true, cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS })
      },
    )

    // ---- POST /auth/refresh -------------------------------------------------

    app.post(
      '/auth/refresh',
      {
        ...publicAuth('refresh'),
        schema: { body: refreshRequestSchema, response: { 200: tokenPairResponseSchema } },
      },
      async (request, reply) => {
        const presented = request.body?.refreshToken ?? request.cookies?.[COOKIES.refresh]
        const face = request.body?.refreshToken ? 'mobile' : 'web'
        if (!presented) throw forbidden(PROBLEMS.INVALID_REFRESH_TOKEN, 'No refresh token was presented.')

        const result = await rotateRefreshToken(app.pg, presented, { face })

        if (result.outcome === REFRESH_OUTCOME.REPLAYED) {
          // A replay is compromise, not a retry: the lineage is gone and the
          // session is over. Both the legitimate holder and the attacker must
          // re-authenticate.
          await app.denylist.add(result.sessionId)
          await app.audit({
            action: 'token_reuse', outcome: 'denied', requestId: request.id,
            actorId: result.accountId, actorKind: result.accountKind,
            detail: { sessionId: result.sessionId, reason: 'refresh-token-replay' },
          })
          clearAuthCookies(reply)
          throw forbidden(PROBLEMS.SESSION_REVOKED, 'This session has been ended.')
        }

        if (result.outcome !== REFRESH_OUTCOME.ROTATED) {
          clearAuthCookies(reply)
          throw forbidden(PROBLEMS.INVALID_REFRESH_TOKEN, 'That refresh token is not valid.')
        }

        const { token, expiresIn } = app.mintAccessToken({
          accountId: result.accountId, sessionId: result.sessionId, audience: result.accountKind,
        })

        if (face === 'web') {
          setAuthCookies(reply, { accessToken: token, refreshToken: result.refreshToken, secure: secureCookies })
          return reply.send({ expiresIn })
        }
        return reply.send({ accessToken: token, refreshToken: result.refreshToken, expiresIn })
      },
    )

    // ---- POST /auth/sign-out ------------------------------------------------

    app.post(
      '/auth/sign-out',
      {
        config: { auth: { audience: 'member' }, budget: 'auth' },
        onRequest: app.authenticate,
        schema: { response: { 204: z.null() } },
      },
      async (request, reply) => {
        // Idempotent: a client retrying after a network failure must not see an
        // error for a session that is already gone.
        await revokeSession(app.pg, request.principal.sid, 'logout')
        await app.denylist.add(request.principal.sid)
        await app.audit({
          action: 'session_revoked', outcome: 'allowed', requestId: request.id,
          actorId: request.principal.id, actorKind: request.principal.kind,
          detail: { reason: 'logout', sessionId: request.principal.sid },
        })
        clearAuthCookies(reply)
        return reply.code(204).send()
      },
    )

    /**
     * Staff sign out through the same mechanism, declared separately because a
     * route's audience is part of its posture and cannot be two things at once.
     *
     * `anyStaff`, not `settings.read`. Ending your own session is not a
     * privilege on the settings module, and gating it there meant a staff
     * member holding `seo.read` and nothing else could sign in, do their work,
     * and then be refused when they tried to leave — with no way out but
     * waiting for the token to expire. A grant somebody else controls must
     * never be what keeps you signed in.
     *
     * The route still authenticates as staff and still ends only the caller's
     * own session; what it drops is a module check that never belonged here.
     */
    app.post(
      '/auth/staff/sign-out',
      {
        config: { auth: { audience: 'staff', anyStaff: true }, budget: 'auth' },
        onRequest: app.guard,
        schema: { response: { 204: z.null() } },
      },
      async (request, reply) => {
        await revokeSession(app.pg, request.principal.sid, 'logout')
        await app.denylist.add(request.principal.sid)
        clearAuthCookies(reply)
        return reply.code(204).send()
      },
    )

    // ---- GET /auth/me -------------------------------------------------------

    /**
     * The ONLY place capabilities and entitlement cross the wire, and both are
     * computed at request time. Clients use this to decide what to *display*;
     * they never use it to decide what is *allowed*.
     */
    const meHandler = async (request, reply) => {
      reply.header('cache-control', NO_STORE)
      const principal = request.principal

      if (principal.kind === 'admin') {
        const snapshot = await app.permissions.resolve(principal.id, { signal: request.deadlineSignal })
        return reply.send({
          kind: 'admin',
          id: principal.id,
          displayName: snapshot.displayName ?? null,
          isAdmin: snapshot.isAdmin,
          isSuperadmin: snapshot.isSuperadmin,
          modules: snapshot.modules,
        })
      }

      const { rows } = await query(
        app.pg,
        'SELECT display_name, email_confirmed_at, permissions FROM members WHERE id = $1',
        [principal.id],
        { signal: request.deadlineSignal },
      )
      const member = rows[0] ?? {}
      return reply.send({
        kind: 'member',
        id: principal.id,
        displayName: member.display_name ?? null,
        emailConfirmed: member.email_confirmed_at !== null && member.email_confirmed_at !== undefined,
        permissions: Object.entries(member.permissions ?? {}).filter(([, v]) => v === true).map(([k]) => k),
        entitlement: await resolveEntitlement(principal.id),
      })
    }

    app.get(
      '/auth/me',
      {
        config: { auth: { audience: 'member' }, budget: 'member-read' },
        onRequest: app.authenticate,
        schema: { response: { 200: meResponseSchema } },
      },
      meHandler,
    )

    /**
     * GET /auth/session — the capability snapshot the console boots from.
     *
     * Declared `anyStaff` rather than gated on a module, because a staff member
     * must be able to read their own grants without already holding one.
     * `/auth/staff/me` is the staff *profile* route and keeps its
     * `settings.read` posture verbatim; this is a second route, not a
     * relaxation of that one. See specs/003-web-console/research.md R3.
     *
     * Everything here is resolved at request time from server-held state. None
     * of it is a token claim, so a grant revoked a second ago is already gone
     * from this response (Constitution Principle II).
     */
    app.get(
      '/auth/session',
      {
        config: { auth: { audience: 'staff', anyStaff: true }, budget: 'member-read' },
        onRequest: app.guard,
        schema: { response: { 200: sessionResponseSchema } },
      },
      async (request, reply) => {
        reply.header('cache-control', NO_STORE)
        const principal = request.principal
        const snapshot =
          request.permissions ??
          (await app.permissions.resolve(principal.id, { signal: request.deadlineSignal }))

        return reply.send({
          kind: 'staff',
          id: principal.id,
          displayName: snapshot.displayName ?? null,
          isSuperadmin: snapshot.isSuperadmin,
          modules: grantedModules(snapshot),
          available: app.availableModules(),
        })
      },
    )

    app.get(
      '/auth/staff/me',
      {
        config: { auth: { audience: 'staff', module: 'settings', flag: 'read' }, budget: 'member-read' },
        onRequest: app.guard,
        schema: { response: { 200: meResponseSchema } },
      },
      meHandler,
    )

    // ---- Password reset -----------------------------------------------------

    app.post(
      '/auth/password-reset/request',
      {
        ...publicAuth('password-reset'),
        schema: { body: passwordResetRequestSchema, response: { 202: passwordResetAcceptedSchema } },
      },
      async (request, reply) => {
        const account = await findAccount(request.body.email, request.deadlineSignal)
        if (account) {
          const token = generateOpaqueToken()
          await query(
            app.pg,
            `INSERT INTO password_reset_tokens (account_id, account_kind, token_hash, expires_at)
             VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
            [account.row.id, account.kind, token.hash, PASSWORD_RESET_TTL_SECONDS],
            { signal: request.deadlineSignal },
          )
          await app.sendResetMail?.({ email: account.row.email, token: token.plaintext })
        }
        // 202 whether or not the account exists — the same non-enumeration rule
        // as sign-in. A 404 here would be a membership oracle.
        return reply.code(202).send({ requested: true })
      },
    )

    app.post(
      '/auth/password-reset/confirm',
      {
        ...publicAuth('password-reset'),
        schema: { body: passwordResetConfirmSchema, response: { 200: z.object({ reset: z.literal(true) }) } },
      },
      async (request, reply) => {
        const presentedHash = hashRefreshToken(request.body.token)
        const newHash = await hashPassword(request.body.password)

        const result = await withTransaction(app.pg, async (client) => {
          const { rows } = await client.query(
            `SELECT id, account_id, account_kind, expires_at, consumed_at
               FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE`,
            [presentedHash],
          )
          if (rows.length === 0) return null
          const token = rows[0]
          if (token.consumed_at !== null || new Date(token.expires_at) <= new Date()) return null

          await client.query('UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1', [token.id])

          if (token.account_kind === 'member') {
            // §3.2: a completed reset also reactivates an inactive member.
            await client.query(
              `UPDATE members
                  SET password_hash = $2, password_reset_required = false,
                      status = CASE WHEN status = 'inactive' THEN 'active'::member_status ELSE status END
                WHERE id = $1`,
              [token.account_id, newHash],
            )
          } else {
            await client.query('UPDATE admin_users SET password_hash = $2 WHERE id = $1', [token.account_id, newHash])
          }
          return token
        })

        // INVALID_RESET_TOKEN, not INVALID_REFRESH_TOKEN: the remedy for a stale
        // reset link is a new link, not a sign-in. The two used to share a type
        // and a console branching on it sent the user to the one place that
        // cannot help someone who has forgotten their password.
        if (!result) throw forbidden(PROBLEMS.INVALID_RESET_TOKEN, 'That reset link is not valid or has expired.')

        // Revoking every session is the POINT of a reset: the likely reason for
        // one is that the old credential is compromised.
        const revoked = await revokeAllSessions(app.pg, result.account_id, result.account_kind, 'password_reset')
        for (const sid of revoked) await app.denylist.add(sid)

        await app.audit({
          action: 'session_revoked', outcome: 'allowed', requestId: request.id,
          actorId: result.account_id, actorKind: result.account_kind,
          detail: { reason: 'password_reset', count: revoked.length },
        })

        clearAuthCookies(reply)
        return reply.send({ reset: true })
      },
    )
  },
  { name: 'auth-routes', dependencies: ['auth', 'rate-limit'] },
)

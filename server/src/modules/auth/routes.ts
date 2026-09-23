import fp from 'fastify-plugin'
import {
  signInRequestSchema, signInResponseSchema,
  verifyOtpRequestSchema, resendOtpRequestSchema, resendOtpResponseSchema,
  refreshRequestSchema, tokenPairResponseSchema,
  passwordResetRequestSchema, passwordResetConfirmSchema, passwordResetAcceptedSchema,
  meResponseSchema,
  csrfTokenResponseSchema,
} from '@gwc/contracts/auth'
import { sessionResponseSchema } from '@gwc/contracts/capabilities'
import { z } from 'zod'

import { createAuthController } from './controller.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GwcApp } from '../../app.ts'

/**
 * The authentication endpoints (auth-api.md): schema, access posture, and
 * wiring to `controller.js` only. See `application/` for the actual rules
 * (sign-in, OTP, refresh, password reset) and `controller.js` for how a
 * request maps to one of those calls.
 */

/** Every auth response carries no-store: a cached credential response is a leak. */
const NO_STORE = 'private, no-store'

export default fp(
  async function authRoutes(app: GwcApp) {
    const controller = createAuthController(app)

    // Both sign-in buckets are checked independently (SC-013). Per-address
    // alone is defeated by a botnet spraying one account; per-account alone
    // lets one address enumerate the member base and is itself an
    // account-lockout weapon.
    // `rateLimitIndependent`, not `rateLimit`: the route already spends the
    // per-address bucket at onRequest, and a plain second limiter would see the
    // library's once-per-request marker and never count. See 07-rate-limit.js.
    const limitSignInAccount = app.rateLimitIndependent({
      ...app.bucket('sign-in-account'),
      keyGenerator: (request: FastifyRequest) => `sign-in-account:${String(request.body?.email ?? '').toLowerCase()}`,
    })
    const limitOtpSend = app.rateLimit({
      ...app.bucket('otp-send'),
      keyGenerator: (request: FastifyRequest) => `otp-send:${request.otpPhoneKey ?? request.ip}`,
    })

    const publicAuth = (bucket) => ({
      config: { auth: { audience: 'public' }, budget: 'auth', rateLimit: app.bucket(bucket) },
    })

    app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
      if (request.url.startsWith('/auth/')) reply.header('cache-control', NO_STORE)
      return payload
    })

    // ---- GET /auth/csrf -----------------------------------------------------

    /**
     * Mints the CSRF secret cookie and returns the matching token.
     *
     * Public, because it has to be: the console needs a token after a page
     * reload, before it knows whether it is signed in. That is safe. The
     * token is worthless without the secret cookie set by this same
     * response, and an attacker's page cannot read either — the point of a
     * double submit is that the attacker can send the cookie but cannot read
     * it to echo it back.
     */
    app.get(
      '/auth/csrf',
      {
        config: { auth: { audience: 'public' }, budget: 'auth' },
        schema: { response: { 200: csrfTokenResponseSchema } },
      },
      controller.csrf,
    )

    // ---- POST /auth/sign-in -------------------------------------------------

    app.post(
      '/auth/sign-in',
      {
        ...publicAuth('sign-in-ip'),
        preHandler: limitSignInAccount,
        schema: { body: signInRequestSchema, response: { 200: signInResponseSchema } },
      },
      controller.signIn,
    )

    // ---- POST /auth/verify-otp ---------------------------------------------

    app.post(
      '/auth/verify-otp',
      {
        ...publicAuth('otp-verify'),
        schema: { body: verifyOtpRequestSchema, response: { 200: tokenPairResponseSchema } },
      },
      controller.verifyOtp,
    )

    // ---- POST /auth/otp/resend ---------------------------------------------

    app.post(
      '/auth/otp/resend',
      {
        ...publicAuth('otp-verify'),
        // Keyed on the phone number, not the address: each send costs real
        // money and an address-keyed limit is trivially bypassed.
        preHandler: [controller.loadOtpResendPreHandler, limitOtpSend],
        schema: { body: resendOtpRequestSchema, response: { 202: resendOtpResponseSchema } },
      },
      controller.resendOtp,
    )

    // ---- POST /auth/refresh -------------------------------------------------

    app.post(
      '/auth/refresh',
      {
        ...publicAuth('refresh'),
        schema: { body: refreshRequestSchema, response: { 200: tokenPairResponseSchema } },
      },
      controller.refresh,
    )

    // ---- POST /auth/sign-out ------------------------------------------------

    app.post(
      '/auth/sign-out',
      {
        config: { auth: { audience: 'member' }, budget: 'auth' },
        onRequest: app.authenticate,
        schema: { response: { 204: z.null() } },
      },
      controller.signOut,
    )

    /**
     * Staff sign out through the same mechanism, declared separately because a
     * route's audience is part of its posture and cannot be two things at
     * once.
     *
     * `anyStaff`, not `settings.read`. Ending your own session is not a
     * privilege on the settings module, and gating it there meant a staff
     * member holding `seo.read` and nothing else could sign in, do their
     * work, and then be refused when they tried to leave — with no way out
     * but waiting for the token to expire. A grant somebody else controls
     * must never be what keeps you signed in.
     */
    app.post(
      '/auth/staff/sign-out',
      {
        config: { auth: { audience: 'staff', anyStaff: true }, budget: 'auth' },
        onRequest: app.guard,
        schema: { response: { 204: z.null() } },
      },
      controller.staffSignOut,
    )

    // ---- GET /auth/me -------------------------------------------------------

    app.get(
      '/auth/me',
      {
        config: { auth: { audience: 'member' }, budget: 'member-read' },
        onRequest: app.authenticate,
        schema: { response: { 200: meResponseSchema } },
      },
      controller.me,
    )

    /**
     * GET /auth/session — declared `anyStaff` rather than gated on a module,
     * because a staff member must be able to read their own grants without
     * already holding one. `/auth/staff/me` is the staff *profile* route and
     * keeps its `settings.read` posture verbatim; this is a second route, not
     * a relaxation of that one. See specs/003-web-console/research.md R3.
     */
    app.get(
      '/auth/session',
      {
        config: { auth: { audience: 'staff', anyStaff: true }, budget: 'member-read' },
        onRequest: app.guard,
        schema: { response: { 200: sessionResponseSchema } },
      },
      controller.session,
    )

    app.get(
      '/auth/staff/me',
      {
        config: { auth: { audience: 'staff', module: 'settings', flag: 'read' }, budget: 'member-read' },
        onRequest: app.guard,
        schema: { response: { 200: meResponseSchema } },
      },
      controller.me,
    )

    /**
     * The organisation principals' session and sign-out — one pair per kind.
     *
     * capability-api.md has `/auth/session` serve staff, merchant and partner
     * alike, but a route's audience is part of its posture and cannot be three
     * things at once: `/auth/session` verifies against the staff audience, so
     * a merchant token was refused there with "not valid for this interface"
     * and the console, having no snapshot, could render nothing. The handler
     * and the response shape are the contract's; only the path differs.
     *
     * Sign-out is declared alongside for the same reason. `/auth/sign-out` is
     * member-only and `/auth/staff/sign-out` staff-only, so without these an
     * organisation principal could sign in and never sign out — with no way
     * out but waiting for the token to expire.
     */
    for (const kind of ['merchant', 'partner'] as const) {
      app.get(
        `/auth/${kind}/session`,
        {
          config: { auth: { audience: kind }, budget: 'member-read' },
          onRequest: app.authenticate,
          schema: { response: { 200: sessionResponseSchema } },
        },
        controller.session,
      )

      app.post(
        `/auth/${kind}/sign-out`,
        {
          config: { auth: { audience: kind }, budget: 'auth' },
          onRequest: app.authenticate,
          schema: { response: { 204: z.null() } },
        },
        controller.signOut,
      )
    }

    // ---- Password reset -----------------------------------------------------

    app.post(
      '/auth/password-reset/request',
      {
        ...publicAuth('password-reset'),
        schema: { body: passwordResetRequestSchema, response: { 202: passwordResetAcceptedSchema } },
      },
      controller.requestPasswordReset,
    )

    app.post(
      '/auth/password-reset/confirm',
      {
        ...publicAuth('password-reset'),
        schema: { body: passwordResetConfirmSchema, response: { 200: z.object({ reset: z.literal(true) }) } },
      },
      controller.confirmPasswordReset,
    )
  },
  { name: 'auth-routes', dependencies: ['auth', 'rate-limit'] },
)

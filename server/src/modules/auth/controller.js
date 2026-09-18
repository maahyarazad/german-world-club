import { COOKIES, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TTL_DAYS } from '@gwc/contracts/auth'
import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden } from '../../authz/require-permission.js'
import { signIn } from './application/sign-in.js'
import { verifyOtp } from './application/verify-otp.js'
import { loadOtpResendContext, resendOtp } from './application/resend-otp.js'
import { refresh } from './application/refresh.js'
import { signOut } from './application/sign-out.js'
import { requestPasswordReset } from './application/request-password-reset.js'
import { confirmPasswordReset } from './application/confirm-password-reset.js'
import { loadMe } from './application/me.js'
import { loadSession } from './application/session.js'

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
    // token is the credential that outlives the browser session, so it
    // travels as narrowly as possible.
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
 * Every handler here does the same three things and nothing else: pull plain
 * data out of `request`, call an `application/*` function with `app` plus
 * that data, and shape the result into cookies/headers/status on `reply`.
 * None of the actual auth rules live in this file — see `application/`.
 */
export function createAuthController(app) {
  const secureCookies = app.env.isProduction

  return {
    csrf: async (request, reply) => {
      reply.header('cache-control', NO_STORE)
      return reply.send({ csrfToken: reply.generateCsrf() })
    },

    signIn: async (request, reply) => {
      const { email, password, deviceId } = request.body
      const face = faceFor(request.body)
      const result = await signIn(app, {
        email, password, deviceId, face,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        requestId: request.id,
        signal: request.deadlineSignal,
      })

      if (result.outcome === 'authenticated') {
        if (result.face === 'web') {
          setAuthCookies(reply, { accessToken: result.token, refreshToken: result.refreshToken, secure: secureCookies })
          return reply.send({ outcome: 'authenticated', expiresIn: result.expiresIn, principal: result.principal })
        }
        return reply.send({
          outcome: 'authenticated',
          accessToken: result.token,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
          principal: result.principal,
        })
      }

      return reply.send(result)
    },

    verifyOtp: async (request, reply) => {
      const { challengeId, code, deviceId } = request.body
      const result = await verifyOtp(app, {
        challengeId, code, deviceId,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        requestId: request.id,
        signal: request.deadlineSignal,
      })
      return reply.send(result)
    },

    /** `preHandler` for POST /auth/otp/resend — loads the rate-limit key before the limiter runs. */
    loadOtpResendPreHandler: async (request) => {
      const { challenge, phoneKey } = await loadOtpResendContext(app, request.body?.challengeId, request.deadlineSignal)
      request.otpChallenge = challenge
      request.otpPhoneKey = phoneKey
    },

    resendOtp: async (request, reply) => {
      const result = await resendOtp(app, {
        challenge: request.otpChallenge,
        phoneKey: request.otpPhoneKey,
        signal: request.deadlineSignal,
      })
      if (result.outcome === 'too_soon') {
        reply.header('retry-after', String(result.retryAfter))
        throw forbidden(PROBLEMS.RATE_LIMITED, `Wait ${result.retryAfter}s before requesting another code.`)
      }
      return reply.code(202).send({ resent: result.resent, cooldownSeconds: result.cooldownSeconds })
    },

    refresh: async (request, reply) => {
      const presented = request.body?.refreshToken ?? request.cookies?.[COOKIES.refresh]
      const face = request.body?.refreshToken ? 'mobile' : 'web'
      const result = await refresh(app, { presented, face, requestId: request.id })

      if (result.outcome === 'missing') throw result.problem
      if (result.outcome === 'replayed' || result.outcome === 'invalid') {
        clearAuthCookies(reply)
        throw result.problem
      }

      if (result.face === 'web') {
        setAuthCookies(reply, { accessToken: result.token, refreshToken: result.refreshToken, secure: secureCookies })
        return reply.send({ expiresIn: result.expiresIn })
      }
      return reply.send({ accessToken: result.token, refreshToken: result.refreshToken, expiresIn: result.expiresIn })
    },

    signOut: async (request, reply) => {
      await signOut(app, { principal: request.principal, requestId: request.id })
      clearAuthCookies(reply)
      return reply.code(204).send()
    },

    /**
     * Staff sign out through the same mechanism, declared separately because a
     * route's audience is part of its posture and cannot be two things at
     * once. Ending your own session is not a privilege on the settings
     * module, so this route authenticates as any staff principal and audits
     * nothing beyond what `signOut` itself would — matching the original
     * behaviour of never writing a `session_revoked` audit entry here.
     */
    staffSignOut: async (request, reply) => {
      await signOut(app, { principal: request.principal, requestId: request.id, audit: false })
      clearAuthCookies(reply)
      return reply.code(204).send()
    },

    me: async (request, reply) => {
      reply.header('cache-control', NO_STORE)
      const result = await loadMe(app, { principal: request.principal, signal: request.deadlineSignal })
      return reply.send(result)
    },

    session: async (request, reply) => {
      reply.header('cache-control', NO_STORE)
      const result = await loadSession(app, {
        principal: request.principal,
        permissions: request.permissions,
        signal: request.deadlineSignal,
      })
      return reply.send(result)
    },

    requestPasswordReset: async (request, reply) => {
      const result = await requestPasswordReset(app, { email: request.body.email, signal: request.deadlineSignal })
      return reply.code(202).send(result)
    },

    confirmPasswordReset: async (request, reply) => {
      // No try/catch here: an invalid/expired token throws before any
      // session is touched, and the original behaviour never clears cookies
      // on that path — only a successful reset does, because it is the one
      // that revokes every session.
      const result = await confirmPasswordReset(app, {
        token: request.body.token,
        password: request.body.password,
        requestId: request.id,
      })
      clearAuthCookies(reply)
      return reply.send(result)
    },
  }
}

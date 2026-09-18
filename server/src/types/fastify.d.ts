/**
 * What this platform decorates onto Fastify.
 *
 * Fastify's own types know nothing about `app.decorate(...)`, so without this
 * every `app.env`, `request.principal` and `app.guard(...)` is a "property does
 * not exist" error, and every test's `let app` is an implicit any. Declaring
 * them here is what makes the rest of the server type-check at all.
 *
 * The shapes are deliberately useful rather than exhaustive: these are internal
 * seams, and over-specifying them here would duplicate the definitions that
 * already live next to the implementations. Where a decoration's real type is
 * worth stating precisely it is imported from its own module.
 */
import type { Pool, PoolClient } from 'pg'
import type { Audience, Flag, Module } from '@gwc/contracts/permissions'

type Json = Record<string, unknown>

/** A rate-limit bucket's declared options, as `app.bucket(name)` returns them. */
type Bucket = { max: number; timeWindow: number | string; [key: string]: unknown }

declare module 'fastify' {
  interface FastifyInstance {
    // --- configuration and stores -------------------------------------------
    env: Readonly<Record<string, unknown>> & {
      NODE_ENV: 'development' | 'test' | 'production'
      PORT: number
      isProduction: boolean
      isTest: boolean
      canonicalOrigin: string
      trustProxy: false | number
    }
    pg: Pool
    redis?: unknown
    withRedis<T>(fn: (redis: unknown) => Promise<T>): Promise<T | null>

    // --- authentication and authorization -----------------------------------
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>
    /** Takes the request (it reads the bearer via jwtVerify), not a raw token. */
    verifyAccessToken(request: FastifyRequest, expectedAudience: string): Promise<Json>
    mintAccessToken(input: {
      accountId: string
      sessionId: string
      audience: string
      now?: number
    }): { token: string; [key: string]: unknown }
    /** Resolves a staff member's module matrix from server-held state, per request. */
    permissions: {
      resolve(adminId: string, opts?: { signal?: AbortSignal }): Promise<unknown>
      invalidate?(adminId: string): void
    }
    requirePermission(module: Module, flag: Flag): preHandlerHookHandler
    guard(...args: unknown[]): preHandlerHookHandler
    availableModules(...args: unknown[]): readonly Module[]
    routePostures: Map<string, { audience: Audience; module?: Module; flag?: Flag }>
    /** Revoked session ids, so a superseded session stops working immediately. */
    denylist: {
      add(sessionId: string, ttlSeconds?: number): Promise<void>
      has(sessionId: string): Promise<boolean>
      prune?(): Promise<void>
    }
    /** From @fastify/csrf-protection. */
    csrfProtection(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void

    // --- rate limiting ------------------------------------------------------
    bucket(name: string): Bucket
    rateLimitIndependent(options: Json): preHandlerHookHandler

    // --- resilience ---------------------------------------------------------
    breakers: Record<string, unknown>
    circuitStates(): Record<string, string>
    underPressure: unknown
    beginDraining(): void
    isDraining(): boolean
    dbHealthy(): Promise<boolean>
    redisHealthy(): Promise<boolean>
    metrics: unknown

    // --- domain seams -------------------------------------------------------
    audit(...args: unknown[]): Promise<void>
    auditDenial(...args: unknown[]): Promise<void>
    auditLog(...args: unknown[]): Promise<void>
    contentSource: unknown
    mediaStorage: unknown
    integrations: Record<string, unknown>
    sendOtp(...args: unknown[]): Promise<unknown>

    // --- SEO caches ---------------------------------------------------------
    invalidateSitemap(): void
    invalidateLegacyRedirects(): void
    resolveLegacyRedirect(url: string, signal?: AbortSignal): Promise<string | null>

    // --- jobs ---------------------------------------------------------------
    jobQueue: unknown
    jobDefinitions: Map<string, unknown>
    runJob(name: string, ...args: unknown[]): Promise<unknown>
    recentJobRuns(...args: unknown[]): Promise<unknown[]>
  }

  /**
   * What a route declares about itself.
   *
   * `auth` is the access posture the onReady gate in 11-rbac refuses to boot
   * without — the most consequential entry here. `produces` is the escape
   * hatch for routes answering with something other than JSON; together with
   * schema.response it satisfies the response-schema gate.
   */
  interface FastifyContextConfig {
    auth?: {
      audience: Audience | string
      module?: Module
      flag?: Flag
      requires?: string
    }
    /** Names the route class whose deadline and outbound budgets apply. */
    budget?: string
    rateLimit?: Record<string, unknown> | false
    produces?: string
    /** Set by @fastify/static for the per-file routes it registers. */
    file?: string
  }

  interface FastifyRequest {
    /** The authenticated principal, or null on a public route. */
    principal: (Json & { kind?: string; id?: string }) | null
    permissions: Record<string, unknown> | null
    /** Milliseconds left in this request's budget. */
    deadlineMs: number
    deadlineSignal: AbortSignal
    /** True once the client has hung up; handlers stop doing work. */
    clientGone: boolean
    routeClass: string
    /**
     * The per-account key the OTP send limiter buckets on.
     * Set by the auth routes before the limiter runs; absent elsewhere.
     */
    otpPhoneKey?: string
  }
}

export type { Pool, PoolClient, Json, Bucket }

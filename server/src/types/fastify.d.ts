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

/** One outbound email. `subjectKey` makes the idempotency key (integrations/mail.ts). */
type MailMessage = {
  to: string
  template: string
  subjectKey: string
  variables?: Record<string, unknown>
}

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
      DATABASE_URL: string
      /** Where pgai's `docs_embeddings` lives, when that is not DATABASE_URL. */
      RAG_DATABASE_URL?: string
      ANTHROPIC_API_KEY?: string
      OLLAMA_HOST: string
      RAG_MODEL: string
      RAG_EMBED_MODEL: string
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
      /** Drop every cached snapshot — for suites that change grants directly in SQL. */
      invalidateAll?(): void
    }
    requirePermission(module: Module, flag: Flag): preHandlerHookHandler
    /**
     * The standard preHandler chain: authenticate, then authorize.
     * An array, because Fastify runs a list of hooks in order.
     */
    guard: preHandlerHookHandler[]
    availableModules(...args: unknown[]): readonly Module[]
    /**
     * The real route table, as `11-rbac.ts` built it — a function returning
     * one entry per fully-declared route. Previously declared as a Map, which
     * no caller ever used it as; the posture and matrix suites call it.
     */
    routePostures: () => readonly {
      method: string | string[]
      url: string
      auth: { audience: Audience; module?: Module; flag?: Flag; requires?: string }
      staticFile: boolean
    }[]
    /** Revoked session ids, so a superseded session stops working immediately. */
    denylist: {
      add(sessionId: string): Promise<void>
      has(sessionId: string): Promise<boolean>
      /** Only the in-process fallback has this; Redis expires its own keys. */
      prune?(): Promise<number>
    }
    /** From @fastify/csrf-protection. */
    csrfProtection(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void

    // --- rate limiting ------------------------------------------------------
    bucket(name: string): Bucket
    rateLimitIndependent(options: Json): preHandlerHookHandler

    // --- resilience ---------------------------------------------------------
    /**
     * One breaker per outbound dependency, keyed by name.
     * `run` is generic over the thunk's result; a fallback must match it.
     */
    breakers: Record<string, {
      state: string
      run<T>(
        fn: (signal?: AbortSignal) => Promise<T>,
        opts?: { fallback?: T | ((err: unknown) => T); signal?: AbortSignal },
      ): Promise<T>
    }>
    circuitStates(): Record<string, string>
    underPressure: unknown
    beginDraining(): void
    isDraining(): boolean
    dbHealthy(): Promise<boolean>
    redisHealthy(): Promise<boolean>
    metrics: unknown
    /** Feature 012: records an INTERNAL fault; never awaited by the error handler. */
    recordServerFault: import('../decorators/server-faults.ts').ServerFaultRecorder

    // --- domain seams -------------------------------------------------------
    /**
     * The notification step for a persisted message (008 US5).
     *
     * Optional, and called only AFTER the message is committed. Declared as a
     * decorator rather than an import so a suite can replace it with a thrower
     * and prove the message survives — which is what
     * tests/messaging/persist-before-notify.test.ts does.
     */
    notifyMessage?: (event: {
      conversationId: string
      messageId: string
      recipientIds: string[]
    }) => Promise<void>
    audit(...args: unknown[]): Promise<void>
    auditDenial(...args: unknown[]): Promise<void>
    auditLog(...args: unknown[]): Promise<void>
    /** Resolves published records for the public surface. Injectable in tests. */
    contentSource: {
      find(recordType: string, slug: string, opts?: { signal?: AbortSignal }): Promise<unknown>
      alternates(record: unknown, opts?: { signal?: AbortSignal }): Promise<unknown[]>
      [key: string]: unknown
    }
    mediaStorage: unknown
    integrations: Record<string, unknown>
    sendOtp(...args: unknown[]): Promise<unknown>
    /**
     * Queue a message for the `mail.deliver` job (decorators/mail.ts). Never
     * sends inline: mail is in no route's budget. Pass the caller's transaction
     * client when the mail must exist only if the work it describes commits.
     */
    enqueueMail(message: MailMessage, opts?: { client?: PoolClient; signal?: AbortSignal }): Promise<void>
    /** The password-reset notification; queued like every other mail. */
    sendResetMail(input: { email: string; token: string }): Promise<void>

    // --- SEO caches ---------------------------------------------------------
    invalidateSitemap(): void
    invalidateLegacyRedirects(): void
    resolveLegacyRedirect(url: string, signal?: AbortSignal): Promise<string | null>

    // --- push (feature 011) --------------------------------------------------
    /**
     * What the push jobs send through (decorators/push.ts). Replaceable in a
     * suite; read at call time by the job handlers.
     */
    pushTransport: import('../modules/push/providers.ts').PushTransport

    // --- jobs ---------------------------------------------------------------
    jobQueue: unknown
    /**
     * The work queue (pg-boss, or the inline double), the same instance as
     * `jobQueue`. The push outbox kicks `push.dispatch` through it.
     */
    boss: {
      send(queue: string, data: object, options?: Record<string, unknown>): Promise<unknown>
      work(queue: string, options: Record<string, unknown>, handler: (jobs: unknown) => Promise<void>): Promise<unknown>
    }
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
      /** Staff routes only: any active staff member, no module (11-rbac). */
      anyStaff?: true
      /** Member routes only: an applicant not yet approved may reach it (feature 009). */
      onboarding?: true
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

declare module '@fastify/request-context' {
  interface RequestContextData {
    /** The server-generated ULID (00-request-context.ts). */
    requestId?: string
    /** The client's own correlation id, when well-formed (feature 012, R10). */
    clientRequestId?: string | null
    principal?: unknown
  }
}

export type { Pool, PoolClient, Json, Bucket }

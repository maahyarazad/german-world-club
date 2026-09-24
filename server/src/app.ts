import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import etag from '@fastify/etag'
import compress from '@fastify/compress'
import fastifyStatic from '@fastify/static'
import cookie from '@fastify/cookie'
import csrf from '@fastify/csrf-protection'
import cors from '@fastify/cors'
import { ulid } from 'ulid'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod'

import { loadEnv } from './config/env.ts'
import { GwcLogController, loggerOptions } from './plugins/01-logging.ts'
import { makeGenReqId } from './plugins/00-request-context.ts'

import requestContext from './plugins/00-request-context.ts'
import securityHeaders from './plugins/02-security-headers.ts'
import canonicalOrigin from './plugins/03-canonical-origin.ts'
import legacyRedirects from './plugins/04-legacy-redirects.ts'
import db from './plugins/05-db.ts'
import redis from './plugins/06-redis.ts'
import rateLimit from './plugins/07-rate-limit.ts'
import pressure from './plugins/08-under-pressure.ts'
import jwtPlugin from './plugins/09-jwt.ts'
import authPlugin from './plugins/10-auth.ts'
import rbac from './plugins/11-rbac.ts'
import deadline from './plugins/12-deadline.ts'
import breakers from './plugins/13-breakers.ts'
import errorHandler from './plugins/14-error-handler.ts'
import openapi from './plugins/15-openapi.ts'
import health from './ops/health.ts'
import metrics from './ops/metrics.ts'
import jobs from './ops/jobs.ts'
import seoPublicRoutes from './modules/seo/public-routes.ts'
import seoStaffRoutes from './modules/seo/staff-routes.ts'
import organisationRoutes from './modules/organisations/routes.ts'
import authRoutes from './modules/auth/routes.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import mediaRoutes from './modules/media/routes.ts'
import mediaWorker from './modules/media/worker.ts'
import pushRoutes from './modules/push/routes.ts'
import marketplaceRoutes from './modules/marketplace/routes.ts'
import marketplaceStaffRoutes from './modules/marketplace/staff-routes.ts'
import messagingRoutes from './modules/messaging/routes.ts'
import publicRoutes from './modules/public/routes.ts'
import ragRoutes from './modules/rag/routes.ts'
import { COOKIES } from '@gwc/contracts/auth'
import { registerCsrfHook } from './hooks/csrf-on-request.ts'
import { registerShutdownHook } from './hooks/shutdown.ts'
import { registerBudgetGate } from './hooks/budget-on-ready.ts'
import { registerContentSource } from './decorators/content-source.ts'
import { registerAudit } from './decorators/audit.ts'
import { registerMediaDecorators } from './decorators/media.ts'
import { registerIntegrations } from './decorators/integrations.ts'
import { registerSendOtp } from './decorators/send-otp.ts'
import { registerMail } from './decorators/mail.ts'
import onboardingRoutes from './modules/onboarding/routes.ts'
import onboardingStaffRoutes from './modules/onboarding/staff-routes.ts'
import profileRoutes from './modules/profile/routes.ts'
import profileStaffRoutes from './modules/profile/staff-routes.ts'
import eventRoutes from './modules/events/routes.ts'
import threadRoutes from './modules/threads/routes.ts'
import threadStaffRoutes from './modules/threads/staff-routes.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.resolve(HERE, '..', '..', 'client')

/** Serve the built client when one exists; its public assets otherwise. */
function staticRoot() {
  const dist = path.join(CLIENT_DIR, 'dist')
  return existsSync(dist) ? dist : path.join(CLIENT_DIR, 'public')
}

/** Where the console's route prefix starts. Declared once; used three times. */
const CONSOLE_PREFIX = '/konsole'

/**
 * The console's application shell, read once at boot.
 *
 * A second Vite entry (client/konsole.html) rather than index.html: the public
 * page is English and indexed, the console is German and never indexed, and
 * one document cannot be both.
 *
 * Read eagerly so a missing build is a startup-time fact rather than a
 * per-request stat. When there is no build — a fresh checkout, or the API
 * running while the client is served by Vite's own dev server — the fallback
 * below is not registered at all, which is the honest outcome: no route is
 * better than a route that answers 200 with nothing in it.
 */
function consoleShell() {
  const built = path.join(CLIENT_DIR, 'dist', 'konsole.html')
  return existsSync(built) ? readFileSync(built, 'utf8') : null
}

/**
 * Paths this server generates itself, excluded from the static file sweep.
 *
 * `wildcard: false` registers one route per file found on disk, so a stale or
 * future client build that still ships a robots.txt or sitemap.xml would
 * collide with the generated route and crash startup with "Method 'GET'
 * already declared". Excluding them at registration time — rather than
 * deleting the files — keeps the "one source" rule in modules/seo/public-routes.js true no
 * matter what lands in the build output.
 */
const SERVER_GENERATED_PATHS = ['robots.txt', 'sitemap.xml']

/**
 * Builds the Fastify instance. Deliberately does NOT call listen() — that is
 * server.js's job. This split is what makes the whole test strategy work:
 * every suite drives a built instance through `fastify.inject()`, in-process,
 * with no port and no top-level await running.
 *
 * Plugin order is semantically load-bearing, which is why the files are
 * numbered: correlation before logging, security headers before routes,
 * rate limits before authentication (so an unauthenticated flood is cheap to
 * refuse), authentication before authorization, deadlines before handlers.
 *
 * `contentSource` is the seam the public-delivery suites inject through, so
 * rendering and OG-tag assertions are about the resolver and the templates
 * rather than about SQL.
 */
/**
 * A built application instance.
 *
 * Derived from buildApp rather than written out, so it follows the decorations
 * in src/types/fastify.d.ts automatically. Tests annotate their `let app` with
 * this; without it every suite's app is an implicit any and none of the
 * decorations above are checked at the call site.
 */
export type GwcApp = Awaited<ReturnType<typeof buildApp>>

/**
 * What a caller may inject when building the app.
 *
 * `contentSource`, `storage`, `jobQueue` and `integrations` are the seams the
 * suites drive through; everything else is passed straight to Fastify, which
 * is why the rest is open.
 */
export type BuildAppOptions = {
  env?: ReturnType<typeof loadEnv>
  contentSource?: unknown
  storage?: unknown
  jobQueue?: unknown
  integrations?: Record<string, unknown>
  [key: string]: unknown
}

export async function buildApp({
  env = loadEnv(), contentSource, storage, jobQueue, integrations, ...overrides
}: BuildAppOptions = {}) {
  const app = Fastify({
    // requestTimeout defaults to 0 — DISABLED — on Fastify 5.12, so a stalled
    // request would be held open indefinitely. Layers 1 and 2 of
    // contracts/resilience.md §1.
    requestTimeout: env.REQUEST_TIMEOUT_MS,
    connectionTimeout: env.CONNECTION_TIMEOUT_MS,
    // Must exceed the proxy's idle timeout, or the proxy reuses a socket this
    // server is closing and sporadic 502s appear.
    keepAliveTimeout: env.KEEP_ALIVE_TIMEOUT_MS,
    // Lets graceful shutdown actually complete rather than waiting out
    // keepAliveTimeout on idle sockets.
    forceCloseConnections: 'idle',
    bodyLimit: 1_048_576,
    // Makes the `ip` rate-limit dimension mean the real client. Never `true`:
    // that would let a client forge X-Forwarded-For and bypass every limit.
    trustProxy: env.trustProxy,
    genReqId: makeGenReqId(ulid),
    logger: loggerOptions(env),
    // Fastify 5.12 deprecates the top-level disableRequestLogging /
    // requestIdLogLabel options. Note the runtime wants an *instance* here,
    // though the TypeScript signature names a class.
    logController: new GwcLogController(),
    ...overrides,
  })

  app.decorate('env', env)

  // One schema per route gives request validation, response serialization and
  // the OpenAPI document from the same source (http-conventions.md §7).
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(sensible)
  await app.register(metrics)
  await app.register(requestContext)
  await app.register(errorHandler)
  await app.register(securityHeaders)
  await app.register(etag)
  await app.register(compress, { global: true, encodings: ['br', 'gzip', 'deflate'] })
  await app.register(db, { env })
  await app.register(redis, { env })
  await app.register(rateLimit, { env })
  await app.register(pressure)
  await app.register(rbac)
  await app.register(deadline)
  await app.register(breakers)

  /**
   * Cookies, CSRF and CORS — the browser half of the credential model (§6.2).
   *
   * A browser sends its cookies on any request a page can cause, so a
   * cookie-bearing state-changing request needs a double-submit token. A bearer
   * client is exempt: it has no ambient credential to forge, and requiring a
   * token there would add a round trip for no security.
   */
  await app.register(cookie, { hook: 'onRequest' })
  await app.register(csrf, {
    sessionPlugin: '@fastify/cookie',
    cookieOpts: { signed: false, httpOnly: false, sameSite: 'lax', path: '/', secure: env.isProduction },
    cookieKey: COOKIES.csrf,
  })
  await app.register(cors, {
    // Never `*` on a credentialed route: the browser would refuse it, and
    // relaxing `credentials` to make it work would expose every member session
    // to any origin.
    origin: env.CORS_ORIGINS ?? [env.canonicalOrigin],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  })

  /**
   * Checked at onRequest, before authentication: a forged request should be
   * refused before the server spends a session lookup on it, and the answer to
   * a cross-site POST must not depend on whether the stolen cookie is still
   * valid. The token travels in `x-csrf-token`, which is what makes the check
   * possible this early — the body has not been parsed yet.
   */
  registerCsrfHook(app)

  await app.register(jwtPlugin, { env })
  await app.register(authPlugin)

  // Both run as onRequest hooks, before routing, so a duplicate or retired URL
  // never reaches a handler and never becomes a second indexable copy.
  await app.register(canonicalOrigin)
  await app.register(legacyRedirects)

  registerContentSource(app, { contentSource })
  registerAudit(app)
  registerMediaDecorators(app, { storage, jobQueue, env })
  registerIntegrations(app, { integrations, env })
  registerShutdownHook(app)
  registerSendOtp(app)
  registerMail(app)

  /**
   * `wildcard: false` is the load-bearing option: @fastify/static then serves
   * only files that actually exist — one route per file — instead of answering
   * every unmatched path. With the catch-all gone, `setNotFoundHandler`
   * produces a real 404 (FR-017).
   *
   * Those per-file routes are registered by the plugin, not by us, so their
   * posture is declared here for the whole scope: every file in the static root
   * is a deliberately public asset. That is the affirmative act Principle II
   * requires, written once and visible in a diff, rather than a hole in the
   * startup gate.
   */
  await app.register(async (scope) => {
    scope.addHook('onRoute', (route) => {
      route.config = { ...route.config, auth: { audience: 'public' }, budget: 'public-page' }
    })
    await scope.register(fastifyStatic, {
      root: staticRoot(),
      wildcard: false,
      globIgnore: SERVER_GENERATED_PATHS,
      index: false,
      cacheControl: true,
      maxAge: '1h',
    })
  })

  /**
   * The console's SPA fallback — deliberately narrow.
   *
   * `wildcard: false` above is load-bearing: it is what makes an unmatched path
   * a real 404 rather than a 200 carrying the wrong page (Principle III). A
   * client-routed console needs the opposite behaviour, so this restores it for
   * exactly one prefix and nowhere else. `/gibt-es-nicht` still 404s;
   * `/konsole/admin/seo/irgendwas` gets the shell and lets the router decide.
   *
   * Declared `audience: 'public'` because that is what it is: the shell carries
   * no member content, no capability data and no principal identity — every one
   * of those arrives later, over an authenticated request the server re-checks.
   * Publishing an empty shell is not a disclosure; publishing anything else
   * here would be (Principle VI).
   *
   * It is still a *gated surface*. modules/seo/surfaces.js declares `/konsole` gated
   * and never indexed, which is what puts it in robots.txt's Disallow list and
   * stamps X-Robots-Tag on these responses via 02-security-headers.js.
   */
  const shell = consoleShell()
  if (shell) {
    await app.register(async (scope) => {
      scope.addHook('onRoute', (route) => {
        route.config = {
          ...route.config,
          auth: { audience: 'public' },
          budget: 'public-page',
          // A document, not a JSON body — there is no response schema to
          // declare, so the produces gate is satisfied affirmatively instead.
          produces: 'text/html',
        }
      })

      const sendShell = async (request: FastifyRequest, reply: FastifyReply) =>
        reply
          .type('text/html; charset=utf-8')
          // `private, no-store`, the same rule every other gated surface
          // follows. The shell is identical for everyone and would be safe to
          // cache, but it is the entry point to a gated surface, and having one
          // response under /konsole that caches differently from the rest is
          // how an exception becomes a precedent. It is 2KB, once per session.
          .header('cache-control', 'private, no-store')
          .send(shell)

      scope.get(CONSOLE_PREFIX, sendShell)
      scope.get(`${CONSOLE_PREFIX}/*`, sendShell)
    })
  }

  /**
   * Before every route plugin: @fastify/swagger collects the route table
   * through an onRoute hook, and a Fastify onRoute hook only fires for routes
   * registered after it. Registered last, the document comes out empty.
   */
  await app.register(openapi)

  await app.register(health)
  await app.register(jobs)
  await app.register(seoPublicRoutes)
  await app.register(authRoutes)
  await app.register(mediaRoutes)
  await app.register(mediaWorker)
  await app.register(pushRoutes)
  await app.register(marketplaceRoutes)
  await app.register(marketplaceStaffRoutes)
  await app.register(messagingRoutes)
  await app.register(onboardingRoutes)
  await app.register(onboardingStaffRoutes)
  await app.register(profileRoutes)
  await app.register(profileStaffRoutes)
  await app.register(eventRoutes)
  await app.register(threadRoutes)
  await app.register(threadStaffRoutes)
  await app.register(seoStaffRoutes)
  await app.register(organisationRoutes)
  await app.register(ragRoutes)
  // Last, because publicRoutes claims institutional slugs at the root.
  await app.register(publicRoutes)

  // The budget gate. Runs after every route is registered, alongside the
  // route-posture gate in 11-rbac.js — both must pass for the process to serve
  // traffic at all.
  registerBudgetGate(app, env)

  return app
}

export default buildApp

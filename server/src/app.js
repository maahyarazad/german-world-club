import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import etag from '@fastify/etag'
import compress from '@fastify/compress'
import fastifyStatic from '@fastify/static'
import cookie from '@fastify/cookie'
import csrf from '@fastify/csrf-protection'
import cors from '@fastify/cors'
import { ulid } from 'ulid'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod'

import { loadEnv } from './config/env.js'
import { assertBudgets } from './config/budgets.js'
import { GwcLogController, loggerOptions } from './plugins/01-logging.js'
import { makeGenReqId } from './plugins/00-request-context.js'

import requestContext from './plugins/00-request-context.js'
import securityHeaders from './plugins/02-security-headers.js'
import canonicalOrigin from './plugins/03-canonical-origin.js'
import legacyRedirects from './plugins/04-legacy-redirects.js'
import db from './plugins/05-db.js'
import redis from './plugins/06-redis.js'
import rateLimit from './plugins/07-rate-limit.js'
import jwtPlugin from './plugins/09-jwt.js'
import authPlugin from './plugins/10-auth.js'
import rbac from './plugins/11-rbac.js'
import deadline from './plugins/12-deadline.js'
import breakers from './plugins/13-breakers.js'
import errorHandler from './plugins/14-error-handler.js'
import health from './ops/health.js'
import robots from './seo/robots.js'
import sitemap from './seo/sitemap.js'
import seoStaffRoutes from './seo/staff-routes.js'
import authRoutes from './auth/routes.js'
import mediaRoutes from './media/routes.js'
import publicRoutes from './public/routes.js'
import { COOKIES } from '@gwc/contracts/auth'
import { createDbContentSource } from './public/content.js'
import { createAuditWriter } from './ops/audit.js'
import { createStorage } from './media/storage.js'
import { createInlineQueue } from './media/queue.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.resolve(HERE, '..', '..', 'client')

/** Serve the built client when one exists; its public assets otherwise. */
function staticRoot() {
  const dist = path.join(CLIENT_DIR, 'dist')
  return existsSync(dist) ? dist : path.join(CLIENT_DIR, 'public')
}

/**
 * Paths this server generates itself, excluded from the static file sweep.
 *
 * `wildcard: false` registers one route per file found on disk, so a stale or
 * future client build that still ships a robots.txt or sitemap.xml would
 * collide with the generated route and crash startup with "Method 'GET'
 * already declared". Excluding them at registration time — rather than
 * deleting the files — keeps the "one source" rule in seo/robots.js true no
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
export async function buildApp({ env = loadEnv(), contentSource, storage, jobQueue, ...overrides } = {}) {
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
  await app.register(requestContext)
  await app.register(errorHandler)
  await app.register(securityHeaders)
  await app.register(etag)
  await app.register(compress, { global: true, encodings: ['br', 'gzip', 'deflate'] })
  await app.register(db, { env })
  await app.register(redis, { env })
  await app.register(rateLimit, { env })
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
  app.addHook('onRequest', async (request, reply) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    const cookieBorne = Boolean(request.cookies?.[COOKIES.access] ?? request.cookies?.[COOKIES.refresh])
    const bearer = String(request.headers.authorization ?? '').startsWith('Bearer ')
    if (unsafe && cookieBorne && !bearer) {
      await new Promise((resolve, reject) => {
        app.csrfProtection(request, reply, (err) => (err ? reject(err) : resolve()))
      })
    }
  })

  await app.register(jwtPlugin, { env })
  await app.register(authPlugin)

  // Both run as onRequest hooks, before routing, so a duplicate or retired URL
  // never reaches a handler and never becomes a second indexable copy.
  await app.register(canonicalOrigin)
  await app.register(legacyRedirects)

  app.decorate('contentSource', contentSource ?? createDbContentSource(app.pg))
  app.decorate('audit', createAuditWriter(app.pg))

  /**
   * Media storage and the video work queue.
   *
   * Both are seams the suites inject through, for the same reason
   * `contentSource` is: derivative and delivery assertions should be about the
   * pipeline and the routes, not about whether an object store is reachable.
   * The inline queue is the default when no PostgreSQL-backed queue is
   * configured, so a single-host install still transcodes.
   */
  app.decorate('mediaStorage', storage ?? createStorage(env))
  app.decorate('jobQueue', jobQueue ?? createInlineQueue())

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

  await app.register(health)
  await app.register(robots)
  await app.register(sitemap)
  await app.register(authRoutes)
  await app.register(mediaRoutes)
  await app.register(seoStaffRoutes)
  await app.register(publicRoutes)

  // The budget gate. Runs after every route is registered, alongside the
  // route-posture gate in 11-rbac.js — both must pass for the process to serve
  // traffic at all.
  app.addHook('onReady', async () => {
    assertBudgets(env.REQUEST_TIMEOUT_MS)
  })

  return app
}

export default buildApp

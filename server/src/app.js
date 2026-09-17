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
import pressure from './plugins/08-under-pressure.js'
import jwtPlugin from './plugins/09-jwt.js'
import authPlugin from './plugins/10-auth.js'
import rbac from './plugins/11-rbac.js'
import deadline from './plugins/12-deadline.js'
import breakers from './plugins/13-breakers.js'
import errorHandler from './plugins/14-error-handler.js'
import openapi from './plugins/15-openapi.js'
import health from './ops/health.js'
import metrics from './ops/metrics.js'
import jobs from './ops/jobs.js'
import robots from './seo/robots.js'
import sitemap from './seo/sitemap.js'
import seoStaffRoutes from './seo/staff-routes.js'
import authRoutes from './auth/routes.js'
import mediaRoutes from './media/routes.js'
import mediaWorker from './media/worker.js'
import pushRoutes from './push/routes.js'
import publicRoutes from './public/routes.js'
import { COOKIES } from '@gwc/contracts/auth'
import { createDbContentSource } from './public/content.js'
import { createAuditWriter, createAuditReader } from './ops/audit.js'
import { createStorage } from './media/storage.js'
import { createInlineQueue } from './media/queue.js'
import { closeDispatchers } from './integrations/http-client.js'
import { createPaymentsClient } from './integrations/payments.js'
import { createSmsClient, smsUnavailable } from './integrations/sms.js'
import { createMailClient } from './integrations/mail.js'
import { createGeocodingClient } from './integrations/geocoding.js'

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
export async function buildApp({ env = loadEnv(), contentSource, storage, jobQueue, integrations, ...overrides } = {}) {
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
  app.decorate('auditLog', createAuditReader(app.pg))

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
   * Outbound dependencies, each behind its own breaker and its own `undici`
   * dispatcher. Injectable as a whole, so a resilience suite can drive a hung
   * or failing dependency without a network.
   */
  app.decorate('integrations', integrations ?? {
    payments: createPaymentsClient(),
    sms: createSmsClient({
      apiKey: env.SMSGLOBAL_API_KEY,
      apiSecret: env.SMSGLOBAL_API_SECRET,
      origin: env.SMSGLOBAL_ORIGIN,
    }),
    mail: createMailClient(),
    geocoding: createGeocodingClient(),
  })

  app.addHook('onClose', async () => {
    await closeDispatchers()
  })

  /**
   * OTP delivery (FR-012, §6.2).
   *
   * `auth/routes.js` calls this after minting a challenge. It was previously
   * optional-chained against nothing at all, so codes were generated and never
   * sent — the challenge was real, the SMS was not.
   *
   * Runs under the SMS breaker with its declared fallback: refuse and tell the
   * member to retry. Waving sign-in through when the provider is down would
   * turn a supplier outage into an authentication bypass, which is why this
   * throws rather than resolving quietly.
   */
  app.decorate('sendOtp', async ({ mobile, code }, { signal } = {}) => {
    if (!app.integrations.sms.configured) {
      // Loud rather than silent. A second factor that does not send is not a
      // second factor, and in development this is the line that says so.
      app.log.error({ mobile: `••••${String(mobile).slice(-4)}` }, 'SMSGlobal is not configured — no code was sent')
      throw smsUnavailable()
    }

    try {
      return await app.breakers.sms.run((s) => app.integrations.sms.sendCode({ mobile, code }, { signal: s ?? signal }))
    } catch (err) {
      // A 4xx from the provider (an unusable number) is already a business
      // outcome and passes through; anything else becomes the declared refusal.
      if (err.statusCode >= 400 && err.statusCode < 500) throw err
      app.log.error({ err }, 'OTP delivery failed')
      throw smsUnavailable()
    }
  })

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
   * It is still a *gated surface*. seo/surfaces.js declares `/konsole` gated
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

      const sendShell = async (request, reply) =>
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
  await app.register(robots)
  await app.register(sitemap)
  await app.register(authRoutes)
  await app.register(mediaRoutes)
  await app.register(mediaWorker)
  await app.register(pushRoutes)
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

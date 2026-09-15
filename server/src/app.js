import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { ulid } from 'ulid'

import { loadEnv } from './config/env.js'
import { assertBudgets } from './config/budgets.js'
import { GwcLogController, loggerOptions } from './plugins/01-logging.js'
import { makeGenReqId } from './plugins/00-request-context.js'

import requestContext from './plugins/00-request-context.js'
import securityHeaders from './plugins/02-security-headers.js'
import db from './plugins/05-db.js'
import redis from './plugins/06-redis.js'
import rateLimit from './plugins/07-rate-limit.js'
import rbac from './plugins/11-rbac.js'
import deadline from './plugins/12-deadline.js'
import errorHandler from './plugins/14-error-handler.js'
import health from './ops/health.js'
import { createAuditWriter } from './ops/audit.js'

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
 */
export async function buildApp({ env = loadEnv(), ...overrides } = {}) {
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

  await app.register(sensible)
  await app.register(requestContext)
  await app.register(errorHandler)
  await app.register(securityHeaders)
  await app.register(db, { env })
  await app.register(redis, { env })
  await app.register(rateLimit, { env })
  await app.register(rbac)
  await app.register(deadline)
  await app.register(health)

  app.decorate('audit', createAuditWriter(app.pg))

  // The budget gate. Runs after every route is registered, alongside the
  // route-posture gate in 11-rbac.js — both must pass for the process to serve
  // traffic at all.
  app.addHook('onReady', async () => {
    assertBudgets(env.REQUEST_TIMEOUT_MS)
  })

  return app
}

export default buildApp

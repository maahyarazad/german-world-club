import { buildApp } from './app.ts'
import { loadEnv } from './config/env.ts'

/**
 * Process entry point. Everything testable lives in app.js.
 */
const env = loadEnv()
const app = await buildApp({ env })

const shutdown = async (reason: { signal?: string; err?: unknown }) => {
  if (reason.err) app.log.error({ err: reason.err }, 'shutting down after an unhandled error')
  else app.log.info({ signal: reason.signal }, 'shutting down')

  // Bounds the drain: if app.close() hangs on a stuck query or a socket that
  // will not finish, exit anyway rather than wait out the orchestrator SIGKILL.
  const hard = setTimeout(() => process.exit(1), 15_000).unref()
  // Fail readiness BEFORE the socket stops accepting, so the balancer stops
  // routing work into a process that has stopped taking it (FR-046).
  app.beginDraining()
  await new Promise((r) => setTimeout(r, 1_000))
  await app.close()
  clearTimeout(hard)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => shutdown({ signal }))
process.once('uncaughtException', (err) => shutdown({ err }))
process.once('unhandledRejection', (err) => shutdown({ err }))

// Registered above first, so a signal arriving during startup is still handled.
try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (err) {
  app.log.error({ err }, 'failed to start')
  process.exit(1)
}
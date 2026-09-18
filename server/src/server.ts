import closeWithGrace from 'close-with-grace'
import { buildApp } from './app.ts'
import { loadEnv } from './config/env.ts'
import fastify from 'fastify'

/**
 * Process entry point. Everything testable lives in app.js.
 */
const env = loadEnv()
const app = await buildApp({ env })

const shutdown = async (reason: { signal?: string; err?: unknown }) => {
  if (reason.err) app.log.error({ err: reason.err }, 'shutting down after an unhandled error')
  else app.log.info({ signal: reason.signal }, 'shutting down')

  const hard = setTimeout(() => process.exit(1), 15_000).unref()   // ← the timeout
  app.beginDraining()
  await new Promise((r) => setTimeout(r, 1_000))
  await app.close()
  clearTimeout(hard)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => shutdown({ signal }))
process.once('uncaughtException', (err) => shutdown({ err }))
process.once('unhandledRejection', (err) => shutdown({ err }))
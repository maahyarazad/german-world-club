import closeWithGrace from 'close-with-grace'
import { buildApp } from './app.js'
import { loadEnv } from './config/env.js'

/**
 * Process entry point. Everything testable lives in app.js.
 */
const env = loadEnv()
const app = await buildApp({ env })

/**
 * Graceful shutdown (FR-046), in this order:
 *   1. fail readiness immediately, so the load balancer stops sending work
 *   2. stop accepting new connections
 *   3. let in-flight requests finish, within the drain budget
 *   4. close the pool and Redis
 *
 * Step 1 must precede step 2. A balancer that still believes the instance is
 * ready keeps routing work into a process that has stopped accepting it, and
 * those requests fail for no reason.
 */
closeWithGrace({ delay: 15_000 }, async ({ signal, err, manual }) => {
  if (err) app.log.error({ err }, 'shutting down after an unhandled error')
  else app.log.info({ signal, manual }, 'shutting down')

  app.beginDraining()
  // Give the balancer one readiness interval to observe the 503 before the
  // socket stops accepting.
  await new Promise((r) => setTimeout(r, 1_000))
  await app.close()
})

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (err) {
  app.log.error({ err }, 'failed to start')
  process.exit(1)
}

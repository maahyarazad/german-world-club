import fp from 'fastify-plugin'
import { isCurrent } from '../db/migrate.js'

/**
 * Liveness and readiness, reported separately (FR-050).
 *
 * Liveness checks the process only. A liveness probe that fails on a database
 * blip causes a restart loop, which turns a transient dependency problem into
 * an outage.
 *
 * Readiness reports each dependency by name so a failure does not need a log
 * dive. Both routes are exempt from rate limiting and load shedding — a
 * struggling instance must be drained, not killed.
 */
export default fp(
  async function health(app) {
    let draining = false
    app.decorate('beginDraining', () => {
      draining = true
    })
    app.decorate('isDraining', () => draining)

    app.get(
      '/health/live',
      { config: { auth: { audience: 'public' }, budget: 'health' }, logLevel: 'warn' },
      async () => ({ status: 'ok', pid: process.pid }),
    )

    app.get(
      '/health/ready',
      { config: { auth: { audience: 'public' }, budget: 'health' }, logLevel: 'warn' },
      async (request, reply) => {
        const [db, redis, migrations] = await Promise.all([
          app.dbHealthy(),
          app.redisHealthy(),
          isCurrent(app.pg),
        ])

        const dependencies = { database: db, redis, migrations }
        // Readiness must fail as soon as draining begins, BEFORE the drain
        // itself — otherwise the load balancer keeps routing work into a
        // process that has stopped accepting it (FR-046).
        const ready = !draining && db.ok && redis.ok && migrations.ok

        return reply
          .code(ready ? 200 : 503)
          .send({ status: ready ? 'ready' : 'not-ready', draining, dependencies })
      },
    )
  },
  { name: 'health', dependencies: ['db', 'redis'] },
)

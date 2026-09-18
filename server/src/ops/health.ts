import fp from 'fastify-plugin'
import { z } from 'zod'
import { isCurrent } from '../db/migrate.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GwcApp } from '../app.ts'

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
  async function health(app: GwcApp) {
    let draining = false
    app.decorate('beginDraining', () => {
      draining = true
    })
    app.decorate('isDraining', () => draining)

    const livenessSchema = z.object({ status: z.literal('ok'), pid: z.number().int() })

    const readinessSchema = z.object({
      status: z.enum(['ready', 'not-ready']),
      draining: z.boolean(),
      dependencies: z.object({
        database: z.object({ ok: z.boolean(), error: z.string().optional() }),
        redis: z.object({ ok: z.boolean(), error: z.string().optional(), skipped: z.string().optional() }),
        migrations: z.object({ ok: z.boolean(), pending: z.array(z.string()).optional() }),
        circuits: z.record(z.string(), z.string()),
        shedding: z.boolean(),
      }),
    })

    app.get(
      '/health/live',
      {
        config: { auth: { audience: 'public' }, budget: 'health' },
        logLevel: 'warn',
        schema: { response: { 200: livenessSchema } },
      },
      async () => ({ status: 'ok', pid: process.pid }),
    )

    app.get(
      '/health/ready',
      {
        config: { auth: { audience: 'public' }, budget: 'health' },
        logLevel: 'warn',
        // Both outcomes are described: an operator reading 503 needs the same
        // dependency detail as one reading 200, and more urgently.
        schema: { response: { 200: readinessSchema, 503: readinessSchema } },
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const [db, redis, migrations] = await Promise.all([
          app.dbHealthy(),
          app.redisHealthy(),
          isCurrent(app.pg),
        ])

        /**
         * Each dependency by name (FR-050), so a failure needs no log dive.
         *
         * `circuits` and `shedding` are reported but do NOT make the instance
         * unready, and the distinction is deliberate. An open circuit means one
         * dependency is unwell; the instance is still serving every route that
         * does not touch it, and marking it unready would remove working
         * capacity from the pool at exactly the wrong moment. Shedding is the
         * same: a process under pressure needs less traffic, not none, and an
         * unready instance gets restarted rather than relieved.
         */
        const dependencies = {
          database: db,
          redis,
          migrations,
          circuits: app.circuitStates?.() ?? {},
          shedding: app.underPressure?.()?.shedding ?? false,
        }

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

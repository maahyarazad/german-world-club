import fp from 'fastify-plugin'
import underPressure from '@fastify/under-pressure'
import { PROBLEMS } from '@gwc/contracts/errors'

/**
 * Inbound load shedding (FR-045, resilience.md §4).
 *
 * A breaker protects *this* server from a failing dependency. This protects the
 * server from itself: when the event loop is already behind or the heap is
 * nearly full, accepting more work makes every in-flight request slower and
 * finishes none of them sooner. Refusing quickly, with a `Retry-After`, is the
 * only answer that leaves the queue shorter than it found it.
 *
 * `@fastify/circuit-breaker` is deliberately not used anywhere in this
 * codebase: it breaks *inbound* routes by error rate, which duplicates this
 * plugin and does nothing at all for outbound isolation.
 */

/**
 * The health routes are exempt, and the reason is not convenience.
 *
 * If `/health/live` shed load under pressure, the orchestrator would read a
 * struggling instance as a dead one and kill it — turning a recoverable
 * slowdown into a restart, usually while its siblings are under the same load
 * and about to be killed too. A struggling instance must be *drained*, not
 * killed, and draining requires the probes to keep answering.
 */
const EXEMPT = ['/health/live', '/health/ready']

export default fp(
  async function pressure(app, opts = {}) {
    await app.register(underPressure, {
      // 1 s of event-loop delay means requests are already queueing badly.
      maxEventLoopDelay: opts.maxEventLoopDelay ?? 1_000,
      maxHeapUsedBytes: opts.maxHeapUsedBytes ?? 1_073_741_824,
      maxRssBytes: opts.maxRssBytes ?? 1_610_612_736,
      // The value the sampler reports; 0.98 is effectively "the loop is
      // saturated", a stronger signal than delay alone on a bursty workload.
      maxEventLoopUtilization: opts.maxEventLoopUtilization ?? 0.98,

      retryAfter: 10,
      exposeStatusRoute: false,

      pressureHandler: (request, reply, type, value) => {
        if (EXEMPT.includes(request.url.split('?')[0])) {
          // Answer normally: the probe is how the instance gets drained.
          return
        }

        request.log.warn({ type, value, url: request.url }, 'shedding load under pressure')
        app.metrics?.loadShed?.(type)

        return reply
          .code(503)
          .header('retry-after', '10')
          .header('content-type', 'application/problem+json; charset=utf-8')
          .send({
            type: PROBLEMS.SERVICE_UNAVAILABLE.type,
            title: PROBLEMS.SERVICE_UNAVAILABLE.title,
            status: 503,
            detail: 'The server is briefly overloaded. Please retry shortly.',
            instance: request.url.split('?')[0],
            requestId: request.id,
          })
      },
    })

    /**
     * Surfaced so readiness can report it (FR-050). An instance under pressure
     * is not ready for *new* work even though it is alive, and an operator
     * reading `/health/ready` should see that without a log dive.
     */
    app.decorate('underPressure', () => ({
      shedding: app.isUnderPressure?.() ?? false,
      ...(app.memoryUsage?.() ?? {}),
    }))
  },
  { name: 'under-pressure' },
)

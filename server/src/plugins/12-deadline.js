import fp from 'fastify-plugin'
import { ROUTE_BUDGETS } from '../config/budgets.js'
import { PROBLEMS } from '@gwc/contracts/errors'

/**
 * Handler deadlines — timeout layer 3 (FR-032, FR-034).
 *
 * Fastify 5 already exposes `request.signal`, which aborts when the client
 * disconnects. Composing it with `AbortSignal.timeout(budget)` through
 * `AbortSignal.any` gives one signal that fires on whichever happens first.
 * Both APIs are available on Node 22, so this needs no dependency.
 *
 * The composed signal is passed into `pg` and `undici`, so expiry *cancels the
 * underlying work*. A bare `Promise.race` against a timer would answer the
 * client while leaving the query running and the connection busy.
 *
 * It is exposed as `request.deadlineSignal`: `request.signal` is a getter-only
 * property on Fastify's Request and cannot be reassigned.
 */

export class DeadlineExceededError extends Error {
  constructor(routeClass, ms) {
    super(`Handler deadline of ${ms}ms exceeded for route class "${routeClass}"`)
    this.name = 'DeadlineExceededError'
    this.problem = PROBLEMS.REQUEST_DEADLINE_EXCEEDED
    this.statusCode = PROBLEMS.REQUEST_DEADLINE_EXCEEDED.status
  }
}

export const DEFAULT_ROUTE_CLASS = 'member-read'

export default fp(
  async function deadline(app) {
    app.decorateRequest('deadlineSignal', null)
    app.decorateRequest('deadlineMs', null)
    app.decorateRequest('routeClass', null)

    app.addHook('onRequest', async (request) => {
      const routeClass = request.routeOptions?.config?.budget ?? DEFAULT_ROUTE_CLASS
      const budget = ROUTE_BUDGETS[routeClass] ?? ROUTE_BUDGETS[DEFAULT_ROUTE_CLASS]

      const timeout = AbortSignal.timeout(budget.deadlineMs)
      request.routeClass = routeClass
      request.deadlineMs = budget.deadlineMs
      // request.signal aborts on client disconnect; timeout aborts on budget.
      request.deadlineSignal = AbortSignal.any([timeout, request.signal])

      request.deadlineSignal.addEventListener(
        'abort',
        () => {
          if (timeout.aborted) {
            request.log.warn({ routeClass, deadlineMs: budget.deadlineMs }, 'handler deadline exceeded')
          }
        },
        { once: true },
      )
    })

    /**
     * Enforcement (FR-032).
     *
     * The signal alone is not enough. It cancels work that *reads* it — `pg`
     * and `undici` do — but a handler blocked on anything else would still run
     * past its budget and answer late, which is exactly the behaviour the
     * budget rule exists to prevent. Racing the handler against its own
     * deadline guarantees the *caller* gets an answer on time, whatever the
     * handler is doing.
     *
     * The handler is not killed — it cannot be — so the race is a promise to
     * the client, and the signal is what actually frees the resources. The two
     * mechanisms are complementary and neither is sufficient alone.
     *
     * Health routes are exempt: a readiness probe that 503s on its own deadline
     * during a slow moment would be read as a dead instance.
     */
    app.addHook('onRoute', (route) => {
      const routeClass = route.config?.budget ?? DEFAULT_ROUTE_CLASS
      if (routeClass === 'health') return

      const original = route.handler
      route.handler = function deadlineBounded(request, reply) {
        const budget = request.deadlineMs ?? ROUTE_BUDGETS[routeClass].deadlineMs

        return Promise.race([
          Promise.resolve(original.call(this, request, reply)),
          new Promise((_resolve, reject) => {
            const signal = request.deadlineSignal
            if (!signal) return
            if (signal.aborted) return reject(new DeadlineExceededError(routeClass, budget))
            signal.addEventListener(
              'abort',
              () => {
                // A client that hung up needs no response; only the budget
                // expiring produces a 503 anyone will read.
                if (!request.socket?.destroyed) reject(new DeadlineExceededError(routeClass, budget))
              },
              { once: true },
            )
          }),
        ])
      }
    })

    /**
     * `onTimeout` fires only when `connectionTimeout` is set, and by then the
     * socket is already hung up — Fastify's documentation is explicit that
     * nothing can be sent. So this records a signal and nothing else; the
     * client's error comes from layer 1 or 3.
     */
    app.addHook('onTimeout', async (request) => {
      request.log.warn({ routeClass: request.routeClass }, 'connection timed out')
      app.metrics?.requestTimeout?.(request.routeClass)
    })

    app.addHook('onRequestAbort', async (request) => {
      request.log.info({ routeClass: request.routeClass }, 'client aborted; in-flight work cancelled')
    })
  },
  { name: 'deadline', dependencies: ['request-context'] },
)

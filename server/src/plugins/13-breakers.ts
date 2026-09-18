import fp from 'fastify-plugin'
import CircuitBreaker from 'opossum'
import { BREAKERS, errorFilter, assertBreakers, FAIL_CLOSED } from '../config/breakers.ts'
import type { GwcApp } from '../app.ts'

/**
 * One `opossum` breaker per outbound dependency (FR-035).
 *
 * Exposed as `app.breakers.<name>.run(fn)` rather than as raw opossum
 * instances. The wrapper is what keeps the policy honest: a caller passes the
 * work, and the breaker decides whether to run it, time it out, or refuse
 * outright. Handing out the instance would let a caller construct its own
 * fallback and quietly undo the fail-closed policy that is the entire point for
 * payments and for media (FR-037, FR-063).
 *
 * `@fastify/circuit-breaker` is deliberately not used: it breaks *inbound*
 * routes by error rate, which duplicates `@fastify/under-pressure` and does
 * nothing at all for outbound isolation, which is the problem this solves.
 */

/** Raised when a breaker is open, or when a fail-closed dependency failed. */
export class DependencyUnavailableError extends Error {
  constructor(name, problem, cause) {
    super(`Dependency "${name}" is unavailable`)
    this.name = 'DependencyUnavailableError'
    this.dependency = name
    this.problem = problem
    this.statusCode = problem?.status ?? 503
    this.safeDetail = `The ${name} service is temporarily unavailable. Please try again shortly.`
    if (cause) this.cause = cause
  }
}

export default fp(
  async function breakers(app: GwcApp, opts = {}) {
    const policies = opts.breakers ?? BREAKERS
    assertBreakers(policies)

    const instances = {}
    const state = {}

    for (const [name, policy] of Object.entries(policies)) {
      /**
       * The action is `(fn) => fn()`. One breaker per dependency wrapping an
       * arbitrary thunk, rather than one breaker per call site, so every call
       * to a dependency shares the same health signal — which is the only way
       * the threshold means anything.
       */
      const breaker = new CircuitBreaker(async (fn, signal) => fn(signal), {
        timeout: policy.timeout,
        errorThresholdPercentage: policy.errorThresholdPercentage,
        volumeThreshold: policy.volumeThreshold,
        resetTimeout: policy.resetTimeout,
        // A business rejection is not a dependency failure (FR-036).
        errorFilter,
        name,
      })

      state[name] = 'closed'

      // Every transition is logged and counted. An operator needs to see a
      // breaker open at the moment it opens, not infer it from a latency graph.
      for (const event of ['open', 'halfOpen', 'close']) {
        breaker.on(event, () => {
          state[name] = event === 'halfOpen' ? 'half-open' : event === 'open' ? 'open' : 'closed'
          app.log.warn({ dependency: name, circuit: state[name] }, 'circuit state changed')
          app.metrics?.circuitTransition?.(name, state[name])
        })
      }

      instances[name] = {
        policy,
        breaker,
        get state() {
          return state[name]
        },
        /**
         * Run `fn` under this dependency's breaker.
         *
         * `fallbackValue` is accepted only for dependencies whose declared
         * policy is not fail-closed. Passing one for payments or media throws:
         * the restriction is enforced here rather than trusted to every call
         * site remembering, because the cost of forgetting is free membership
         * cards and assets recorded `ready` with no derivatives behind them.
         */
        async run(fn, { fallback, signal } = {}) {
          if (fallback !== undefined && policy.fallback === FAIL_CLOSED) {
            throw new Error(
              `Dependency "${name}" is declared fail-closed; a fallback here would undo FR-037.`,
            )
          }
          try {
            return await breaker.fire(fn, signal)
          } catch (err) {
            // A business outcome passes straight through: the caller asked a
            // valid question and got a valid negative answer.
            if (errorFilter(err)) throw err
            if (fallback !== undefined) return typeof fallback === 'function' ? fallback(err) : fallback
            throw new DependencyUnavailableError(name, opts.problemFor?.(name), err)
          }
        },
      }
    }

    app.decorate('breakers', instances)
    /** Current state per dependency, for readiness and metrics (FR-050). */
    app.decorate('circuitStates', () => ({ ...state }))

    app.addHook('onClose', async () => {
      for (const { breaker } of Object.values(instances)) breaker.shutdown()
    })
  },
  { name: 'breakers' },
)

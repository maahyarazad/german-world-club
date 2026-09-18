import { Agent, request as undiciRequest } from 'undici'
import { OUTBOUND } from '../config/budgets.ts'

/**
 * Outbound HTTP — timeout layer 4 (FR-032, resilience.md §1).
 *
 * One `undici` dispatcher **per dependency**, each with its own timeouts, so a
 * slow payment gateway cannot consume the connection budget the SMS provider
 * needs. A single shared global agent is the default and is wrong here: its
 * connection pool is the shared resource that turns one dependency's bad day
 * into everyone's.
 *
 * The two timeouts do different jobs and both are needed:
 *
 *  - `headersTimeout` — the dependency accepted the connection and then never
 *    answered. This is the common stall.
 *  - `bodyTimeout` — it started answering and then stopped mid-body. Without
 *    this, a response that trickles one byte at a time holds the socket open
 *    indefinitely while looking, to `headersTimeout`, like a success.
 *
 * `connectTimeout` is deliberately much shorter than either: a dependency that
 * cannot complete a TCP handshake in two seconds is down, and waiting out the
 * full budget to discover that spends the caller's deadline on nothing.
 */

/** Per-dependency dispatchers, created once and reused. */
const agents = new Map()

export function dispatcherFor(dependency, { budgetMs } = {}) {
  if (agents.has(dependency)) return agents.get(dependency)

  const budget = budgetMs ?? OUTBOUND[dependency] ?? 5_000
  const agent = new Agent({
    // Sum of the two must stay under the dependency's budget, or the breaker's
    // own timeout is what fires and the layer-4 timeout never does its job.
    headersTimeout: Math.max(1_000, Math.floor(budget * 0.6)),
    bodyTimeout: Math.max(1_000, Math.floor(budget * 0.4)),
    connectTimeout: Math.min(2_000, budget),
    // Bounded, so one dependency cannot open unlimited sockets under load.
    connections: 16,
    pipelining: 1,
  })

  agents.set(dependency, agent)
  return agent
}

/**
 * Make a request against a named dependency.
 *
 * `signal` is the caller's deadline signal, so a handler that runs out of time
 * **cancels the outbound call** rather than abandoning it. Abandoning it would
 * answer the client while leaving the socket and the dependency's own worker
 * busy — which is how a slow dependency becomes a capacity problem here too.
 */
export async function requestDependency(dependency, url, { signal, budgetMs, ...options } = {}) {
  const dispatcher = dispatcherFor(dependency, { budgetMs })
  const response = await undiciRequest(url, { ...options, dispatcher, signal })

  // A 5xx is a dependency failure and must count toward the breaker; a 4xx is
  // a business outcome and must not (FR-036). The distinction is made here, by
  // attaching the status, so `errorFilter` has something to read.
  if (response.statusCode >= 400) {
    const body = await response.body.text().catch(() => '')
    const error = new Error(`${dependency} responded ${response.statusCode}`)
    error.statusCode = response.statusCode
    error.dependency = dependency
    error.responseBody = body.slice(0, 500)
    throw error
  }

  return response
}

/** Close every dispatcher. Called from the app's onClose hook. */
export async function closeDispatchers() {
  const closing = [...agents.values()].map((agent) => agent.close().catch(() => {}))
  agents.clear()
  await Promise.all(closing)
}

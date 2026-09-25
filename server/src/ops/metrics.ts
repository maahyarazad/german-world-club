import fp from 'fastify-plugin'
import type { GwcApp } from '../app.ts'

/**
 * Operational counters (FR-050, T194).
 *
 * Three things an operator needs to see *as they happen*, because each is
 * invisible in a latency graph until it is already an outage:
 *
 *  - **Circuit transitions.** A breaker opening is the single most useful
 *    signal this server produces: it names the dependency and the moment.
 *  - **Rate-limit refusals per bucket.** A spike on `sign-in-ip` is an attack;
 *    the same spike on `public-read` is a crawl the allowlist is missing, and
 *    that one costs the club search visibility.
 *  - **Timeouts per route class.** Which budget is being exceeded says which
 *    dependency is slow far more directly than an average response time.
 *
 * In-process counters rather than a metrics library: this feature has no
 * declared metrics backend, and inventing one would be a dependency and a
 * deployment decision nobody has made. The shape here is deliberately the one a
 * Prometheus or OpenTelemetry exporter reads from, so wiring one later is a
 * mapping rather than a rewrite.
 */

const emptyCounts = () => ({ total: 0, byKey: Object.create(null) })

export function createMetrics() {
  const state = {
    circuitTransitions: emptyCounts(),
    circuitState: Object.create(null),
    rateLimited: emptyCounts(),
    timeouts: emptyCounts(),
    loadShed: emptyCounts(),
    jobFailures: emptyCounts(),
    // Feature 012: visible without the database, which is the point when the
    // database is the reason faults are failing to record.
    serverFaults: { stored: 0, suppressed: 0, failed: 0 },
    startedAt: Date.now(),
  }

  const bump = (counter, key) => {
    counter.total += 1
    counter.byKey[key] = (counter.byKey[key] ?? 0) + 1
  }

  return {
    circuitTransition(dependency, to) {
      bump(state.circuitTransitions, `${dependency}:${to}`)
      state.circuitState[dependency] = to
    },
    rateLimited(bucket) {
      bump(state.rateLimited, bucket ?? 'unknown')
    },
    requestTimeout(routeClass) {
      bump(state.timeouts, routeClass ?? 'unknown')
    },
    loadShed(type) {
      bump(state.loadShed, type ?? 'unknown')
    },
    jobFailure(name) {
      bump(state.jobFailures, name ?? 'unknown')
    },
    serverFaultStored() {
      state.serverFaults.stored += 1
    },
    serverFaultSuppressed() {
      state.serverFaults.suppressed += 1
    },
    serverFaultFailed() {
      state.serverFaults.failed += 1
    },
    /** A plain snapshot — the shape an exporter or a health payload reads. */
    snapshot() {
      return {
        uptimeMs: Date.now() - state.startedAt,
        circuits: { ...state.circuitState },
        circuitTransitions: { total: state.circuitTransitions.total, byKey: { ...state.circuitTransitions.byKey } },
        rateLimited: { total: state.rateLimited.total, byBucket: { ...state.rateLimited.byKey } },
        timeouts: { total: state.timeouts.total, byRouteClass: { ...state.timeouts.byKey } },
        loadShed: { total: state.loadShed.total, byType: { ...state.loadShed.byKey } },
        jobFailures: { total: state.jobFailures.total, byJob: { ...state.jobFailures.byKey } },
        serverFaults: { ...state.serverFaults },
      }
    },
  }
}

export default fp(
  async function metrics(app: GwcApp) {
    app.decorate('metrics', createMetrics())
  },
  { name: 'metrics' },
)

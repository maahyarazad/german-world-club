import { OUTBOUND } from './budgets.js'

/**
 * Per-dependency circuit-breaker policy (resilience.md §2, FR-035, FR-037).
 *
 * A breaker answers "is this dependency healthy?", which is a different
 * question from "how long may this take?" (the timeout) and "how often may this
 * caller ask?" (the rate limit). A system with only timeouts lets a failing
 * dependency be hammered by every request until it recovers or dies; that is
 * what this table prevents.
 *
 * `fallback` is mandatory on every entry and the startup gate enforces it. A
 * dependency with no declared unavailable-behaviour is a dependency whose
 * outage behaviour nobody decided, which in practice means it propagates a 500
 * and takes the whole route with it.
 */

/**
 * Fail-closed is a policy, not an omission (FR-037).
 *
 * A breaker's usual kindness is a fallback value. For payments there is no safe
 * one: a fallback that lets checkout proceed hands out membership cards and
 * event seats for free. So the declared behaviour is an explicit, loud failure.
 */
export const FAIL_CLOSED = 'fail-closed'

/** @typedef {{ timeout: number, errorThresholdPercentage: number, volumeThreshold: number,
 *              resetTimeout: number, fallback: string, retrySafe: boolean, why: string }} BreakerPolicy */

/** @type {Record<string, BreakerPolicy>} */
export const BREAKERS = Object.freeze({
  payments: {
    timeout: OUTBOUND.payments,
    errorThresholdPercentage: 50,
    volumeThreshold: 10,
    resetTimeout: 60_000,
    fallback: FAIL_CLOSED,
    // Only safe carrying the deterministic invoice reference (§12.5), which is
    // what makes the repeat reuse the same invoice instead of raising a second.
    retrySafe: false,
    why: 'No fallback may let checkout proceed — free cards and event seats',
  },
  sms: {
    timeout: OUTBOUND.sms,
    errorThresholdPercentage: 50,
    volumeThreshold: 20,
    resetTimeout: 30_000,
    fallback: 'refuse-retry-later',
    retrySafe: true,
    why: 'Refuse sign-in with otp-unavailable; the same code stays valid',
  },
  mail: {
    timeout: OUTBOUND.mail,
    errorThresholdPercentage: 60,
    volumeThreshold: 20,
    resetTimeout: 60_000,
    fallback: 'enqueue-for-later',
    retrySafe: true,
    why: 'Queued by message id, so a repeat delivers once',
  },
  geocoding: {
    timeout: OUTBOUND.geocoding,
    errorThresholdPercentage: 50,
    volumeThreshold: 10,
    resetTimeout: 120_000,
    fallback: 'save-without-coordinates',
    retrySafe: true,
    why: 'An address without coordinates is still a usable record; backfill later',
  },
  redis: {
    timeout: OUTBOUND.redis,
    errorThresholdPercentage: 50,
    volumeThreshold: 50,
    resetTimeout: 10_000,
    fallback: 'per-bucket-skip-on-error',
    retrySafe: true,
    why: 'The limiter’s own dependency must not become the outage',
  },
  mediaImage: {
    timeout: OUTBOUND.mediaImage,
    errorThresholdPercentage: 50,
    volumeThreshold: 10,
    resetTimeout: 30_000,
    // FR-063: no asset may be recorded `ready` when the generator is failing.
    // A "ready" asset with no derivatives is worse than a refused upload —
    // every page referencing it then has nothing to serve.
    fallback: FAIL_CLOSED,
    retrySafe: true,
    why: 'Content-addressed, so a retry after recovery writes identical bytes',
  },
  mediaVideo: {
    timeout: OUTBOUND.mediaVideoJob,
    errorThresholdPercentage: 50,
    volumeThreshold: 5,
    resetTimeout: 60_000,
    fallback: FAIL_CLOSED,
    retrySafe: true,
    why: 'A failed transcode sets failed + reason, never a stuck processing row',
  },
})

/**
 * The shared `errorFilter` — the load-bearing detail (FR-036).
 *
 * Returns `true` for errors that must NOT count toward the breaker.
 *
 * A declined card, an invalid phone number, or any 4xx is a **business
 * outcome**, not a dependency failure. Without this, a busy evening of
 * legitimately declined cards trips the payment breaker and takes payments down
 * for everyone — an outage manufactured by the protection itself. SC-012 tests
 * exactly that scenario.
 */
export function errorFilter(err) {
  const status = err?.statusCode ?? err?.status
  if (typeof status === 'number' && status >= 400 && status < 500) return true
  if (err?.code === 'CARD_DECLINED') return true
  return false
}

/**
 * @throws if any dependency omits a fallback (FR-037). Called at startup, so an
 * undeclared outage behaviour prevents boot rather than surfacing during one.
 */
export function assertBreakers(breakers = BREAKERS) {
  const problems = []
  for (const [name, policy] of Object.entries(breakers)) {
    if (!policy.fallback) problems.push(`dependency "${name}" declares no fallback behaviour`)
    if (typeof policy.timeout !== 'number' || policy.timeout <= 0) {
      problems.push(`dependency "${name}" has an invalid timeout`)
    }
    if (typeof policy.resetTimeout !== 'number' || policy.resetTimeout <= 0) {
      problems.push(`dependency "${name}" has an invalid resetTimeout`)
    }
    if (!policy.why) problems.push(`dependency "${name}" does not say why — the table must stay reviewable`)
  }
  if (problems.length > 0) {
    throw new Error(
      `Circuit-breaker configuration invalid (FR-037):\n${problems.map((p) => `  ${p}`).join('\n')}`,
    )
  }
}

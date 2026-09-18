import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import breakers from '../../src/plugins/13-breakers.ts'
import { DependencyUnavailableError } from '../../src/plugins/13-breakers.ts'
import { assertBreakers, BREAKERS, FAIL_CLOSED } from '../../src/config/breakers.ts'

/**
 * SC-011 — closed → open → half-open → closed, with **zero** calls reaching the
 * dependency while open.
 *
 * That last clause is the one worth being careful about. A breaker that opens
 * but still lets calls through has done nothing: the dependency is still being
 * hammered while it tries to recover, which is the situation the breaker exists
 * to end. So these tests count actual invocations rather than inspecting the
 * circuit's reported state.
 */

/** A tiny instance with a fast policy, so the states can be walked in real time. */
async function buildBreakerApp(policy = {}) {
  const app = Fastify({ logger: false })
  await app.register(breakers, {
    breakers: {
      flaky: {
        timeout: 200,
        errorThresholdPercentage: 50,
        volumeThreshold: 4,
        resetTimeout: 150,
        fallback: 'refuse-retry-later',
        retrySafe: true,
        why: 'Test dependency',
        ...policy,
      },
    },
  })
  await app.ready()
  return app
}

describe('the state machine (SC-011)', () => {
  let app
  beforeEach(async () => {
    if (app) await app.close()
    app = await buildBreakerApp()
  })

  const fail = () => Promise.reject(Object.assign(new Error('dependency down'), { code: 'ECONNREFUSED' }))
  const succeed = () => Promise.resolve('ok')

  it('starts closed and passes calls straight through', async () => {
    expect(app.circuitStates().flaky).toBe('closed')
    await expect(app.breakers.flaky.run(succeed)).resolves.toBe('ok')
  })

  it('stays closed below the volume threshold, however bad the failures', async () => {
    // Three failures out of three is 100%, but three is below the volume
    // threshold of four. Opening on a tiny sample would trip the circuit on
    // the first two requests after a deploy.
    for (let i = 0; i < 3; i += 1) {
      await app.breakers.flaky.run(fail).catch(() => {})
    }
    expect(app.circuitStates().flaky).toBe('closed')
  })

  it('opens once the threshold is crossed with enough volume', async () => {
    for (let i = 0; i < 6; i += 1) {
      await app.breakers.flaky.run(fail).catch(() => {})
    }
    expect(app.circuitStates().flaky).toBe('open')
  })

  /**
   * The assertion the whole file is built around.
   */
  it('lets ZERO calls reach the dependency while open', async () => {
    const dependency = vi.fn(fail)

    for (let i = 0; i < 6; i += 1) {
      await app.breakers.flaky.run(dependency).catch(() => {})
    }
    expect(app.circuitStates().flaky).toBe('open')

    const callsBeforeOpen = dependency.mock.calls.length
    for (let i = 0; i < 10; i += 1) {
      await app.breakers.flaky.run(dependency).catch(() => {})
    }

    expect(
      dependency.mock.calls.length - callsBeforeOpen,
      'an open circuit that still calls the dependency has done nothing',
    ).toBe(0)
  })

  it('refuses immediately while open, rather than waiting out the timeout', async () => {
    for (let i = 0; i < 6; i += 1) await app.breakers.flaky.run(fail).catch(() => {})

    const started = process.hrtime.bigint()
    await app.breakers.flaky.run(fail).catch(() => {})
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    // Well under the 200 ms call timeout: the point of an open circuit is that
    // the caller gets its answer now.
    expect(elapsedMs).toBeLessThan(50)
  })

  it('probes once after the reset window and closes on success', async () => {
    for (let i = 0; i < 6; i += 1) await app.breakers.flaky.run(fail).catch(() => {})
    expect(app.circuitStates().flaky).toBe('open')

    await new Promise((resolve) => setTimeout(resolve, 200))

    const dependency = vi.fn(succeed)
    await expect(app.breakers.flaky.run(dependency)).resolves.toBe('ok')

    // Recovery is automatic and requires no deploy (SC-011).
    expect(dependency).toHaveBeenCalledTimes(1)
    expect(app.circuitStates().flaky).toBe('closed')
  })

  it('reopens when the half-open probe fails', async () => {
    for (let i = 0; i < 6; i += 1) await app.breakers.flaky.run(fail).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 200))

    await app.breakers.flaky.run(fail).catch(() => {})
    expect(app.circuitStates().flaky).toBe('open')
  })

  it('counts a call that exceeds its timeout as a failure', async () => {
    const slow = () => new Promise((resolve) => setTimeout(() => resolve('eventually'), 1_000))
    for (let i = 0; i < 6; i += 1) await app.breakers.flaky.run(slow).catch(() => {})
    expect(app.circuitStates().flaky).toBe('open')
  })

  it('surfaces an open circuit as a 503, not an internal error', async () => {
    for (let i = 0; i < 6; i += 1) await app.breakers.flaky.run(fail).catch(() => {})

    const error = await app.breakers.flaky.run(fail).catch((err) => err)
    expect(error).toBeInstanceOf(DependencyUnavailableError)
    expect(error.statusCode).toBe(503)
    expect(error.dependency).toBe('flaky')
  })

  it('returns the declared fallback instead, when the policy allows one', async () => {
    for (let i = 0; i < 6; i += 1) await app.breakers.flaky.run(fail).catch(() => {})
    await expect(app.breakers.flaky.run(fail, { fallback: 'degraded' })).resolves.toBe('degraded')
  })
})

describe('the policy table is complete (FR-037)', () => {
  it('accepts the shipped table', () => {
    expect(() => assertBreakers()).not.toThrow()
  })

  it('refuses a dependency that declares no fallback', () => {
    // A dependency whose outage behaviour nobody decided propagates a 500 and
    // takes the route with it. Startup is where that should be discovered.
    expect(() =>
      assertBreakers({ nameless: { timeout: 1000, resetTimeout: 1000, why: 'x' } }),
    ).toThrow(/declares no fallback/)
  })

  it('refuses a dependency that does not say why', () => {
    expect(() =>
      assertBreakers({ mute: { timeout: 1000, resetTimeout: 1000, fallback: 'refuse' } }),
    ).toThrow(/does not say why/)
  })

  it('declares every dependency in the resilience.md table', () => {
    expect(Object.keys(BREAKERS).sort()).toEqual(
      ['geocoding', 'mail', 'mediaImage', 'mediaVideo', 'payments', 'redis', 'sms'],
    )
  })

  it('keeps payments and media fail-closed', () => {
    expect(BREAKERS.payments.fallback).toBe(FAIL_CLOSED)
    expect(BREAKERS.mediaImage.fallback).toBe(FAIL_CLOSED)
    expect(BREAKERS.payments.retrySafe, 'only safe with the §12.5 reference').toBe(false)
  })
})

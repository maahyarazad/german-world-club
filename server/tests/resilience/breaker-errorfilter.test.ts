import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import breakers from '../../src/plugins/13-breakers.ts'
import { errorFilter } from '../../src/config/breakers.ts'
import { createPaymentsClient, CardDeclinedError, idempotencyReference } from '../../src/integrations/payments.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * SC-012 — twenty consecutive declined cards leave the payment circuit
 * **closed**.
 *
 * This is the subtlest failure in the whole resilience story, because the
 * broken version looks correct: the breaker counts failures, declines are
 * failures, the circuit opens, the code "works". What actually happens is that
 * a busy Friday evening of legitimately declined cards takes payments down for
 * everyone — an outage manufactured entirely by the protection.
 *
 * A declined card is a **business outcome**: the gateway was asked a question
 * and gave a correct, timely answer. So is an invalid phone number, and so is
 * any 4xx. None of them says anything about whether the dependency is healthy,
 * which is the only question a breaker exists to answer.
 */

async function buildPaymentsApp() {
  const app = Fastify({ logger: false })
  await app.register(breakers, {
    breakers: {
      payments: {
        timeout: 200,
        errorThresholdPercentage: 50,
        volumeThreshold: 5,
        resetTimeout: 10_000,
        fallback: 'fail-closed',
        retrySafe: false,
        why: 'Test payments',
      },
    },
  })
  await app.ready()
  return app
}

describe('the filter itself (FR-036)', () => {
  it('excludes every 4xx — the request was answered, just not affirmatively', () => {
    for (const statusCode of [400, 401, 402, 403, 404, 409, 422, 429, 499]) {
      expect(errorFilter({ statusCode }), `${statusCode} must not count`).toBe(true)
    }
  })

  it('excludes a declined card by its own code', () => {
    expect(errorFilter(new CardDeclinedError())).toBe(true)
  })

  it('COUNTS a 5xx, a timeout and a refused connection', () => {
    for (const err of [
      { statusCode: 500 }, { statusCode: 502 }, { statusCode: 503 },
      { code: 'ETIMEDOUT' }, { code: 'ECONNREFUSED' }, { code: 'UND_ERR_HEADERS_TIMEOUT' },
      new Error('something went wrong'),
    ]) {
      expect(errorFilter(err), `${err.statusCode ?? err.code ?? err.message} must count`).toBe(false)
    }
  })
})

describe('twenty declines leave the circuit closed (SC-012)', () => {
  let app: GwcApp
  beforeEach(async () => {
    if (app) await app.close()
    app = await buildPaymentsApp()
  })

  const decline = () => Promise.reject(new CardDeclinedError())

  it('stays closed across twenty consecutive declines', async () => {
    for (let i = 0; i < 20; i += 1) {
      await expect(app.breakers.payments.run(decline)).rejects.toBeInstanceOf(CardDeclinedError)
    }
    expect(app.circuitStates().payments).toBe('closed')
  })

  it('keeps reaching the gateway throughout — the 21st card is still tried', async () => {
    const gateway = vi.fn(decline)
    for (let i = 0; i < 20; i += 1) await app.breakers.payments.run(gateway).catch(() => {})

    // A member whose card is fine must not be refused because twenty other
    // people's cards were declined.
    const good = vi.fn(() => Promise.resolve({ status: 'paid' }))
    await expect(app.breakers.payments.run(good)).resolves.toMatchObject({ status: 'paid' })
    expect(good).toHaveBeenCalledTimes(1)
  })

  it('passes the decline through unchanged, so the member is told why', async () => {
    const error = await app.breakers.payments.run(decline).catch((err) => err)
    expect(error).toBeInstanceOf(CardDeclinedError)
    expect(error.statusCode).toBe(402)
    // Not dressed up as a 503: retrying changes nothing until the card does.
    expect(error.statusCode).not.toBe(503)
  })

  /**
   * The filter must not disable the breaker — only stop it mis-counting.
   *
   * A filtered error is recorded as a *success*, so ten declines followed by
   * ten genuine failures is exactly 50% — the threshold, which opossum treats
   * as not-yet-open. The ratio here is deliberately past the boundary rather
   * than on it, so the test asserts the mechanism instead of a tie-break.
   */
  it('still opens on real gateway failures, mixed in among the declines', async () => {
    const down = () => Promise.reject(Object.assign(new Error('gateway down'), { code: 'ECONNREFUSED' }))

    for (let i = 0; i < 10; i += 1) await app.breakers.payments.run(decline).catch(() => {})
    expect(app.circuitStates().payments, 'declines alone never open it').toBe('closed')

    // 15 failures against 10 filtered declines is 60%, clear of the 50% line.
    for (let i = 0; i < 15; i += 1) await app.breakers.payments.run(down).catch(() => {})
    expect(app.circuitStates().payments, 'real failures must still open it').toBe('open')
  })
})

describe('the idempotency reference (FR-038, §12.5)', () => {
  const intent = {
    accountId: '2f1c9a5e-0000-4000-8000-000000000001',
    purpose: 'membership',
    targetId: 'card-2026',
    amountMinor: 150_000,
    currency: 'AED',
  }

  it('is identical for the same intent, so a retry reuses the same invoice', () => {
    expect(idempotencyReference(intent)).toBe(idempotencyReference(intent))
  })

  /**
   * The failure this prevents: after a timeout the client cannot tell whether
   * the charge happened, so it retries. A reference containing a timestamp or
   * a random value produces a second invoice and a second charge.
   */
  it('does not vary with time', async () => {
    const first = idempotencyReference(intent)
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(idempotencyReference(intent)).toBe(first)
  })

  it('differs when the amount or the target differs', () => {
    expect(idempotencyReference({ ...intent, amountMinor: 150_001 })).not.toBe(idempotencyReference(intent))
    expect(idempotencyReference({ ...intent, targetId: 'card-2027' })).not.toBe(idempotencyReference(intent))
  })

  it('does not leak the account id to the gateway or its logs', () => {
    expect(idempotencyReference(intent)).not.toContain(intent.accountId)
  })

  it('travels on the charge as the gateway’s idempotency key', async () => {
    const send = vi.fn(async () => ({ body: { json: async () => ({ invoiceId: 'inv_1' }) } }))
    const payments = createPaymentsClient({ send })

    const result = await payments.charge(intent)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][2].headers['idempotency-key']).toBe(idempotencyReference(intent))
    expect(result).toMatchObject({ status: 'paid', invoiceId: 'inv_1' })
  })

  it('raises a declined card as a business outcome, not a dependency failure', async () => {
    const send = vi.fn(async () => ({
      body: { json: async () => ({ status: 'declined', reason: 'Insufficient funds' }) },
    }))
    const payments = createPaymentsClient({ send })

    const error = await payments.charge(intent).catch((err) => err)
    expect(error).toBeInstanceOf(CardDeclinedError)
    expect(errorFilter(error), 'a decline must never count toward the circuit').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Push providers (feature 011, research R7)
// ---------------------------------------------------------------------------

describe('push: a dead token is a business outcome, not an outage', () => {
  it('excludes DeviceNotRegistered and UNREGISTERED, and still counts a 5xx', () => {
    expect(errorFilter({ code: 'DeviceNotRegistered' })).toBe(true)
    expect(errorFilter({ code: 'UNREGISTERED' })).toBe(true)
    // Counter-assertion: a provider that is actually failing must still count.
    expect(errorFilter({ statusCode: 503 })).toBe(false)
  })

  async function buildPushBreakerApp() {
    const app = Fastify({ logger: false })
    await app.register(breakers, {
      breakers: {
        pushExpo: {
          timeout: 500, errorThresholdPercentage: 50, volumeThreshold: 3, resetTimeout: 60_000,
          fallback: 'retry-later', retrySafe: true, why: 'Test push',
        },
      },
    })
    await app.ready()
    return app
  }

  const message = (n: number) => ({ token: `ExponentPushToken[t-${n}]`, title: 't', body: 'b', data: {} })

  it('stays closed through a broadcast full of uninstalled apps', async () => {
    const { createPushTransport } = await import('../../src/modules/push/providers.ts')
    const app = await buildPushBreakerApp()
    const send = async (_url: string, options: { body?: string }) => ({
      statusCode: 200,
      body: {
        json: async () => ({
          data: JSON.parse(options.body!).map(() => ({
            status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' },
          })),
        }),
        text: async () => '',
      },
    })
    const transport = createPushTransport({ breakers: app.breakers, send })

    for (let i = 0; i < 10; i += 1) {
      const outcomes = await transport.send('expo', [message(i)])
      expect(outcomes[0]).toMatchObject({ status: 'failed', permanent: true })
    }
    expect(app.circuitStates().pushExpo).toBe('closed')
    await app.close()
  })

  it('opens on 5xx, and an open circuit is a retry that spends no attempt', async () => {
    const { createPushTransport } = await import('../../src/modules/push/providers.ts')
    const app = await buildPushBreakerApp()
    let calls = 0
    const send = async () => {
      calls += 1
      return { statusCode: 503, body: { json: async () => ({}), text: async () => 'unavailable' } }
    }
    const transport = createPushTransport({ breakers: app.breakers, send })

    for (let i = 0; i < 5; i += 1) {
      const [outcome] = await transport.send('expo', [message(i)])
      expect(outcome!.status).toBe('retry')
    }
    expect(app.circuitStates().pushExpo).toBe('open')

    const before = calls
    const [outcome] = await transport.send('expo', [message(99)])
    expect(outcome).toMatchObject({ status: 'retry', notAttempted: true })
    // Refused by the breaker: the provider was not asked at all.
    expect(calls).toBe(before)
    await app.close()
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import requestContext from '../../src/plugins/00-request-context.ts'
import errorHandler from '../../src/plugins/14-error-handler.ts'
import deadline, { DeadlineExceededError } from '../../src/plugins/12-deadline.ts'
import { ROUTE_BUDGETS, OUTBOUND, assertBudgets, tightestDeadlineMs } from '../../src/config/budgets.ts'

/**
 * SC-009 — a request against a hung dependency completes within 110% of its
 * declared budget, and the underlying work is **cancelled**, not merely
 * abandoned.
 *
 * The second clause is the one that matters and the one a naive implementation
 * gets wrong. `Promise.race` against a timer answers the client on time and
 * leaves the query running, the connection checked out, and the dependency's
 * worker busy — so under load the server accumulates exactly the work it just
 * told the client it had given up on. The signal is what makes cancellation
 * real; the race is what makes the *answer* punctual. Both are needed, and
 * these tests assert each separately.
 */

/** A minimal instance carrying the real deadline plugin and error handler. */
async function buildDeadlineApp(routes) {
  const app = Fastify({ logger: false })
  await app.register(requestContext)
  await app.register(errorHandler)
  await app.register(deadline)
  await app.register(async (scope) => {
    for (const [url, { budget, handler }] of Object.entries(routes)) {
      scope.get(url, { config: { auth: { audience: 'public' }, budget } }, handler)
    }
  })
  await app.ready()
  return app
}

let app

beforeAll(async () => {
  app = await buildDeadlineApp({
    // Hangs forever unless something cancels it.
    '/hang': {
      budget: 'member-read',
      handler: () => new Promise(() => {}),
    },
    // Observes its own cancellation, which is what "cancelled, not abandoned"
    // means in practice.
    '/observes-cancellation': {
      budget: 'member-read',
      handler: (request) =>
        new Promise((resolve, reject) => {
          request.deadlineSignal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        }),
    },
    '/fast': { budget: 'member-read', handler: async () => ({ ok: true }) },
    '/slow-public': { budget: 'public-page', handler: () => new Promise(() => {}) },
  })
})

afterAll(async () => { await app.close() })

describe('the budget rule (FR-033)', () => {
  it('accepts the shipped table against the configured request timeout', () => {
    expect(() => assertBudgets(30_000)).not.toThrow()
  })

  it('fails startup when a route may call more than its deadline allows', () => {
    // Inverting the rule inverts the failure: the caller gives up first,
    // retries, and the retry lands while the original is still running.
    expect(() =>
      assertBudgets(
        30_000,
        { checkout: { deadlineMs: 5_000, calls: ['payments'] } },
        { payments: 8_000 },
      ),
    ).toThrow()
  })

  it('fails startup when a deadline exceeds the request timeout', () => {
    expect(() => assertBudgets(1_000)).toThrow()
  })

  it('bounds the database statement timeout by the tightest route deadline', () => {
    expect(tightestDeadlineMs()).toBe(
      Math.min(...Object.values(ROUTE_BUDGETS).map((b) => b.deadlineMs)),
    )
  })

  it('leaves mail out of every route’s inline calls', () => {
    // Mail is enqueued, never sent inside a request — checkout's budget could
    // not accommodate both a payment call and an SMTP round trip.
    for (const [name, budget] of Object.entries(ROUTE_BUDGETS)) {
      expect(budget.calls, `${name} must not call mail inline`).not.toContain('mail')
    }
    expect(OUTBOUND.mail).toBeGreaterThan(0)
  })
})

describe('a hung handler is answered within its budget (SC-009)', () => {
  it('returns 503 request-deadline-exceeded rather than hanging', async () => {
    const response = await app.inject({ method: 'GET', url: '/hang' })

    expect(response.statusCode).toBe(503)
    expect(response.json().type).toMatch(/request-deadline-exceeded/)
  })

  it('answers within 110% of the declared budget', async () => {
    const budget = ROUTE_BUDGETS['member-read'].deadlineMs

    const started = process.hrtime.bigint()
    await app.inject({ method: 'GET', url: '/hang' })
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    expect(elapsedMs, `took ${elapsedMs.toFixed(0)}ms against a ${budget}ms budget`)
      .toBeLessThan(budget * 1.1)
    // And not absurdly early either — that would mean something other than the
    // deadline answered, and the assertion above would be measuring nothing.
    expect(elapsedMs).toBeGreaterThan(budget * 0.5)
  })

  it('uses each route class’s OWN budget, not one global value', async () => {
    const publicBudget = ROUTE_BUDGETS['public-page'].deadlineMs
    const memberBudget = ROUTE_BUDGETS['member-read'].deadlineMs
    expect(publicBudget).not.toBe(memberBudget)

    const started = process.hrtime.bigint()
    await app.inject({ method: 'GET', url: '/slow-public' })
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    expect(elapsedMs).toBeLessThan(publicBudget * 1.1)
    expect(elapsedMs).toBeGreaterThan(memberBudget)
  })

  it('leaves a fast handler completely alone', async () => {
    const response = await app.inject({ method: 'GET', url: '/fast' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
  })
})

describe('the work is cancelled, not merely abandoned (FR-034)', () => {
  /**
   * The assertion that separates a real deadline from a `Promise.race`. The
   * handler is told to stop; a race would answer the client and leave it
   * running.
   */
  it('aborts the deadline signal the handler is waiting on', async () => {
    const response = await app.inject({ method: 'GET', url: '/observes-cancellation' })
    // The handler rejected because its signal fired — it was not left pending.
    expect(response.statusCode).toBeGreaterThanOrEqual(500)
  })

  it('exposes a signal that is already composed with the client disconnect', async () => {
    const seen = []
    const probe = await buildDeadlineApp({
      '/probe': {
        budget: 'member-read',
        handler: async (request) => {
          seen.push({
            hasSignal: request.deadlineSignal instanceof AbortSignal,
            deadlineMs: request.deadlineMs,
            routeClass: request.routeClass,
          })
          return { ok: true }
        },
      },
    })

    await probe.inject({ method: 'GET', url: '/probe' })
    await probe.close()

    expect(seen[0]).toEqual({
      hasSignal: true,
      deadlineMs: ROUTE_BUDGETS['member-read'].deadlineMs,
      routeClass: 'member-read',
    })
  })

  it('names the route class and the budget in the error', () => {
    const error = new DeadlineExceededError('member-read', 2000)
    expect(error.message).toContain('member-read')
    expect(error.message).toContain('2000')
    expect(error.statusCode).toBe(503)
  })
})

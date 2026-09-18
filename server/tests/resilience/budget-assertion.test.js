import { describe, it, expect } from 'vitest'
import { assertBudgets, ROUTE_BUDGETS, OUTBOUND, tightestDeadlineMs } from '../../src/config/budgets.js'

/**
 * FR-033: for every route class, Σ(outbound budgets) < handler deadline <
 * requestTimeout. Violating it inverts the failure — the caller gives up
 * first, retries, and the retry lands while the original is still running.
 */
describe('budget assertion (FR-033)', () => {
  it('accepts the shipped configuration at the configured requestTimeout', () => {
    expect(() => assertBudgets(30_000)).not.toThrow()
  })

  it('rejects a route whose outbound budgets meet or exceed its deadline', () => {
    const budgets = { checkout: { deadlineMs: 8000, calls: ['payments'] } } // payments is 8000
    expect(() => assertBudgets(30_000, budgets)).toThrow(/Σ outbound 8000ms >= deadline 8000ms/)
  })

  it('rejects a route deadline that meets or exceeds requestTimeout', () => {
    const budgets = { report: { deadlineMs: 30_000, calls: [] } }
    expect(() => assertBudgets(30_000, budgets)).toThrow(/>= requestTimeout/)
  })

  it('rejects a route that names an unknown dependency', () => {
    const budgets = { odd: { deadlineMs: 5000, calls: ['telepathy'] } }
    expect(() => assertBudgets(30_000, budgets)).toThrow(/unknown dependency "telepathy"/)
  })

  it('names every offending route class, not just the first', () => {
    const budgets = {
      a: { deadlineMs: 1000, calls: ['payments'] },
      b: { deadlineMs: 1000, calls: ['mail'] },
    }
    expect(() => assertBudgets(30_000, budgets)).toThrow(/"a"[\s\S]*"b"/)
  })

  it('keeps mail out of every inline route budget, since it is enqueued', () => {
    // Checkout could not accommodate both payments (8s) and mail (10s) inside
    // its 12s deadline; invoice mail is queued instead (research R8).
    for (const [name, { calls }] of Object.entries(ROUTE_BUDGETS)) {
      expect(calls, `route class "${name}" must not call mail inline`).not.toContain('mail')
    }
  })

  it('bounds the database statement timeout below the tightest deadline', () => {
    expect(tightestDeadlineMs()).toBeLessThan(Math.min(...Object.values(ROUTE_BUDGETS).map((b) => b.deadlineMs)) + 1)
    expect(OUTBOUND.redis).toBeLessThan(tightestDeadlineMs())
  })
})

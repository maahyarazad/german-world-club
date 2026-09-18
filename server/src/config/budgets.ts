/**
 * Time budgets — timeout layers 3 and 4 of contracts/resilience.md §1.
 *
 * The rule (FR-033): for every route class,
 *
 *     Σ(outbound budgets it may incur) < its handler deadline < requestTimeout
 *
 * Violating it inverts the failure: the caller gives up first, retries, and the
 * retry lands while the original is still running — the standard path by which
 * a slow dependency becomes an outage. `assertBudgets` enforces it at startup
 * so the rule is checked by the process, not by review.
 */

/** Per-dependency outbound budgets, in milliseconds. */
export const OUTBOUND = Object.freeze({
  payments: 8000,
  sms: 5000,
  mail: 10000,
  geocoding: 3000,
  redis: 250,
  mediaImage: 6000,
  // Video transcoding is a queued job, not an inbound-request dependency, so
  // it is deliberately absent from every route's `calls` list below.
  mediaVideoJob: 300000,
})

/**
 * Route classes: the handler deadline, and which dependencies a request of that
 * class may call *inline*.
 *
 * `mail` appears in no list on purpose. Invoice and notification mail is
 * enqueued (research R8's declared fallback), never sent inside the request —
 * checkout's budget could not otherwise accommodate both payments and mail.
 */
export const ROUTE_BUDGETS = Object.freeze({
  'public-page': { deadlineMs: 3000, calls: ['redis'] },
  sitemap: { deadlineMs: 10000, calls: ['redis'] },
  auth: { deadlineMs: 5000, calls: ['redis'] },
  'otp-send': { deadlineMs: 6000, calls: ['sms', 'redis'] },
  'member-read': { deadlineMs: 2000, calls: ['redis'] },
  'member-write': { deadlineMs: 5000, calls: ['geocoding', 'redis'] },
  'media-upload': { deadlineMs: 8000, calls: ['mediaImage', 'redis'] },
  checkout: { deadlineMs: 12000, calls: ['payments', 'redis'] },
  'admin-read': { deadlineMs: 5000, calls: ['redis'] },
  'admin-report': { deadlineMs: 28000, calls: ['redis'] },
  health: { deadlineMs: 1000, calls: [] },
})

/** The tightest route deadline, used to bound the database statement timeout. */
export const tightestDeadlineMs = () =>
  Math.min(...Object.values(ROUTE_BUDGETS).map((b) => b.deadlineMs))

/**
 * @throws if any route class violates the budget rule. Called from an onReady
 * hook, so a misconfiguration prevents boot.
 */
export function assertBudgets(requestTimeoutMs, budgets = ROUTE_BUDGETS, outbound = OUTBOUND) {
  const problems = []

  for (const [name, { deadlineMs, calls }] of Object.entries(budgets)) {
    for (const dep of calls) {
      if (!(dep in outbound)) {
        problems.push(`route class "${name}" calls unknown dependency "${dep}"`)
      }
    }
    const sum = calls.reduce((t, d) => t + (outbound[d] ?? 0), 0)
    if (sum >= deadlineMs) {
      problems.push(
        `route class "${name}": Σ outbound ${sum}ms >= deadline ${deadlineMs}ms ` +
          `(calls: ${calls.join(', ') || 'none'}) — the caller would give up before the server does`,
      )
    }
    if (deadlineMs >= requestTimeoutMs) {
      problems.push(
        `route class "${name}": deadline ${deadlineMs}ms >= requestTimeout ${requestTimeoutMs}ms`,
      )
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Budget assertion failed (FR-033):\n${problems.map((p) => `  ${p}`).join('\n')}`,
    )
  }
}

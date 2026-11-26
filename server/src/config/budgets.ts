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
export const OUTBOUND: Readonly<Record<string, number>> = Object.freeze({
  payments: 8000,
  // SMSGlobal has been seen taking ~4.2 s to accept a message; 5 s left no
  // room, and a send past it was refused while the SMS still went out.
  sms: 10000,
  mail: 10000,
  geocoding: 3000,
  redis: 250,
  mediaImage: 6000,
  // Video transcoding is a queued job, not an inbound-request dependency, so
  // it is deliberately absent from every route's `calls` list below.
  mediaVideoJob: 300000,
  // An embedding call plus a generation call, both made by PostgreSQL through
  // pgai rather than by Node. Still outbound budgets: the rule does not care
  // which process opens the socket, only that the caller does not give up
  // before the callee does.
  ragEmbed: 5000,
  ragGenerate: 20000,
  // Push providers are called only by the `push.deliver` and `push.receipts`
  // jobs (feature 011, research R7), never inside a request — which is why
  // neither appears in any route class's `calls` below. They are here so the
  // breakers have a declared timeout like every other dependency.
  pushExpo: 10000,
  pushFcm: 10000,
})

/**
 * Route classes: the handler deadline, and which dependencies a request of that
 * class may call *inline*.
 *
 * `mail` appears in only one list, `email-send`: an onboarding code is waited
 * for by somebody watching the screen, so it is sent inside the request and
 * the outbox is only its fallback. Invoice and notification mail is enqueued
 * (research R8's declared fallback), never sent inside the request —
 * checkout's budget could not otherwise accommodate both payments and mail.
 */
export const ROUTE_BUDGETS = Object.freeze({
  'public-page': { deadlineMs: 3000, calls: ['redis'] },
  sitemap: { deadlineMs: 10000, calls: ['redis'] },
  auth: { deadlineMs: 5000, calls: ['redis'] },
  // Every route that texts a code: register, contact, sign-in and resend.
  // 10250 (sms 10000 + redis 250) < 20000 < requestTimeout.
  'otp-send': { deadlineMs: 20000, calls: ['sms', 'redis'] },
  // 10250 (mail 10000 + redis 250) < 15000, the same rule 'otp-send' obeys.
  'email-send': { deadlineMs: 15000, calls: ['mail', 'redis'] },
  'member-read': { deadlineMs: 2000, calls: ['redis'] },
  'member-write': { deadlineMs: 5000, calls: ['geocoding', 'redis'] },
  // The deadline starts when the request's headers arrive, and a multipart body
  // is read INSIDE the handler (plugins/12-deadline.ts), so this covers the whole
  // upload — the time a phone takes to send the file — and not only the work
  // after it. At 8 s a member's photo (up to 25 MB, a few MB from a phone) on a
  // mobile uplink was answered 503 before it finished arriving, and the app's
  // listing photos, avatar and Threads media all "did not save". Merchants'
  // uploads only worked because they are held to 1 MiB.
  //
  // 25 s sits under the 30 s `requestTimeout` the rule above requires, which is
  // still the ceiling on a stalled client. 6 MB takes ~19 s at 2.5 Mbps and
  // ~10 s at 5 Mbps. Larger files on a slower link are refused by the same
  // timeout, on purpose: a bound that lets a connection sit open for minutes is
  // not a bound. Σ outbound (mediaImage 6000 + redis 250) is still far below it.
  'media-upload': { deadlineMs: 25000, calls: ['mediaImage', 'redis'] },
  checkout: { deadlineMs: 12000, calls: ['payments', 'redis'] },
  // The marketplace index joins the owner's status live rather than reading a
  // denormalised flag (008 research.md R7), so it is a read with one more join
  // than 'member-read' — not a different class of work.
  marketplace: { deadlineMs: 3000, calls: ['redis'] },
  // Messaging persists before it notifies, and the notification is a step
  // after commit rather than inside the transaction, so the request itself
  // waits only on the write.
  messaging: { deadlineMs: 3000, calls: ['redis'] },
  // Threads reads compute their counts live rather than trusting stored
  // counters (024_threads.sql), so a feed page is a read with a few indexed
  // subqueries per row — heavier than 'member-read', lighter than a report.
  threads: { deadlineMs: 3000, calls: ['redis'] },
  'admin-read': { deadlineMs: 5000, calls: ['redis'] },
  // Administrator edits (feature 028): one transaction over two small tables.
  'admin-write': { deadlineMs: 5000, calls: ['redis'] },
  'admin-report': { deadlineMs: 28000, calls: ['redis'] },
  // 25250 < 28000 < REQUEST_TIMEOUT_MS (30000). The margin is thin on purpose:
  // a model call is the slowest thing this server waits on, and the
  // alternative to a tight deadline is a public route that can hold a
  // connection open for the whole request timeout.
  rag: { deadlineMs: 28000, calls: ['ragEmbed', 'ragGenerate', 'redis'] },
  health: { deadlineMs: 1000, calls: [] },
})

/** The tightest route deadline, used to bound the database statement timeout. */
export const tightestDeadlineMs = () =>
  Math.min(...Object.values(ROUTE_BUDGETS).map((b) => b.deadlineMs))

/**
 * @throws if any route class violates the budget rule. Called from an onReady
 * hook, so a misconfiguration prevents boot.
 */
export function assertBudgets(
  requestTimeoutMs: number,
  budgets: Readonly<Record<string, { deadlineMs: number; calls: readonly string[] }>> = ROUTE_BUDGETS,
  outbound: Readonly<Record<string, number>> = OUTBOUND,
): void {
  const problems: string[] = []

  for (const [name, { deadlineMs, calls }] of Object.entries(budgets)) {
    for (const dep of calls) {
      if (!(dep in outbound)) {
        problems.push(`route class "${name}" calls unknown dependency "${dep}"`)
      }
    }
    const sum = calls.reduce((t: number, d: string) => t + (outbound[d] ?? 0), 0)
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

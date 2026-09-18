/**
 * The transactional counter primitive (FR-043).
 *
 * Every business quota in this codebase — the per-account stored-byte quota
 * here, and invitation quotas, coupon redemptions, event capacity and bulk-send
 * pacing in the features that follow — is built on this and on nothing else.
 *
 * Why not the rate limiter: a quota is a correctness property, not a traffic
 * shaping one. It must survive a Redis flush, be auditable after the fact, be
 * reportable to staff, and be exact under concurrency. The rate limiter offers
 * none of those. Conflating them is how a member exceeds their invitation quota
 * by racing two requests and how an event oversells its last seat.
 *
 * The whole mechanism is `SELECT ... FOR UPDATE` inside the caller's
 * transaction. Taking the row lock *before* reading `used` is the entire point:
 * it serialises concurrent reservations against the same subject, so two
 * requests cannot both read 9-of-10 and both decide they may proceed. It
 * follows that every reservation must run inside a transaction the caller also
 * uses for the work being reserved — otherwise the reservation commits and the
 * work does not, and the quota drifts upward until someone notices.
 */

/** Raised when a reservation would cross the ceiling. Carries the numbers. */
export class QuotaExceededError extends Error {
  constructor({ scope, subject, requested, used, limit }) {
    super(`Quota "${scope}" exceeded for ${subject}: ${used} + ${requested} > ${limit}`)
    this.name = 'QuotaExceededError'
    this.scope = scope
    this.subject = subject
    this.requested = requested
    this.used = used
    this.limit = limit
    this.remaining = Math.max(0, limit - used)
  }
}

const key = (scope, subject) => ({ scope: String(scope), subject: String(subject) })

/**
 * Read a counter without locking. For display only.
 *
 * Deliberately not usable as a check-then-act: by the time the caller acts the
 * value may have moved. Anything that gates on the number must call `reserve`.
 */
export async function read(client, scope, subject) {
  const k = key(scope, subject)
  const { rows } = await client.query(
    'SELECT used, limit_value, window_start, window_ends FROM counters WHERE scope = $1 AND subject = $2',
    [k.scope, k.subject],
  )
  if (rows.length === 0) return { used: 0, limit: null, remaining: null, exists: false }
  const row = rows[0]
  const limit = row.limit_value === null ? null : Number(row.limit_value)
  return {
    used: Number(row.used),
    limit,
    remaining: limit === null ? null : Math.max(0, limit - Number(row.used)),
    windowStart: row.window_start,
    windowEnds: row.window_ends,
    exists: true,
  }
}

/**
 * Configure a counter's ceiling, creating the row if needed.
 *
 * Lowering a limit below what is already used is allowed: staff reducing a
 * quota should not be blocked by history. The row then sits above its ceiling
 * until usage is released, and `reserve` refuses everything in the meantime,
 * which is the intended behaviour. The CHECK constraint is written to permit
 * exactly this, so it still catches a write that bypassed the helper.
 */
export async function configure(client, scope, subject, { limit = null, windowStart = null, windowEnds = null } = {}) {
  const k = key(scope, subject)
  const { rows } = await client.query(
    `INSERT INTO counters (scope, subject, used, limit_value, window_start, window_ends)
     VALUES ($1, $2, 0, $3, $4, $5)
     ON CONFLICT (scope, subject) DO UPDATE
       SET limit_value = EXCLUDED.limit_value,
           window_start = EXCLUDED.window_start,
           window_ends = EXCLUDED.window_ends,
           updated_at = now()
     RETURNING used, limit_value`,
    [k.scope, k.subject, limit, windowStart, windowEnds],
  )
  return { used: Number(rows[0].used), limit: rows[0].limit_value === null ? null : Number(rows[0].limit_value) }
}

/**
 * Reserve `amount` against a bounded counter, under a row lock, inside the
 * caller's transaction.
 *
 * @param client   a client already inside a transaction — NOT a pool. Passing a
 *                 pool would take the lock on one connection and do the work on
 *                 another, which defeats the entire mechanism.
 * @param defaultLimit applied when the row does not exist yet, so a caller does
 *                 not have to seed every subject before first use. `null` means
 *                 unbounded.
 * @throws {QuotaExceededError} when the reservation would cross the ceiling.
 * @returns {Promise<{used: number, limit: number|null, remaining: number|null}>} state AFTER the reservation
 */
export async function reserve(client, scope, subject, amount, { defaultLimit = null } = {}) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new TypeError(`reserve() needs a non-negative amount, got ${amount}`)
  }
  const k = key(scope, subject)

  // Create-if-absent and lock in one statement. `DO UPDATE` with a no-op write
  // rather than `DO NOTHING`: `DO NOTHING` returns no row on conflict, which
  // would leave the common path (the row already exists) unlocked.
  const { rows } = await client.query(
    `INSERT INTO counters (scope, subject, used, limit_value)
     VALUES ($1, $2, 0, $3)
     ON CONFLICT (scope, subject) DO UPDATE SET updated_at = counters.updated_at
     RETURNING used, limit_value`,
    [k.scope, k.subject, defaultLimit],
  )

  const used = Number(rows[0].used)
  const limit = rows[0].limit_value === null ? null : Number(rows[0].limit_value)

  if (limit !== null && used + amount > limit) {
    throw new QuotaExceededError({ scope: k.scope, subject: k.subject, requested: amount, used, limit })
  }

  const { rows: after } = await client.query(
    `UPDATE counters SET used = used + $3, updated_at = now()
      WHERE scope = $1 AND subject = $2
      RETURNING used, limit_value`,
    [k.scope, k.subject, amount],
  )

  const nowUsed = Number(after[0].used)
  return { used: nowUsed, limit, remaining: limit === null ? null : Math.max(0, limit - nowUsed) }
}

/**
 * Release `amount` back to a counter.
 *
 * Clamped at zero rather than allowed to go negative. A double release is a
 * bug, but one that must not leave a counter that hands out free capacity
 * forever — the CHECK would reject the write and fail the caller's transaction,
 * which turns a bookkeeping slip into a failed user action.
 */
export async function release(client, scope, subject, amount) {
  const k = key(scope, subject)
  const { rows } = await client.query(
    `UPDATE counters SET used = GREATEST(0, used - $3), updated_at = now()
      WHERE scope = $1 AND subject = $2
      RETURNING used, limit_value`,
    [k.scope, k.subject, amount],
  )
  if (rows.length === 0) return { used: 0, limit: null, remaining: null }
  const limit = rows[0].limit_value === null ? null : Number(rows[0].limit_value)
  const used = Number(rows[0].used)
  return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) }
}

/** Named scopes, so a typo is a missing export rather than a silent new counter. */
export const SCOPE = Object.freeze({
  STORED_BYTES: 'media.stored_bytes',
})

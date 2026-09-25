import { hostname } from 'node:os'
import { scrubText } from '../ops/scrub.ts'
import { fingerprintOf } from '../modules/server-faults/application/fingerprint.ts'
import type { Pool } from 'pg'
import type { GwcApp } from '../app.ts'

/**
 * `app.recordServerFault(fault)` — the one writer of `server_faults`
 * (feature 012, research R2–R4).
 *
 * Called by the error handler for every request it answers with the generic
 * INTERNAL problem, and never awaited there: the response is decided before
 * recording starts and cannot wait on it. Everything this does is therefore
 * about staying out of the way:
 *
 *  - **It takes an allowlisted shape**, never `request` or the error itself,
 *    so bodies, headers, cookies and query strings cannot reach a row by
 *    accident; the two free-text fields are scrubbed (ops/scrub.ts).
 *  - **It is bounded.** At most `perMinute` rows per minute, and at most
 *    MAX_IN_FLIGHT inserts at once. The pool is `max: 10` (db/pool.ts); if
 *    every failing request took a connection to record itself, a fault storm
 *    would starve the requests that still work. Past either cap a fault is
 *    counted, and the count is written once per minute.
 *  - **It never throws**, and never rejects. When the database is the cause,
 *    an insert waits out `connectionTimeoutMillis` and fails; the in-flight
 *    cap turns everything behind it into an in-memory increment, the error
 *    handler's own log line has already been written, and the metrics say
 *    how many records were lost.
 */

export type ServerFaultInput = {
  requestId: string
  clientRequestId: string | null
  method: string
  route: string | null
  status: number
  errorName: string
  errorCode: string | null
  message: string
  stack: string | null
  principalKind: string | null
  principalId: string | null
}

export type ServerFaultRow = ServerFaultInput & { fingerprint: string; instanceId: string }

type Metrics = { serverFaultStored(): void; serverFaultSuppressed(): void; serverFaultFailed(): void }

type RecorderOptions = {
  perMinute: number
  metrics: Metrics
  log: { warn(obj: object, msg: string): void }
  instanceId?: string
  clock?: () => number
  pool?: Pool
  /** Test seams. Default to the SQL below, against `pool`. */
  insert?: (row: ServerFaultRow) => Promise<void>
  insertSuppressions?: (minute: Date, count: number) => Promise<void>
}

export type ServerFaultRecorder = ((fault: ServerFaultInput) => Promise<void>) & {
  /** Write the pending suppression count now (the prune job's tick). */
  flushSuppressions(): Promise<void>
  /** Resolve once every insert started so far has settled. Tests and shutdown. */
  drain(): Promise<void>
}

/** Two of the pool's ten: a fault storm never takes more than a fifth. */
const MAX_IN_FLIGHT = 2
/** Well inside every route deadline; a slower insert is a failure, not a success. */
const STATEMENT_TIMEOUT_MS = 1000
const MESSAGE_MAX = 2000
const STACK_MAX = 8000
const NAME_MAX = 100
const ROUTE_MAX = 300

const MINUTE_MS = 60_000
/** Longer than one insert's statement timeout, far shorter than server.ts's 15 s hard exit. */
const SHUTDOWN_DRAIN_MS = 2000

function sqlInsert(pool: Pool) {
  return async (row: ServerFaultRow) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // SET LOCAL cannot take a bind parameter; the value is a constant.
      await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
      await client.query(
        `INSERT INTO server_faults
           (request_id, client_request_id, method, route, status, error_name, error_code,
            message, stack, principal_kind, principal_id, fingerprint, instance_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          row.requestId, row.clientRequestId, row.method, row.route, row.status, row.errorName,
          row.errorCode, row.message, row.stack, row.principalKind, row.principalId,
          row.fingerprint, row.instanceId,
        ],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }
}

function sqlInsertSuppressions(pool: Pool, instanceId: string) {
  // Additive on conflict: the (minute, instance) key is the deterministic
  // reference, so a retried flush adds to the minute instead of duplicating it.
  return async (minute: Date, count: number) => {
    await pool.query(
      `INSERT INTO server_fault_suppressions (minute, instance_id, suppressed)
       VALUES ($1, $2, $3)
       ON CONFLICT (minute, instance_id)
       DO UPDATE SET suppressed = server_fault_suppressions.suppressed + EXCLUDED.suppressed`,
      [minute, instanceId, count],
    )
  }
}

const clip = (value: string | null, max: number) => (value === null ? null : String(value).slice(0, max))

export function createServerFaultRecorder({
  perMinute, metrics, log, pool,
  instanceId = `${hostname()}:${process.pid}`.slice(0, 200),
  clock = Date.now,
  insert = pool ? sqlInsert(pool) : undefined,
  insertSuppressions = pool ? sqlInsertSuppressions(pool, instanceId) : undefined,
}: RecorderOptions): ServerFaultRecorder {
  if (!insert || !insertSuppressions) throw new Error('createServerFaultRecorder needs a pool or both insert functions')

  let windowMinute = Math.floor(clock() / MINUTE_MS)
  let storedThisMinute = 0
  let suppressedThisMinute = 0
  let inFlight = 0
  // Warn once per failure burst, not once per fault: a dead database would
  // otherwise double every fault's log volume at the worst possible time.
  let warnedMinute = -1
  const pending = new Set<Promise<void>>()

  const track = (work: Promise<void>) => {
    const settled = work.finally(() => pending.delete(settled))
    pending.add(settled)
    return settled
  }

  function takeSuppressed() {
    const count = suppressedThisMinute
    suppressedThisMinute = 0
    return { minute: new Date(windowMinute * MINUTE_MS), count }
  }

  function flush({ minute, count }: { minute: Date; count: number }) {
    if (count === 0) return Promise.resolve()
    return track(
      insertSuppressions!(minute, count).catch((err) => {
        metrics.serverFaultFailed()
        log.warn({ err, suppressed: count }, 'server fault suppression count could not be recorded')
      }),
    )
  }

  function rollWindow() {
    const minute = Math.floor(clock() / MINUTE_MS)
    if (minute === windowMinute) return
    void flush(takeSuppressed())
    windowMinute = minute
    storedThisMinute = 0
  }

  const record = ((fault: ServerFaultInput) => {
    try {
      rollWindow()
      if (storedThisMinute >= perMinute || inFlight >= MAX_IN_FLIGHT) {
        suppressedThisMinute += 1
        metrics.serverFaultSuppressed()
        return Promise.resolve()
      }
      storedThisMinute += 1
      inFlight += 1

      const errorName = clip(fault.errorName || 'Error', NAME_MAX)!
      const errorCode = clip(fault.errorCode, NAME_MAX)
      const route = clip(fault.route, ROUTE_MAX)
      const stack = fault.stack === null ? null : scrubText(fault.stack, STACK_MAX)
      const row: ServerFaultRow = {
        ...fault,
        route,
        errorName,
        errorCode,
        message: scrubText(fault.message ?? '', MESSAGE_MAX),
        stack,
        // Computed from the raw stack: the scrub can only remove detail the
        // fingerprint deliberately ignores anyway (line numbers stay out).
        fingerprint: fingerprintOf({ errorName, errorCode, method: fault.method, route, stack: fault.stack }),
        instanceId,
      }

      return track(
        insert!(row)
          .then(() => metrics.serverFaultStored())
          .catch((err) => {
            metrics.serverFaultFailed()
            if (warnedMinute !== windowMinute) {
              warnedMinute = windowMinute
              log.warn({ err, requestId: fault.requestId }, 'server fault could not be recorded')
            }
          })
          .finally(() => { inFlight -= 1 }),
      )
    } catch (err) {
      // Building the row failed (a pathological error object). Still never throw.
      metrics.serverFaultFailed()
      log.warn({ err }, 'server fault could not be recorded')
      return Promise.resolve()
    }
  }) as ServerFaultRecorder

  record.flushSuppressions = async () => {
    rollWindow()
    await flush(takeSuppressed())
  }
  record.drain = async () => {
    while (pending.size > 0) await Promise.allSettled([...pending])
  }
  return record
}

export function registerServerFaults(
  app: GwcApp,
  { perMinute, insert, clock }: { perMinute: number; insert?: RecorderOptions['insert']; clock?: () => number },
) {
  const recorder = createServerFaultRecorder({
    perMinute,
    clock,
    insert,
    // A test that injects `insert` still gets real suppression SQL only when
    // it asked for a real database; otherwise suppressions are just counted.
    insertSuppressions: insert ? async () => {} : undefined,
    pool: app.pg as Pool,
    metrics: app.metrics as Metrics,
    log: app.log,
  })
  app.decorate('recordServerFault', recorder)
  // preClose, not onClose: it runs before every onClose hook, including the
  // one that ends the pool, so in-flight records land instead of failing with
  // "Cannot use a pool after calling end". Bounded: an insert stuck on a dead
  // database must not hold shutdown hostage — those records are lost either way.
  app.addHook('preClose', async () => {
    let timer: NodeJS.Timeout | undefined
    const bound = new Promise<void>((resolve) => { timer = setTimeout(resolve, SHUTDOWN_DRAIN_MS) })
    await Promise.race([recorder.drain(), bound])
    clearTimeout(timer)
  })
}

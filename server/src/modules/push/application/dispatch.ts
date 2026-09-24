import { renderOfferPush, PUSH_PAYLOAD_VERSION } from '@gwc/contracts/push'
import { ELIGIBLE_DEVICE } from './audience.ts'
import { VISIBLE_OFFER, OFFER_JOINS } from '../../offers/application/offer.ts'
import { redactTokens } from '../providers.ts'
import type { PushProvider, PushTransport, MessageOutcome } from '../providers.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * The push outbox dispatcher (feature 011, research R1, R2).
 *
 * Runs only inside the `push.deliver` job — from its one-minute cron tick, or
 * from the pg-boss kick an accepted staff send triggers. Never from a request
 * handler: no route budget names a push provider, and a broadcast to 5,000
 * phones cannot finish inside any route's deadline.
 *
 * One run:
 *
 *  1. Fails deliveries stuck in `sending` past the lease as `outcome unknown`.
 *  2. Claims one due notification at a time under a lease
 *     (`FOR UPDATE SKIP LOCKED`), so a kick and a tick never work on the same
 *     one. Offer notifications are re-checked against `VISIBLE_OFFER` and
 *     cancelled if the offer is no longer visible (FR-023).
 *  3. On first claim, materialises the audience into `push_deliveries`
 *     through `ELIGIBLE_DEVICE`, once per (notification, device).
 *  4. Claims due `pending` deliveries in batches, moving them to `sending` in
 *     the same statement and re-checking eligibility (a member locked
 *     mid-broadcast is `skipped`).
 *  5. Sends each batch *outside* any transaction, one provider per call.
 *  6. Records each outcome from `sending` only, and finishes the notification
 *     once nothing is pending.
 *
 * **Offer notifications are delivered by the tick alone** (analysis D1). The
 * database trigger that queues them cannot reach pg-boss, so their latency is
 * up to one minute by design, and disabling `push.deliver` stops them exactly
 * as it stops staff sends. The sweep below does not filter on `kind`; that is
 * what includes them.
 */

/** Expo's per-request maximum, and the unit of pacing. */
export const BATCH_SIZE = 100
/**
 * The pause between batches (constitution V, bulk communication).
 *
 * One batch in flight at a time, then this pause: at most 100 messages per
 * second plus the provider's own latency. 5,000 devices take about a minute
 * (`bench:push` measured 58 s at 150 ms per call), well inside SC-002's ten,
 * without asking a provider to absorb the whole club in one burst. Raising the
 * pause is how to slow a broadcast down; the budget leaves room for ten times
 * this one.
 */
export const BATCH_PAUSE_MS = 1000
/** How long a claim on a notification, or a delivery in `sending`, is trusted. */
export const LEASE_MS = 5 * 60_000
/** After this many attempts a delivery is `failed` for good (research R6). */
export const MAX_ATTEMPTS = 5

/** 30 s, 1 min, 2 min, 4 min … — a provider outage is usually minutes, not seconds. */
export const backoffMs = (attempt: number) => 30_000 * 2 ** Math.max(0, attempt - 1)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Claimed = {
  id: string
  kind: 'rehearsal' | 'broadcast' | 'offer'
  status: string
  audience: string
  offer_id: string | null
  title_de: string | null
  body_de: string | null
  title_en: string | null
  body_en: string | null
  destination_type: string | null
  destination_id: string | null
}

export type DispatchOptions = {
  transport: PushTransport
  batchSize?: number
  pauseMs?: number
  /** Retry spacing; injectable so a suite need not wait 30 seconds. */
  backoff?: (attempt: number) => number
}

/**
 * Deliver everything that is due. Returns how many deliveries reached a
 * recorded outcome in this run, for `job_runs.items_processed`.
 */
export async function dispatchDue(
  app: GwcApp,
  { transport, batchSize = BATCH_SIZE, pauseMs = BATCH_PAUSE_MS, backoff = backoffMs }: DispatchOptions,
) {
  await failStaleSending(app)

  let processed = 0
  // One pass per notification per run. One whose retries are not yet due is
  // immediately claimable again, and without this it would be claimed forever
  // while the notifications queued behind it waited.
  const seen: string[] = []
  for (;;) {
    const notification = await claimNotification(app, seen)
    if (!notification) break
    seen.push(notification.id)
    processed += await dispatchOne(app, notification, { transport, batchSize, pauseMs, backoff })
  }
  return { itemsProcessed: processed }
}

/**
 * At most once per device (research R2, FR-028, SC-002).
 *
 * A delivery in `sending` was handed to the provider and its outcome never
 * saved — the process died, or the database went away, between the two. The
 * provider may well have accepted it. Sending it again would buzz that phone
 * twice; failing it means that member may miss one notification. The second is
 * the lesser harm, and it is never retried.
 */
async function failStaleSending(app: GwcApp) {
  await app.pg.query(
    `UPDATE push_deliveries
        SET status = 'failed', error_message = 'outcome unknown', updated_at = now()
      WHERE status = 'sending' AND updated_at < now() - make_interval(secs => $1)`,
    [LEASE_MS / 1000],
  )
}

async function claimNotification(app: GwcApp, exclude: readonly string[]): Promise<Claimed | null> {
  const { rows } = await app.pg.query(
    `UPDATE push_notifications n
        SET lease_until = now() + make_interval(secs => $1)
      WHERE n.id = (
              SELECT id FROM push_notifications
               WHERE status IN ('queued', 'sending')
                 AND not_before <= now()
                 AND (lease_until IS NULL OR lease_until < now())
                 AND NOT (id = ANY($2::uuid[]))
               ORDER BY not_before, created_at
               LIMIT 1
               FOR UPDATE SKIP LOCKED)
      RETURNING n.id, n.kind, n.status, n.audience, n.offer_id,
                n.title_de, n.body_de, n.title_en, n.body_en,
                n.destination_type, n.destination_id`,
    [LEASE_MS / 1000, exclude],
  )
  return (rows[0] as Claimed | undefined) ?? null
}

async function renewLease(app: GwcApp, id: string) {
  await app.pg.query(
    'UPDATE push_notifications SET lease_until = now() + make_interval(secs => $2) WHERE id = $1',
    [id, LEASE_MS / 1000],
  )
}

/**
 * Cancel an offer notification whose offer is no longer visible.
 *
 * Pending deliveries become `skipped`, so the history says what happened to
 * each device rather than leaving rows nobody will ever send.
 */
async function cancel(app: GwcApp, id: string, reason: string) {
  const client = await app.pg.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE push_deliveries SET status = 'skipped', error_message = $2, updated_at = now()
        WHERE notification_id = $1 AND status = 'pending'`,
      [id, reason],
    )
    await client.query(
      `UPDATE push_notifications
          SET status = 'cancelled', finished_at = now(), lease_until = NULL
        WHERE id = $1 AND status IN ('queued', 'sending')`,
      [id],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function dispatchOne(
  app: GwcApp,
  notification: Claimed,
  { transport, batchSize, pauseMs, backoff }: Required<DispatchOptions>,
) {
  let n = notification

  if (n.kind === 'offer') {
    const { rows } = await app.pg.query(
      `SELECT o.title, op.display_name
         FROM offers o
         ${OFFER_JOINS}
        WHERE o.id = $1 AND ${VISIBLE_OFFER}`,
      [n.offer_id],
    )
    const offer = rows[0]
    if (!offer) {
      await cancel(app, n.id, 'offer no longer visible')
      return 0
    }
    // Rendered at dispatch, not at publication: an offer renamed between
    // publishing and `valid_from` goes out under its current name.
    if (n.title_de === null) {
      const text = renderOfferPush({ merchant: String(offer.display_name), title: String(offer.title) })
      const { rows: rendered } = await app.pg.query(
        `UPDATE push_notifications
            SET title_de = $2, body_de = $3, title_en = $4, body_en = $5
          WHERE id = $1
          RETURNING title_de, body_de, title_en, body_en`,
        [n.id, text.de.title, text.de.body, text.en.title, text.en.body],
      )
      n = { ...n, ...rendered[0] }
    }
  }

  if (n.status === 'queued') await materialise(app, n)

  const data = (locale: 'de' | 'en') => ({
    title: String(locale === 'en' ? n.title_en : n.title_de),
    body: String(locale === 'en' ? n.body_en : n.body_de),
  })
  // Every value a string; no member data, token or price (contracts/push-payload.md).
  const payload = {
    v: PUSH_PAYLOAD_VERSION,
    nid: n.id,
    type: n.destination_type ?? (n.kind === 'offer' ? 'offer' : 'none'),
    id: n.destination_id ?? (n.kind === 'offer' ? String(n.offer_id) : ''),
  }

  let processed = 0
  let first = true
  // A delivery is tried at most once per run. One the provider refused goes
  // back to `pending`, and without this a short backoff would have it
  // re-claimed straight away — five attempts spent in one run, against one
  // outage, before the provider had a chance to recover.
  const attempted: string[] = []
  for (;;) {
    const batch = await claimBatch(app, n, batchSize, attempted)
    if (batch.length === 0) break
    attempted.push(...batch.map((row) => row.id))
    if (!first && pauseMs > 0) await sleep(pauseMs)
    first = false

    const toSend = batch.filter((row) => row.status === 'sending')
    const outcomes = new Map<string, MessageOutcome>()
    for (const provider of ['expo', 'fcm'] as const satisfies readonly PushProvider[]) {
      // FR-026: a batch goes to exactly one provider, chosen by the device row.
      const rows = toSend.filter((row) => row.provider === provider)
      if (rows.length === 0) continue
      let results: MessageOutcome[]
      try {
        results = await transport.send(
          provider,
          rows.map((row) => ({ token: row.token, ...data(row.locale), data: payload })),
        )
      } catch (err) {
        // A transport is not supposed to throw. If one does, the batch may or
        // may not have gone out, which is exactly `unknown`: never resent.
        results = rows.map(() => ({ status: 'unknown', error: err instanceof Error ? err.message : String(err) }))
      }
      rows.forEach((row, index) => {
        const outcome = results[index] ?? { status: 'unknown', error: 'no outcome returned' }
        // Provider text can quote the token; it is stripped here as well as
        // in providers.ts, because the history must never hold one (FR-029).
        outcomes.set(row.id, outcome.status === 'sent' ? outcome : { ...outcome, error: redactTokens(outcome.error, [row.token]) })
      })
    }

    processed += await recordOutcomes(app, outcomes, backoff)
    processed += batch.length - toSend.length
    await renewLease(app, n.id)

    // An open breaker ran nothing. Leave the rest for the next tick rather
    // than cycling every remaining batch through a refusal.
    if ([...outcomes.values()].some((o) => o.status === 'retry' && o.notAttempted)) break
  }

  await finishIfDone(app, n.id)
  return processed
}

/**
 * Write the audience into `push_deliveries`, and move `queued → sending`, in
 * one transaction. Once only: a device that registers after this point does not
 * get a notification that has already started, and a phone that signed out and
 * back in (a new device row, the same token) is not added a second time.
 */
async function materialise(app: GwcApp, n: Claimed) {
  const client = await app.pg.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO push_deliveries (notification_id, device_id, member_id, provider, platform, locale)
       SELECT n.id, d.id, d.member_id, d.provider, d.platform, d.locale
         FROM push_devices d
        CROSS JOIN (SELECT $1::uuid AS id, $2::text AS audience) n
        WHERE ${ELIGIBLE_DEVICE}
       ON CONFLICT (notification_id, device_id) DO NOTHING`,
      [n.id, n.audience],
    )
    await client.query(
      `UPDATE push_notifications SET status = 'sending' WHERE id = $1 AND status = 'queued'`,
      [n.id],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

type BatchRow = {
  id: string
  status: 'sending' | 'skipped'
  token: string
  provider: PushProvider
  locale: 'de' | 'en'
}

/**
 * Claim up to `size` due deliveries and move them to `sending` — or `skipped`,
 * when the device is no longer eligible — in the same statement.
 *
 * The same statement is the point: there is no moment at which a row has been
 * chosen for sending but still reads `pending`, so a second dispatcher cannot
 * choose it too, and a crash leaves it in `sending`, where the stale sweep
 * fails it rather than resending.
 */
async function claimBatch(app: GwcApp, n: Claimed, size: number, exclude: readonly string[]): Promise<BatchRow[]> {
  const { rows } = await app.pg.query(
    `UPDATE push_deliveries dl
        SET status = CASE WHEN e.eligible THEN 'sending' ELSE 'skipped' END::push_delivery_status,
            error_message = CASE WHEN e.eligible THEN dl.error_message ELSE 'no longer eligible' END,
            locale = COALESCE(e.locale, dl.locale),
            updated_at = now()
       FROM (
              SELECT dl2.id, d.token, d.locale, d.provider,
                     COALESCE(d.id IS NOT NULL AND ${ELIGIBLE_DEVICE}, false) AS eligible
                FROM push_deliveries dl2
                LEFT JOIN push_devices d ON d.id = dl2.device_id
               CROSS JOIN (SELECT $3::text AS audience) n
               WHERE dl2.notification_id = $1
                 AND dl2.status = 'pending'
                 AND dl2.next_attempt_at <= now()
                 AND NOT (dl2.id = ANY($4::uuid[]))
               ORDER BY dl2.next_attempt_at, dl2.id
               LIMIT $2
               FOR UPDATE OF dl2 SKIP LOCKED
            ) e
      WHERE dl.id = e.id
      RETURNING dl.id, dl.status, e.token, e.provider, COALESCE(e.locale, dl.locale, 'de') AS locale`,
    [n.id, size, n.audience, exclude],
  )
  return rows as BatchRow[]
}

/**
 * Record each outcome, from `sending` only.
 *
 * `retry` is the one outcome that returns a row to `pending`, because it is the
 * one that proves the provider did not accept the message. `unknown` becomes
 * `failed` and stays there (research R2).
 */
async function recordOutcomes(
  app: GwcApp,
  outcomes: Map<string, MessageOutcome>,
  backoff: (attempt: number) => number,
) {
  if (outcomes.size === 0) return 0
  const ids: string[] = []
  const kinds: string[] = []
  const refs: (string | null)[] = []
  const errors: (string | null)[] = []
  const counted: boolean[] = []
  const dead: string[] = []

  for (const [id, outcome] of outcomes) {
    ids.push(id)
    kinds.push(outcome.status)
    refs.push(outcome.status === 'sent' ? outcome.providerRef : null)
    errors.push(
      outcome.status === 'sent' ? null
        : outcome.status === 'unknown' ? `outcome unknown: ${outcome.error}`.slice(0, 500)
          : outcome.error.slice(0, 500),
    )
    const notAttempted = outcome.status === 'retry' && outcome.notAttempted === true
    counted.push(!notAttempted)
    if (outcome.status === 'failed' && outcome.permanent) dead.push(id)
  }

  const { rows } = await app.pg.query(
    `UPDATE push_deliveries dl
        SET attempts = dl.attempts + CASE WHEN o.counted THEN 1 ELSE 0 END,
            status = CASE
                       WHEN o.kind = 'sent' THEN 'sent'
                       WHEN o.kind = 'retry' AND dl.attempts + CASE WHEN o.counted THEN 1 ELSE 0 END < $6
                         THEN 'pending'
                       ELSE 'failed'
                     END::push_delivery_status,
            provider_ref = o.ref,
            error_message = CASE
                              WHEN o.kind = 'retry' AND dl.attempts + 1 >= $6 AND o.counted
                                THEN left('gave up after ' || $6 || ' attempts: ' || o.error, 500)
                              ELSE o.error
                            END,
            updated_at = now()
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::boolean[])
            AS o(id, kind, ref, error, counted)
      WHERE dl.id = o.id AND dl.status = 'sending'
      RETURNING dl.id, dl.status, dl.attempts`,
    [ids, kinds, refs, errors, counted, MAX_ATTEMPTS],
  )

  // Backoff depends on the attempt count just written, so it is set per row
  // afterwards rather than guessed before.
  const retrying = rows.filter((r) => r.status === 'pending')
  if (retrying.length > 0) {
    await app.pg.query(
      `UPDATE push_deliveries dl
          SET next_attempt_at = now() + make_interval(secs => r.delay)
         FROM unnest($1::uuid[], $2::float8[]) AS r(id, delay)
        WHERE dl.id = r.id AND dl.status = 'pending'`,
      [retrying.map((r) => r.id), retrying.map((r) => backoff(Number(r.attempts)) / 1000)],
    )
  }

  // A dead token (research R6, FR-027). The device stays, so the member's
  // choices survive; re-registering from the app clears the reason.
  if (dead.length > 0) {
    await app.pg.query(
      `UPDATE push_devices SET disabled_reason = 'unregistered', updated_at = now()
        WHERE id IN (SELECT device_id FROM push_deliveries WHERE id = ANY($1::uuid[]) AND device_id IS NOT NULL)`,
      [dead],
    )
  }

  if (rows.some((r) => r.status === 'sent')) {
    await app.pg.query(
      `UPDATE push_notifications SET sent_at = COALESCE(sent_at, now())
        WHERE id = (SELECT notification_id FROM push_deliveries WHERE id = $1)`,
      [rows.find((r) => r.status === 'sent')?.id],
    )
  }

  return rows.filter((r) => r.status !== 'pending').length
}

/**
 * Finish once nothing is pending or in flight: `done` with no failures,
 * `failed` when devices existed and none were reached, `partial` otherwise. An
 * audience of zero is `done` — nothing was owed, nothing failed.
 */
async function finishIfDone(app: GwcApp, id: string) {
  await app.pg.query(
    `WITH t AS (
       SELECT count(*) FILTER (WHERE status IN ('pending', 'sending'))            AS open,
              count(*) FILTER (WHERE status IN ('sent', 'delivered'))             AS ok,
              count(*) FILTER (WHERE status = 'failed')                           AS failed,
              count(*) FILTER (WHERE status IN ('sent', 'delivered') AND provider = 'expo') AS expo_ok,
              count(*) FILTER (WHERE status = 'failed' AND provider = 'expo')     AS expo_failed,
              count(*) FILTER (WHERE status IN ('sent', 'delivered') AND provider = 'fcm')  AS fcm_ok,
              count(*) FILTER (WHERE status = 'failed' AND provider = 'fcm')      AS fcm_failed
         FROM push_deliveries WHERE notification_id = $1
     )
     UPDATE push_notifications n
        SET status = CASE
                       WHEN t.failed = 0 THEN 'done'
                       WHEN t.ok = 0 THEN 'failed'
                       ELSE 'partial'
                     END::push_status,
            finished_at = now(),
            lease_until = NULL,
            total_success = t.ok, total_failure = t.failed,
            expo_success = t.expo_ok, expo_failure = t.expo_failed,
            fcm_success = t.fcm_ok, fcm_failure = t.fcm_failed
       FROM t
      WHERE n.id = $1 AND n.status = 'sending' AND t.open = 0`,
    [id],
  )
  // Not finished (retries not yet due): let the next run claim it straight away.
  await app.pg.query(
    `UPDATE push_notifications SET lease_until = NULL WHERE id = $1 AND status IN ('queued', 'sending')`,
    [id],
  )
}

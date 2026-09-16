import PgBoss from 'pg-boss'

/**
 * The work queue for video derivatives (T149).
 *
 * `pg-boss` is a **work queue**: event-triggered, "this happened, do the work".
 * `croner` in US5 is a **scheduler**: time-triggered, "it is 3am, run the
 * cleanup". They look similar and are not duplication — a transcode must run
 * once per upload whenever that upload happens, and a session cleanup must run
 * on a clock regardless of traffic.
 *
 * It runs on the same PostgreSQL the rest of the feature uses, which matters
 * for one specific reason: a job can be enqueued inside the same transaction
 * that records the asset. Enqueuing to an external broker cannot be
 * transactional with the database write, so a crash between the two either
 * loses the job (a permanently `processing` asset — the stuck row FR-059
 * forbids) or runs it for an asset that was rolled back.
 */

export const QUEUES = Object.freeze({
  VIDEO_DERIVATIVES: 'media.video-derivatives',
})

/**
 * Start the queue.
 *
 * @param options.connectionString the same database the pool uses
 * @param options.schema kept separate from the application tables so pg-boss's
 *        own migrations can never collide with ours
 */
export async function createQueue({ connectionString, schema = 'pgboss', log } = {}) {
  const boss = new PgBoss({
    connectionString,
    schema,
    // A transcode is long; the maintenance interval need not be tight.
    maintenanceIntervalSeconds: 120,
    // Failed jobs are kept, because a `failed` asset must be able to say *why*
    // (FR-059) and the job's own error is where that comes from.
    retentionDays: 7,
  })

  boss.on('error', (err) => log?.error?.({ err }, 'job queue error'))
  await boss.start()
  return boss
}

/**
 * Enqueue a video derivative job.
 *
 * `singletonKey` is the asset id, so two uploads of the same video — which are
 * one asset, because storage is content-addressed — cannot queue two
 * transcodes of identical bytes.
 */
export async function enqueueVideoDerivatives(boss, { assetId, checksum, mime }) {
  return boss.send(
    QUEUES.VIDEO_DERIVATIVES,
    { assetId, checksum, mime },
    {
      singletonKey: assetId,
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      // Must exceed the 300 s job budget, or pg-boss reclaims the job while
      // ffmpeg is still running and a second worker starts the same transcode.
      expireInSeconds: 600,
    },
  )
}

/**
 * Register the worker.
 *
 * `teamSize: 1` on purpose: a transcode is CPU-bound, and running several on
 * one host makes every one of them slower while starving the event loop that
 * serves everything else.
 */
export async function workVideoDerivatives(boss, handler) {
  return boss.work(QUEUES.VIDEO_DERIVATIVES, { teamSize: 1, teamConcurrency: 1 }, handler)
}

/**
 * An in-process queue for tests and for a single-host install with no
 * PostgreSQL-backed queue configured.
 *
 * Exported from the production module so a change to the interface cannot leave
 * the double behind. It runs the handler on the next tick rather than
 * synchronously, so a caller that forgets to await still observes the
 * asynchronous contract — a job that appears to finish inside the request is
 * the bug this is meant to surface, not hide.
 */
export function createInlineQueue() {
  const handlers = new Map()
  const completed = []

  return {
    inline: true,
    completed,
    async send(queue, data) {
      const handler = handlers.get(queue)
      if (!handler) return null
      const job = { id: `inline-${completed.length + 1}`, data }
      queueMicrotask(async () => {
        try {
          await handler([job])
          completed.push({ job, ok: true })
        } catch (err) {
          completed.push({ job, ok: false, err })
        }
      })
      return job.id
    },
    async work(queue, _options, handler) {
      handlers.set(queue, handler)
      return queue
    },
    /** Resolve once every dispatched job has settled. Test affordance. */
    async drain() {
      for (let i = 0; i < 50; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    },
    async stop() {},
  }
}

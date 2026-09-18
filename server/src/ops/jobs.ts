import fp from 'fastify-plugin'
import { Cron } from 'croner'
import { query } from '../db/query.ts'

/**
 * Scheduled jobs (FR-051, §11).
 *
 * `croner` is a **scheduler**: time-triggered, "it is 3am, run the cleanup".
 * `pg-boss` in modules/media/queue.js is a **work queue**: event-triggered, "this
 * upload happened, transcode it". They look similar and are not duplication —
 * a transcode must run once per upload whenever that happens, and a session
 * cleanup must run on a clock regardless of traffic.
 *
 * Two rules make the run log trustworthy:
 *
 *  - The run row is written when the job **starts**. If the process dies
 *    mid-run, `finished_at` stays NULL and the crash is visible. Writing the
 *    row at the end instead means a crashed job leaves no trace at all, which
 *    reads exactly like a job that was never scheduled.
 *  - `enabled` is read from the database on **every tick**, not at startup. §11
 *    requires staff to be able to stop a misbehaving job; a flag read once at
 *    boot would need a deploy to take effect, which is the thing being avoided.
 */

/** The platform jobs. Feature jobs register against the same table later. */
export const PLATFORM_JOBS = Object.freeze([
  {
    name: 'sessions.expire',
    schedule: '*/15 * * * *',
    description: 'Revoke sessions whose refresh lineage has expired',
  },
  {
    name: 'sessions.prune-orphans',
    schedule: '0 4 * * *',
    // `sessions.account_id` is polymorphic with no foreign key — a member can
    // be removed and leave a session behind, and nothing in the schema
    // prevents it. That is precisely why this sweep has to exist.
    description: 'Remove sessions whose account no longer exists',
  },
  {
    name: 'otp.cleanup',
    schedule: '*/10 * * * *',
    description: 'Delete consumed and expired OTP challenges',
  },
  {
    name: 'denylist.prune',
    schedule: '*/30 * * * *',
    description: 'Drop denylist entries past the access-token lifetime',
  },
  {
    name: 'sitemap.invalidate',
    schedule: '0 * * * *',
    description: 'Drop the cached sitemap so lastmod stays truthful',
  },
  {
    name: 'push.prune-devices',
    schedule: '0 5 * * *',
    description: 'Remove push devices unseen for 180 days',
  },
])

/** The work each job does. Separated from the schedule so both stay readable. */
export function createJobHandlers(app) {
  return {
    'sessions.expire': async () => {
      const { rowCount } = await app.pg.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'expired'
          WHERE revoked_at IS NULL
            AND id IN (SELECT session_id FROM refresh_tokens
                        WHERE expires_at < now() AND consumed_at IS NULL)`,
      )
      return { itemsProcessed: rowCount }
    },

    'sessions.prune-orphans': async () => {
      const { rowCount } = await app.pg.query(
        `DELETE FROM sessions s
          WHERE (s.account_kind = 'member' AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = s.account_id))
             OR (s.account_kind = 'admin'  AND NOT EXISTS (SELECT 1 FROM admin_users a WHERE a.id = s.account_id))`,
      )
      return { itemsProcessed: rowCount }
    },

    'otp.cleanup': async () => {
      const { rowCount } = await app.pg.query(
        `DELETE FROM otp_challenges WHERE consumed_at IS NOT NULL OR expires_at < now() - interval '1 hour'`,
      )
      return { itemsProcessed: rowCount }
    },

    'denylist.prune': async () => {
      // Redis expires its own keys through SETEX, so this only matters for the
      // in-memory fallback used when REDIS_URL is unset.
      const pruned = await app.denylist?.prune?.()
      return { itemsProcessed: pruned ?? 0 }
    },

    'sitemap.invalidate': async () => {
      app.invalidateSitemap?.()
      return { itemsProcessed: 1 }
    },

    'push.prune-devices': async () => {
      // A token unseen for six months belongs to an app that was uninstalled or
      // a token that rotated. Keeping it means every broadcast pays for a
      // guaranteed failure and the failure counts pollute the history.
      const { rowCount } = await app.pg.query(
        `DELETE FROM push_devices WHERE last_seen_at < now() - interval '180 days'`,
      )
      return { itemsProcessed: rowCount }
    },
  }
}

export default fp(
  async function jobs(app, opts = {}) {
    const handlers = { ...createJobHandlers(app), ...(opts.handlers ?? {}) }
    const definitions = opts.jobs ?? PLATFORM_JOBS
    const scheduled = []

    /** Register the definitions, leaving `enabled` alone if a row exists. */
    async function seedDefinitions() {
      for (const job of definitions) {
        await app.pg.query(
          `INSERT INTO job_definitions (name, schedule, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (name) DO UPDATE
             SET schedule = EXCLUDED.schedule,
                 description = EXCLUDED.description,
                 updated_at = now()`,
          [job.name, job.schedule, job.description ?? null],
        )
      }
    }

    /**
     * Run one job, logging start and finish.
     *
     * Exported through the decorator so an operator — or a test — can trigger a
     * job without waiting for its cron tick.
     */
    async function runJob(name) {
      const { rows: defs } = await app.pg.query(
        'SELECT enabled FROM job_definitions WHERE name = $1',
        [name],
      )

      // Checked on every tick, not at startup: a flag read once at boot would
      // need a deploy to take effect.
      if (defs.length === 0 || defs[0].enabled !== true) {
        app.log.debug({ job: name }, 'job is disabled; skipping')
        return { outcome: 'skipped' }
      }

      const { rows: started } = await app.pg.query(
        'INSERT INTO job_runs (job_name) VALUES ($1) RETURNING id',
        [name],
      )
      const runId = started[0].id

      try {
        const result = (await handlers[name]?.()) ?? {}
        await app.pg.query(
          `UPDATE job_runs SET finished_at = now(), outcome = 'success', items_processed = $2 WHERE id = $1`,
          [runId, result.itemsProcessed ?? null],
        )
        await app.pg.query('UPDATE job_definitions SET last_run_at = now() WHERE name = $1', [name])
        app.log.info({ job: name, itemsProcessed: result.itemsProcessed ?? 0 }, 'job finished')
        return { outcome: 'success', ...result }
      } catch (err) {
        // A failed run is recorded as failed, with its reason. The alternative
        // — letting the throw escape — leaves the row unfinished and
        // indistinguishable from a crash.
        await app.pg.query(
          `UPDATE job_runs SET finished_at = now(), outcome = 'failure', error = $2 WHERE id = $1`,
          [runId, String(err?.message ?? err).slice(0, 500)],
        )
        app.log.error({ err, job: name }, 'job failed')
        app.metrics?.jobFailure?.(name)
        return { outcome: 'failure', error: err.message }
      }
    }

    app.decorate('runJob', runJob)
    app.decorate('jobDefinitions', () => definitions)

    /** Query helper for the staff console and for readiness. */
    app.decorate('recentJobRuns', async ({ limit = 50, jobName = null } = {}) => {
      const { rows } = await query(
        app.pg,
        `SELECT id, job_name, started_at, finished_at, outcome, error, items_processed
           FROM job_runs
          WHERE ($1::text IS NULL OR job_name = $1)
          ORDER BY started_at DESC
          LIMIT $2`,
        [jobName, limit],
      )
      return rows
    })

    // Scheduling is skipped in tests and wherever it is explicitly disabled:
    // a suite that boots the app should not start firing cron ticks at a
    // database other tests are using.
    if (opts.schedule === false || app.env.isTest) {
      app.addHook('onReady', seedDefinitions)
      return
    }

    app.addHook('onReady', async () => {
      await seedDefinitions()
      for (const job of definitions) {
        scheduled.push(
          new Cron(job.schedule, { name: job.name, protect: true }, () => runJob(job.name)),
        )
      }
      app.log.info({ jobs: definitions.length }, 'scheduled jobs registered')
    })

    app.addHook('onClose', async () => {
      for (const task of scheduled) task.stop()
    })
  },
  { name: 'jobs', dependencies: ['db'] },
)

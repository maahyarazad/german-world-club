import fp from 'fastify-plugin'
import type { GwcApp } from '../../app.ts'

/**
 * The `push.dispatch` pg-boss worker (feature 011, research R1, analysis D1).
 *
 * Its **only** action is `app.runJob('push.deliver')`. It must not call
 * `dispatchDue` itself, because going through the job runner is what makes:
 *
 *   - disabling `push.deliver` in `job_definitions` stop every send path —
 *     staff would otherwise have a kill switch that stops the cron tick and
 *     leaves the kick sending
 *   - every kick land in `job_runs` with its start, end and outcome
 *   - there be exactly one dispatch code path
 *
 * A kick and a tick can overlap. The notification lease and
 * `FOR UPDATE SKIP LOCKED` in dispatch.ts keep them off each other's rows, and
 * croner's `protect: true` keeps two ticks from overlapping.
 */
export const PUSH_DISPATCH_QUEUE = 'push.dispatch'

export default fp(
  async function pushWorker(app: GwcApp) {
    const queue = app.boss
    if (!queue) return
    await queue.work(PUSH_DISPATCH_QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
      await app.runJob('push.deliver')
    })
  },
  { name: 'push-worker', dependencies: ['jobs'] },
)

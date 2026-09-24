import { loadEnv } from '../config/env.ts'
import { createPool } from '../db/pool.ts'
import { loadFeed } from '../modules/threads/application/threads.ts'
import { loadActivity, unreadCount } from '../modules/threads/application/activity.ts'
import type { GwcApp } from '../app.ts'

/**
 * p95 of the Threads hot paths against whatever database DATABASE_URL names
 * (010 SC-006: first feed page ≤ 300 ms; Activity ≤ 150 ms). Runs the real
 * application functions — not copies of their SQL — so a change to the query
 * is measured by the next run. Read-only; seed with `seed:perf` first.
 */
const RUNS = Number(process.env.BENCH_RUNS ?? 40)
const pool = createPool(loadEnv())
// The read paths touch only `app.pg`; nothing here writes or audits.
const app = { pg: pool } as unknown as GwcApp

const p95 = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!

try {
  const { rows } = await pool.query(
    `SELECT id FROM members WHERE email LIKE '%@perf.demo.invalid' ORDER BY random() LIMIT $1`,
    [RUNS],
  )
  if (rows.length === 0) {
    console.error('bench:feed: no perf members — run `npm run -w server seed:perf` first.')
    process.exit(1)
  }
  const viewers = rows.map((r) => String(r.id))
  const measure = async (name: string, budget: number, fn: (viewerId: string) => Promise<unknown>) => {
    await fn(viewers[0]!) // warm the plan cache
    const samples: number[] = []
    for (const viewerId of viewers) {
      const t0 = performance.now()
      await fn(viewerId)
      samples.push(performance.now() - t0)
    }
    const value = p95(samples)
    console.log(`${name.padEnd(22)} p95 ${value.toFixed(1).padStart(7)} ms   budget ${budget} ms   ${value <= budget ? 'OK' : 'OVER'}`)
    return value <= budget
  }
  const ok = [
    await measure('feed (following)', 300, (viewerId) => loadFeed(app, { viewerId, scope: 'following', cursor: null })),
    await measure('feed (for you)', 300, (viewerId) => loadFeed(app, { viewerId, scope: 'all', cursor: null })),
    await measure('activity', 150, (viewerId) => loadActivity(app, { viewerId })),
    await measure('activity unread', 150, (viewerId) => unreadCount(app, { viewerId })),
  ].every(Boolean)
  process.exitCode = ok ? 0 : 1
} finally {
  await pool.end()
}

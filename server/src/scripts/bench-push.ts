/**
 * SC-002 load check: one broadcast to every perf member's phone, through the
 * real outbox, timed against the ten-minute budget (feature 011, T079).
 *
 * Runs the application's own `enqueueNotification` and `dispatchDue` — not
 * copies of their SQL — with a stub transport that only waits, so what is
 * measured is the outbox itself: materialisation, claiming, pacing, recording.
 *
 * Development only, refused before `loadEnv()` like `seed:perf`: it writes
 * devices and a notification, and must never run against a shared database.
 *
 *   npm run -w server seed:perf
 *   npm run -w server bench:push              # default 150 ms per provider call
 *   npm run -w server bench:push -- --latency 300
 */
if (process.env.NODE_ENV !== 'development') {
  console.error(
    `refusing to run: NODE_ENV is ${JSON.stringify(process.env.NODE_ENV ?? '')}, not "development".\n` +
      'bench:push registers synthetic devices and queues a broadcast, and must never touch a shared database.',
  )
  process.exit(1)
}

const { randomUUID } = await import('node:crypto')
const { loadEnv } = await import('../config/env.ts')
const { createPool } = await import('../db/pool.ts')
const { enqueueNotification } = await import('../modules/push/application/enqueue.ts')
const { dispatchDue, BATCH_SIZE, BATCH_PAUSE_MS } = await import('../modules/push/application/dispatch.ts')
type GwcApp = import('../app.ts').GwcApp
type PushTransport = import('../modules/push/providers.ts').PushTransport

const BUDGET_MS = 10 * 60_000
const flag = process.argv.indexOf('--latency')
const latencyMs = flag > -1 ? Number(process.argv[flag + 1]) : 150
if (!Number.isFinite(latencyMs) || latencyMs < 0) {
  console.error('bench:push: --latency must be a number of milliseconds')
  process.exit(1)
}

const pool = createPool(loadEnv())
const TOKEN_PREFIX = 'bench:'

let batches = 0
const transport: PushTransport = {
  async send(_provider, messages) {
    batches += 1
    await new Promise((resolve) => setTimeout(resolve, latencyMs))
    return messages.map(() => ({ status: 'sent', providerRef: null }))
  },
  async receipts() { return {} },
}

/**
 * Just enough of the app for the two functions under test. The audit writer
 * is a no-op on purpose: the audit log is append-only, and this script deletes
 * the notification it queues — an entry for it would be permanent fiction.
 */
const app = {
  pg: pool,
  audit: async () => {},
  boss: { send: async () => null, work: async () => null },
  log: { warn: console.warn, info: () => {}, error: console.error },
} as unknown as GwcApp

let notificationId: string | null = null
try {
  // A running dev server's own push.deliver tick could claim the bench's
  // notification and send it through a real transport. Refuse rather than race.
  const { rows: recent } = await pool.query(
    `SELECT count(*)::int AS n FROM job_runs WHERE job_name = 'push.deliver' AND started_at > now() - interval '2 minutes'`,
  )
  if (recent[0].n > 0) {
    console.error('bench:push: push.deliver ran in the last two minutes — stop the dev server first.')
    process.exit(1)
  }

  const { rows: admins } = await pool.query(`SELECT id FROM admin_users ORDER BY created_at LIMIT 1`)
  if (admins.length === 0) {
    console.error('bench:push: no staff account to send as — run `npm run -w server seed:dev` first.')
    process.exit(1)
  }

  const { rowCount: registered } = await pool.query(
    `INSERT INTO push_devices (member_id, token, provider, platform, locale)
     SELECT id, $1 || id::text, 'expo', 'android', 'de'
       FROM members WHERE email LIKE '%@perf.demo.invalid' AND status = 'active'
     ON CONFLICT (token) DO NOTHING`,
    [TOKEN_PREFIX],
  )
  if (!registered) {
    console.error('bench:push: no perf members — run `npm run -w server seed:perf` first.')
    process.exit(1)
  }

  const { notification } = await enqueueNotification(app, {
    kind: 'broadcast',
    clientRef: randomUUID(),
    de: { title: 'Lasttest', body: 'bench:push' },
    en: { title: 'Load test', body: 'bench:push' },
    principal: { id: String(admins[0].id), kind: 'admin' },
    requestId: 'bench-push',
  })
  notificationId = notification.id

  const started = performance.now()
  for (;;) {
    await dispatchDue(app, { transport })
    const { rows } = await pool.query('SELECT status FROM push_notifications WHERE id = $1', [notificationId])
    if (['done', 'partial', 'failed', 'cancelled'].includes(rows[0].status)) break
  }
  const durationMs = performance.now() - started

  const { rows: [stats] } = await pool.query(
    `SELECT count(*)::int AS deliveries, count(DISTINCT device_id)::int AS devices,
            (SELECT count(*)::int FROM push_devices WHERE token LIKE $2 || '%') AS synthetic
       FROM push_deliveries WHERE notification_id = $1`,
    [notificationId, TOKEN_PREFIX],
  )

  const fits = durationMs <= BUDGET_MS
  const once = stats.deliveries === stats.devices
  console.log(`devices              ${stats.devices} (${stats.synthetic} synthetic)`)
  console.log(`batches              ${batches} × ≤${BATCH_SIZE}, ${BATCH_PAUSE_MS} ms apart, ${latencyMs} ms per call`)
  console.log(`duration             ${(durationMs / 1000).toFixed(1)} s   budget ${BUDGET_MS / 1000} s   ${fits ? 'OK' : 'OVER'}`)
  console.log(`deliveries/devices   ${stats.deliveries}/${stats.devices}   ${once ? 'OK' : 'DUPLICATES'}`)
  process.exitCode = fits && once ? 0 : 1
} finally {
  // Always, including after a failure: nothing the bench made may outlive it.
  if (notificationId) await pool.query('DELETE FROM push_notifications WHERE id = $1', [notificationId])
  await pool.query(`DELETE FROM push_devices WHERE token LIKE $1 || '%'`, [TOKEN_PREFIX])
  await pool.end()
}

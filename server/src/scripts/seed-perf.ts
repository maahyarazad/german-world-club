import { loadEnv } from '../config/env.ts'
import { createPool } from '../db/pool.ts'

/**
 * A population sized for measuring Threads, not for looking at (010 SC-006):
 * `--members N --posts M`, defaults 5 000 and 50 000, plus a follow graph
 * and likes proportional to them.
 *
 * Development only, for the reason `seed:demo` gives, and checked the same
 * way — before `loadEnv()`, so a production refusal names the seed. Members
 * get no password (NULL cannot sign in), so unlike `seed:demo` nothing here is
 * a credential. Addresses are `@perf.demo.invalid`, which the demo seed's
 * `%@demo.invalid` never matches, so the two corpora never mix.
 *
 * Bulk SQL (`generate_series`), not per-row inserts: fifty thousand round
 * trips would measure the seeder, not the feed. Text posts only — media
 * attaches only in a post's own transaction (027), and the feed query's cost
 * is in the join and the keyset, not in the media batch.
 */
if (process.env.NODE_ENV !== 'development') {
  console.error(
    `refusing to seed: NODE_ENV is ${JSON.stringify(process.env.NODE_ENV ?? '')}, not "development".\n` +
      'seed:perf fills tables with tens of thousands of rows and must never touch a shared database.',
  )
  process.exit(1)
}

const arg = (name: string, fallback: number) => {
  const at = process.argv.indexOf(`--${name}`)
  const value = at === -1 ? fallback : Number(process.argv[at + 1])
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) {
    console.error(`seed:perf: --${name} must be a whole number between 1 and 1000000`)
    process.exit(1)
  }
  return value
}

const members = arg('members', 5_000)
const posts = arg('posts', 50_000)
const pool = createPool(loadEnv())
const started = Date.now()
// One connection, with the statement timeout lifted for this session only:
// the pool's timeout protects request handlers, and a 50 000-row bulk insert
// is not one. Nothing else shares this connection.
const db = await pool.connect()
await db.query('SET statement_timeout = 0')

try {
  // Posts are the step with no natural key, so they are the "already done"
  // check; everything before them is keyed and re-runs as a no-op, which
  // lets an interrupted run be completed rather than dropped.
  const { rows: existing } = await db.query(`SELECT count(*)::int AS n FROM thread_posts WHERE body LIKE 'Performance post %'`)
  if (existing[0].n > 0) {
    console.log(`seed:perf — already seeded (${existing[0].n} posts); drop the database to re-seed at another size.`)
  } else {
    // Parameters are cast explicitly: `% $1` on an untyped parameter is
    // `bigint % text` to PostgreSQL, which has no such operator.
    await db.query(
      `INSERT INTO members (email, display_name, handle, status, email_confirmed_at, created_at)
       SELECT 'perf' || g || '@perf.demo.invalid', 'Perf Member ' || g, 'perf_' || g, 'active',
              now() - interval '400 days', now() - interval '400 days'
         FROM generate_series(1, $1::int) g
       ON CONFLICT DO NOTHING`,
      [members],
    )
    // Each member follows 20 others, spread deterministically.
    await db.query(
      `INSERT INTO member_follows (follower_id, followee_id, created_at)
       SELECT a.id, b.id, now() - interval '300 days'
         FROM (SELECT id, row_number() OVER (ORDER BY email) AS n FROM members WHERE email LIKE '%@perf.demo.invalid') a
         JOIN generate_series(1, 20) k ON true
         JOIN (SELECT id, row_number() OVER (ORDER BY email) AS n FROM members WHERE email LIKE '%@perf.demo.invalid') b
           ON b.n = ((a.n + k * 37) % $1::int) + 1
        WHERE a.id <> b.id
       ON CONFLICT DO NOTHING`,
      [members],
    )
    // Posts spread over a year; one in five is a reply to an earlier post.
    await db.query(
      `INSERT INTO thread_posts (author_id, body, created_at, state_changed_at)
       SELECT m.id, 'Performance post ' || g, now() - (g || ' minutes')::interval * 10, now() - (g || ' minutes')::interval * 10
         FROM generate_series(1, $1::int) g
         JOIN (SELECT id, row_number() OVER (ORDER BY email) AS n FROM members WHERE email LIKE '%@perf.demo.invalid') m
           ON m.n = (g % $2::int) + 1`,
      [posts, members],
    )
    await db.query(
      `INSERT INTO thread_likes (post_id, member_id, created_at)
       SELECT p.id, m.id, p.created_at + interval '1 hour'
         FROM (SELECT id, created_at, row_number() OVER (ORDER BY created_at) AS n FROM thread_posts
                WHERE body LIKE 'Performance post %') p
         JOIN (SELECT id, row_number() OVER (ORDER BY email) AS n FROM members WHERE email LIKE '%@perf.demo.invalid') m
           ON m.n IN ((p.n % $1::int) + 1, ((p.n * 7) % $1::int) + 1)
       ON CONFLICT DO NOTHING`,
      [members],
    )
    await db.query('ANALYZE members, member_follows, thread_posts, thread_likes')
    console.log(`seed:perf — ${members} members, ${posts} posts in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  }
} finally {
  db.release()
  await pool.end()
}

import { loadEnv } from '../config/env.ts'
import { createPool } from '../db/pool.ts'
import { searchPredicates } from '../db/text-search.ts'
import { browseListings } from '../modules/marketplace/application/browse.ts'
import { listVisibleOffers } from '../modules/offers/application/browse.ts'
import type { GwcApp } from '../app.ts'

/**
 * p95 of the text search on both lists (feature 042, SC-006): the first page of
 * results for several kinds of term, against 50 000 marketplace listings and 5 000
 * offers, budget 300 ms.
 *
 * The terms are chosen to reach different plans, because one easy case proves little:
 * a COMMON term matches most rows, so the planner walks the date-ordered index and stops
 * after 21 hits and never touches the trigram index; a RARE term is where the trigram index
 * earns its keep; and a term that matches NOTHING forces the whole live set to be examined,
 * which is the worst case. For a two-letter term that worst case has no trigram to use.
 *
 *   npm run -w server bench:search -- --seed      fill a scratch database, then measure
 *   npm run -w server bench:search                measure what is there
 *
 * Runs the real application functions, not copies of their SQL, so a change to a query
 * is measured by the next run. (The EXPLAIN at the end does repeat the listings query,
 * because EXPLAIN needs the text.) A two-letter term has no trigram to look up, so the
 * GIN index cannot answer it and it is the hard case: it is measured on purpose.
 *
 * **Scratch databases only.** `--seed` writes tens of thousands of rows, so this refuses
 * under NODE_ENV=production and for any database whose name does not say it is disposable
 * (`bench`, `scratch`, `perf` or `test`). Pass `DATABASE_URL=...` on the command line to
 * point it at one; do not run it against a database anyone else uses. The rows are
 * `@bench.demo.invalid`, which no other seed produces.
 */
const dbName = (() => {
  try { return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1) } catch { return '' }
})()
if (process.env.NODE_ENV === 'production' || !/(bench|scratch|perf|test)/i.test(dbName)) {
  console.error(
    `bench:search refuses to run: database ${JSON.stringify(dbName)} (NODE_ENV ${JSON.stringify(process.env.NODE_ENV ?? '')}) does not look disposable.\n` +
      'Use a scratch database whose name contains bench, scratch, perf or test, e.g. DATABASE_URL=postgres://localhost/gwc_bench.',
  )
  process.exit(1)
}

const flag = (name: string) => process.argv.includes(`--${name}`)
const arg = (name: string, fallback: number) => {
  const at = process.argv.indexOf(`--${name}`)
  const value = at === -1 ? fallback : Number(process.argv[at + 1])
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) {
    console.error(`bench:search: --${name} must be a whole number between 1 and 1000000`)
    process.exit(1)
  }
  return value
}

const LISTINGS = arg('listings', 50_000)
const OFFERS = arg('offers', 5_000)
const RUNS = Number(process.env.BENCH_RUNS ?? 40)
const BUDGET_MS = 300

const WORDS = [
  'Fahrrad', 'Kinderwagen', 'Sofa', 'Tisch', 'Stuhl', 'Lampe', 'Fernseher', 'Laptop', 'Handy', 'Kaffeemaschine',
  'Waschmaschine', 'Wohnung', 'Auto', 'Helm', 'Kamera', 'Gitarre', 'Klavier', 'Buch', 'Spielzeug', 'Mantel',
  'Regal', 'Teppich', 'Lautsprecher', 'TV-Schrank', 'Kinderrad', 'Gutschein', 'Mittagstisch', 'Rabatt', 'Pizza', 'Massage',
]
const SQL_WORDS = `ARRAY[${WORDS.map((w) => `'${w}'`).join(',')}]`

const pool = createPool(loadEnv())
const app = { pg: pool } as unknown as GwcApp
const p95 = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!

async function seed() {
  // One connection, statement timeout lifted for this session only (the pool's protects request handlers).
  const db = await pool.connect()
  try {
    await db.query('SET statement_timeout = 0')
    const { rows: owners } = await db.query(`SELECT id FROM members WHERE email = 'bench@bench.demo.invalid'`)
    let owner = owners[0]?.id as string | undefined
    if (!owner) {
      const { rows } = await db.query(
        `INSERT INTO members (email, display_name, handle, status, email_confirmed_at)
         VALUES ('bench@bench.demo.invalid', 'Bench Owner', 'bench_owner', 'active', now()) RETURNING id`,
      )
      owner = String(rows[0].id)
    }

    const { rows: have } = await db.query(`SELECT count(*)::int AS n FROM marketplace_listings WHERE title LIKE '% bench-%'`)
    if (have[0].n < LISTINGS) {
      const missing = LISTINGS - have[0].n
      console.log(`seeding ${missing} listings…`)
      await db.query(
        `INSERT INTO marketplace_listings (owner_id, category, mode, title, body, state, terms_version, published_at, state_changed_at)
         SELECT $1, 'general', 'offer',
                (${SQL_WORDS})[1 + (g % ${WORDS.length})] || ' ' || (${SQL_WORDS})[1 + ((g * 7) % ${WORDS.length})] || ' bench-' || g,
                array_to_string(ARRAY(SELECT (${SQL_WORDS})[1 + ((g * k) % ${WORDS.length})] FROM generate_series(1, 40) k), ' '),
                'active', 'v1', now() - (g || ' seconds')::interval, now()
           FROM generate_series(1, $2::int) g`,
        [owner, missing],
      )
    }

    const { rows: orgs } = await db.query(`SELECT id FROM organisations WHERE slug = 'bench-merchant'`)
    let org = orgs[0]?.id as string | undefined
    if (!org) {
      const { rows } = await db.query(`INSERT INTO organisations (kind, legal_name, slug) VALUES ('merchant', 'Bench Merchant', 'bench-merchant') RETURNING id`)
      org = String(rows[0].id)
      await db.query(`INSERT INTO organisation_profiles (organisation_id, display_name) VALUES ($1, 'Bench Merchant')`, [org])
      await db.query(`INSERT INTO stores (organisation_id) VALUES ($1)`, [org])
    }
    const { rows: stores } = await db.query(`SELECT id FROM stores WHERE organisation_id = $1`, [org])
    const { rows: haveOffers } = await db.query(`SELECT count(*)::int AS n FROM offers WHERE organisation_id = $1`, [org])
    if (haveOffers[0].n < OFFERS) {
      const missing = OFFERS - haveOffers[0].n
      console.log(`seeding ${missing} offers…`)
      await db.query(
        `INSERT INTO offers (organisation_id, store_id, category_id, title, description, benefit_kind, benefit_value,
                             valid_from, valid_until, state, published_at)
         SELECT $1, $2, (SELECT id FROM offer_categories ORDER BY position LIMIT 1),
                (${SQL_WORDS})[1 + (g % ${WORDS.length})] || ' ' || (${SQL_WORDS})[1 + ((g * 7) % ${WORDS.length})] || ' bench-' || g,
                array_to_string(ARRAY(SELECT (${SQL_WORDS})[1 + ((g * k) % ${WORDS.length})] FROM generate_series(1, 25) k), ' '),
                'percentage', 20, now() - interval '1 day', now() + interval '30 days', 'published', now() - (g || ' seconds')::interval
           FROM generate_series(1, $3::int) g`,
        [org, stores[0].id, missing],
      )
    }
    await db.query('ANALYZE marketplace_listings')
    await db.query('ANALYZE offers')
  } finally {
    db.release()
  }
}

try {
  if (flag('seed')) await seed()

  const { rows: counts } = await pool.query(
    `SELECT (SELECT count(*) FROM marketplace_listings WHERE state = 'active')::int AS listings,
            (SELECT count(*) FROM offers WHERE state = 'published')::int AS offers`,
  )
  console.log(`measuring over ${counts[0].listings} active listings and ${counts[0].offers} published offers, ${RUNS} runs each\n`)
  if (counts[0].listings < 1000) {
    console.error('bench:search: too few rows to mean anything — run with --seed on a scratch database first.')
    process.exit(1)
  }

  const measure = async (name: string, fn: () => Promise<unknown>) => {
    await fn() // warm the plan cache
    const samples: number[] = []
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now()
      await fn()
      samples.push(performance.now() - t0)
    }
    const value = p95(samples)
    console.log(`${name.padEnd(34)} p95 ${value.toFixed(1).padStart(7)} ms   budget ${BUDGET_MS} ms   ${value <= BUDGET_MS ? 'OK' : 'OVER'}`)
    return value <= BUDGET_MS
  }

  const results: boolean[] = []
  const TERMS = [
    ['common, 3 letters', 'rad'],
    ['common, 2 letters', 'tv'],
    ['rare (about 11 rows)', 'bench-4242'],
    ['no match, 4 letters', 'zzzq'],
    ['no match, 2 letters: WORST', 'zq'],
    ['two words, common', 'fahrrad sofa'],
  ] as const
  for (const [label, q] of TERMS) {
    results.push(await measure(`listings: ${label} "${q}"`, () => browseListings(app, { limit: 20, q })))
    results.push(await measure(`offers:   ${label} "${q}"`, () => listVisibleOffers(app, { q })))
  }

  // The plans that matter: a rare term should be a Bitmap Index Scan on a trigram index.
  for (const q of ['bench-4242', 'zq']) {
    const params: unknown[] = []
    const preds = searchPredicates(q, ['l.title', 'l.body'], params)
    const { rows: plan } = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT l.id FROM marketplace_listings l JOIN members m ON m.id = l.owner_id
        WHERE l.state = 'active' AND m.status = 'active' AND ${preds.join(' AND ')}
        ORDER BY l.created_at DESC, l.id DESC LIMIT 21`,
      params,
    )
    console.log(`\nEXPLAIN (ANALYZE, BUFFERS), listings, "${q}":`)
    for (const row of plan) console.log('  ' + row['QUERY PLAN'])
  }

  process.exitCode = results.every(Boolean) ? 0 : 1
} finally {
  await pool.end()
}

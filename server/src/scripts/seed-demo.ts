import { loadEnv } from '../config/env.ts'
import { createPool } from '../db/pool.ts'
import { parseOptions } from '../seed/options.ts'
import { createFaker, SEED } from '../seed/faker.ts'
import { hashAll } from '../seed/hashing.ts'
import { WRITABLE, NEVER_SEEDED } from '../seed/tables.ts'

/**
 * Demo data: every identity kind, with credentials printed at the end.
 *
 * Separate from `seed:dev`, which creates the six fixed accounts the quickstart
 * scenarios and the DB-backed suites depend on. One command doing both would
 * put hundreds of rows into every test run and bury those six among them.
 */
/**
 * Refuses to run anywhere but a development machine.
 *
 * Everything below has a password printed on a terminal. `development`
 * exactly, not `!isProduction`: staging runs as production, and a CI database
 * is no place for published credentials either. "We would never run it in
 * production" is not a control; this is.
 *
 * Checked against `process.env` **before** `loadEnv()`, deliberately. Under a
 * production NODE_ENV the config loader refuses first — it demands
 * CANONICAL_ORIGIN and the rest — and the operator would see a configuration
 * error that never mentions seeding. A refusal that does not say what it
 * refused is one somebody works around.
 */
if (process.env.NODE_ENV !== 'development') {
  console.error(
    `refusing to seed: NODE_ENV is ${JSON.stringify(process.env.NODE_ENV ?? '')}, not "development".\n` +
      'This command creates accounts with published passwords and must never touch a shared database.',
  )
  process.exit(1)
}

const env = loadEnv()

let options
try {
  options = parseOptions()
} catch (error) {
  console.error(`seed:demo: ${error.message}`)
  process.exit(1)
}

const pool = createPool(env)
const started = Date.now()

/**
 * The schema this seed needs.
 *
 * Checked up front so a missing migration is one clear message rather than a
 * partial population and a foreign-key error forty rows in.
 */
const REQUIRED_TABLES = [
  'members', 'admin_users', 'organisations', 'organisation_users',
  'offers', 'events',
]

try {
  const { rows: present } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [REQUIRED_TABLES],
  )
  const missing = REQUIRED_TABLES.filter((t) => !present.some((r) => r.table_name === t))
  if (missing.length > 0) {
    console.error(
      `refusing to seed: the database is missing ${missing.join(', ')}.\n` +
        'Run `npm run -w server migrate` first — this seed needs migrations through 016.',
    )
    process.exit(1)
  }

  const faker = createFaker({ random: options.random })

  console.log(
    options.random
      ? '\nseed:demo — RANDOMISED. This run is not reproducible.\n'
      : `\nseed:demo — deterministic (seed ${SEED})\n`,
  )

  const counts: Record<string, Record<string, unknown>> = {}
  const { seedMembers } = await import('../seed/members.ts')
  const { seedStaff } = await import('../seed/staff.ts')
  const { seedOrganisations } = await import('../seed/organisations.ts')
  const { seedOffers } = await import('../seed/offers.ts')
  const { seedEvents } = await import('../seed/events.ts')
  const { seedContent } = await import('../seed/content.ts')
  const { seedOperations } = await import('../seed/operations.ts')
  const { seedVehicleFeatures } = await import('../seed/vehicle-features.ts')
  const { seedMarketplace } = await import('../seed/marketplace.ts')
  const { seedThreads } = await import('../seed/threads.ts')
  const { CREDENTIALS, renderCredentials, writeCredentials } = await import('../seed/credentials.ts')

  // One hash per distinct password, before anything inserts (research R5).
  await hashAll(CREDENTIALS.map((c) => c.password).filter(Boolean))

  counts.members = await seedMembers(pool, faker, options)
  counts.staff = await seedStaff(pool, faker, options)
  counts.organisations = await seedOrganisations(pool, faker, options)
  counts.offers = await seedOffers(pool, faker, options)
  counts.events = await seedEvents(pool, faker, options)
  counts.content = await seedContent(pool, faker, options)
  counts.operations = await seedOperations(pool, faker, options)
  // The vehicle feature catalogue is reference data, not a population: it does
  // not scale with --members and it is the same in every environment.
  counts.marketplace = { vehicle_features: await seedVehicleFeatures(pool) }
  // After members, staff, content and operations: listings need posters, a
  // hide needs a moderator, and the expiry history joins job_runs alongside
  // the runs operations.ts writes.
  counts.listings = await seedMarketplace(pool, faker, options)
  // After members, staff and organisations: posts need authors, the
  // influencer grant needs staff who hold members.write, and organisation
  // profiles need organisations.
  counts.threads = await seedThreads(pool, faker, options)

  if (!options.quiet) {
    for (const [group, result] of Object.entries(counts)) {
      const detail = Object.entries(result)
        .map(([table, n]) => `${table} ${n}`)
        .join(', ')
      console.log(`  ${group.padEnd(14)} ${detail}`)
    }
    console.log(`\n  completed in ${((Date.now() - started) / 1000).toFixed(1)}s`)

    /**
     * FR-035 — "seed all the tables", reported rather than assumed.
     *
     * Counted from the database against the manifest, not from what the
     * generators claim to have written. A generator that returned `offers: 60`
     * having inserted nothing would be believed by a summary built from its own
     * return value; it cannot be believed by a `count(*)`.
     *
     * The empty line at the end is the one worth reading. A table in `WRITABLE`
     * that came out at zero is either a generator that silently did nothing or
     * a table nobody has got to yet, and both deserve to be on screen rather
     * than discovered from an empty screen in the console three days later.
     */
    const populated = []
    const empty = []
    for (const table of WRITABLE) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "${table}"`)
      ;(rows[0].n > 0 ? populated : empty).push(`${table} (${rows[0].n})`)
    }

    console.log(`\n  populated ${populated.length}/${WRITABLE.length} tables:`)
    console.log(`    ${populated.sort().join(', ')}`)
    console.log(
      `\n  not seeded, by design: ${Object.keys(NEVER_SEEDED).join(', ')}\n` +
        '  — each holds a live credential and fills itself on sign-in.',
    )
    if (empty.length > 0) {
      console.log(`\n  WRITABLE BUT EMPTY — nothing was written here: ${empty.sort().join(', ')}`)
    }
    console.log('')
  }

  console.log(renderCredentials())
  const file = await writeCredentials()
  console.log(`  (also written to ${file})\n`)
} finally {
  await pool.end()
}

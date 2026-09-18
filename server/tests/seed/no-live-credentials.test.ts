import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withSeededDatabase } from './helpers.ts'
import { hasDatabase } from '../helpers/db.ts'
import { NEVER_SEEDED } from '../../src/seed/tables.ts'
import type { SeededDatabase } from '../seed/helpers.ts'

/**
 * SC-015 / T056 — the four tables the seeder may never write.
 *
 * A seeded session is a valid credential nobody authenticated for. A seeded
 * reset token is a working password-reset link sitting in a table, and the demo
 * database's credentials are published on purpose, so anyone reading the README
 * would hold it. This is a security property, not a matter of taste.
 *
 * Checked twice, at two different times, because the two checks fail for
 * different reasons:
 *
 *  - **statically**, against the seeder's source, which catches an INSERT added
 *    to a code path this run happened not to take;
 *  - **after a run**, against the database, which catches a write that arrives
 *    some way the source scan cannot see.
 *
 * Neither subsumes the other. A conditional insert behind `if (options.x)`
 * passes the second and fails the first.
 */

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'seed')
const FORBIDDEN = Object.keys(NEVER_SEEDED)

describe('the seeder source never writes a credential table', () => {
  const sources = readdirSync(SEED_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(join(SEED_DIR, f), 'utf8')])

  it('reads more than nothing — a scan of no files finds no offenders', () => {
    expect(sources.length).toBeGreaterThan(5)
  })

  it.each(FORBIDDEN)('no module inserts into %s', (table) => {
    // Matches the statement, not the word: these tables are named in comments
    // throughout `tables.js`, which is where the prohibition is documented and
    // therefore the last place it should be reported as a violation.
    const write = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'i')
    const offenders = sources.filter(([, body]) => write.test(body)).map(([name]) => name)
    expect(offenders, `${table} is written by ${offenders.join(', ')}`).toEqual([])
  })

  it('STILL CATCHES a write — the pattern is not inert', () => {
    // Without this, a regex that matched nothing at all would pass every case
    // above and the whole suite would be decorative.
    const write = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+sessions\\b`, 'i')
    expect(write.test(`await client.query('INSERT INTO sessions (account_id) VALUES ($1)')`)).toBe(true)
    expect(write.test('// sessions are never seeded')).toBe(false)
  })

  it('names each forbidden table with the reason it is forbidden', () => {
    // The manifest is what a future contributor reads before adding a table.
    // A bare list invites "this one is probably fine".
    for (const [table, reason] of Object.entries(NEVER_SEEDED)) {
      expect(reason, table).toMatch(/live|credential|session|reset/i)
    }
  })
})

describe.skipIf(!hasDatabase)('and nothing lands in one at run time either', () => {
  let db: SeededDatabase
  beforeAll(async () => { db = await withSeededDatabase('gwc_seed_livecreds') }, 180_000)
  afterAll(async () => { await db?.drop() })

  it.each(FORBIDDEN)('%s is empty after a full seed', async (table) => {
    const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM ${table}`)
    expect(rows[0].n).toBe(0)
  })

  it('stays empty after a second run', async () => {
    // Idempotency guards are the kind of code that grows an "if empty, insert"
    // branch. This is the one place such a branch must never appear.
    const { runSeed } = await import('./helpers.ts')
    await runSeed({ env: { DATABASE_URL: db.url, NODE_ENV: 'development' } })
    for (const table of FORBIDDEN) {
      const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM ${table}`)
      expect(rows[0].n, table).toBe(0)
    }
  }, 120_000)

  it('BUT signing in DOES fill one — the tables work, they are just not seeded', async () => {
    /**
     * The counter-assertion this suite needs most.
     *
     * Four empty tables are also what a broken migration produces, and what a
     * seeder pointed at the wrong database produces. Proving a session appears
     * the moment somebody authenticates is what distinguishes "deliberately not
     * seeded" from "does not work".
     */
    const { buildApp } = await import('../../src/app.ts')
    const { createFixtureContentSource } = await import('../../src/modules/public/content.ts')
    const { CREDENTIALS } = await import('../../src/seed/credentials.ts')

    process.env.DATABASE_URL = db.url
    const app = await buildApp({ contentSource: createFixtureContentSource([]) })
    await app.ready()
    try {
      const credential = CREDENTIALS.find((c) => c.expect === 'authenticated' && c.kind === 'member')
      const response = await app.inject({
        method: 'POST',
        url: '/auth/sign-in',
        payload: { email: credential.email, password: credential.password },
      })
      expect(response.statusCode, response.body).toBe(200)

      const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM sessions')
      expect(rows[0].n).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  }, 60_000)
})

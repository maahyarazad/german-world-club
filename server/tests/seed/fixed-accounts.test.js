import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { hasDatabase } from '../helpers/db.js'
import { readFileSync } from 'node:fs'
import { runSeed } from './helpers.js'

const run = promisify(execFile)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * SC-007 — the two seeds do not fight.
 *
 * `seed:dev` produces six accounts with one known password, and every
 * hand-written test, every screenshot and everybody's muscle memory depends on
 * them. `seed:demo` generates hundreds more. The failure this suite exists to
 * catch is quiet: a generated local part collides with `member@test.invalid`,
 * an upsert rewrites its password hash, and the account everyone uses stops
 * working with no error anywhere to explain it.
 *
 * Two separate namespaces are what prevent it — `@test.invalid` for the fixed
 * six, `@*.demo.invalid` for everything generated — and the assertion is on the
 * hashes, not on the row count, because a collision that replaced a password
 * leaves the count unchanged.
 */
/**
 * Not imported from `seed-dev.js`: that module is a script, and importing it
 * would run a seed as a side effect of reading one constant. The test below
 * asserts the script still declares this value instead, so changing it there
 * fails here rather than turning six sign-ins into a puzzle.
 */
const SEED_PASSWORD = 'konsole-entwicklung'

const FIXED = [
  'seo@test.invalid',
  'reader@test.invalid',
  'push@test.invalid',
  'nogrants@test.invalid',
  'super@test.invalid',
  'member@test.invalid',
]

describe.skipIf(!hasDatabase)('the demo seed leaves the fixed accounts exactly as they were', () => {
  const name = 'gwc_seed_fixed'
  const url = `postgres://localhost:5432/${name}`
  const env = { DATABASE_URL: url, NODE_ENV: 'development' }
  let pool
  let before

  const snapshot = async () => {
    const { rows } = await pool.query(
      `SELECT email, password_hash, display_name, is_superadmin::text AS flag, 'staff' AS kind
         FROM admin_users WHERE email = ANY($1)
       UNION ALL
       SELECT email, password_hash, display_name, status::text AS flag, 'member' AS kind
         FROM members WHERE email = ANY($1)
       ORDER BY email`,
      [FIXED],
    )
    return rows
  }

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: 'postgres://localhost:5432/postgres' })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${name}`)
    await admin.query(`CREATE DATABASE ${name}`)
    await admin.end()

    await run('node', ['src/db/migrate.js'], { cwd: SERVER, env: { ...process.env, ...env } })
    await run('node', ['src/scripts/seed-dev.js'], { cwd: SERVER, env: { ...process.env, ...env } })

    pool = new pg.Pool({ connectionString: url })
    before = await snapshot()
  }, 240_000)

  afterAll(async () => {
    await pool?.end()
    const cleanup = new pg.Client({ connectionString: 'postgres://localhost:5432/postgres' })
    await cleanup.connect()
    await cleanup.query(`DROP DATABASE IF EXISTS ${name}`)
    await cleanup.end()
  })

  it('still knows the password seed:dev actually sets', () => {
    const source = readFileSync(join(SERVER, 'src', 'scripts', 'seed-dev.js'), 'utf8')
    expect(source).toContain(`const SEED_PASSWORD = '${SEED_PASSWORD}'`)
  })

  it('starts from all six fixed accounts', () => {
    // Without this the comparison below would be of two empty sets, which any
    // seeder satisfies.
    expect(before.map((r) => r.email).sort()).toEqual([...FIXED].sort())
  })

  it('changes not one byte of them', async () => {
    const result = await runSeed({ env })
    expect(result.code, result.stderr).toBe(0)

    const after = await snapshot()
    // Hashes included deliberately: an upsert that rewrote a password leaves
    // the row count, the email and the display name all untouched.
    expect(after).toEqual(before)
  }, 240_000)

  it('did add its own population alongside them', async () => {
    // The counter-assertion. A seed that refused to run at all would leave the
    // six accounts perfectly intact.
    const { rows } = await pool.query(`
      SELECT (SELECT count(*)::int FROM members WHERE email LIKE '%.invalid' AND email NOT LIKE '%@test.invalid') AS generated_members,
             (SELECT count(*)::int FROM organisations) AS organisations`)
    expect(rows[0].generated_members).toBeGreaterThan(50)
    expect(rows[0].organisations).toBeGreaterThan(0)
  })

  it('keeps the two namespaces disjoint', async () => {
    // The mechanism behind the guarantee, asserted directly: no generated
    // address can ever be `something@test.invalid`, so no upsert can ever
    // target a fixed account however the local part comes out.
    const { rows } = await pool.query(`
      SELECT email FROM members WHERE email LIKE '%@test.invalid'
      UNION ALL
      SELECT email FROM admin_users WHERE email LIKE '%@test.invalid'`)
    expect(rows.map((r) => r.email).sort()).toEqual([...FIXED].sort())
  })

  it('lets seed:dev run again afterwards, and still leaves them working', async () => {
    // The other order. Somebody will re-run `seed:dev` on a demo database, and
    // it must be as unremarkable as running it twice on an empty one.
    await run('node', ['src/scripts/seed-dev.js'], { cwd: SERVER, env: { ...process.env, ...env } })

    /**
     * Compared without the hash, unlike the demo-seed assertion above.
     *
     * `seed:dev` re-upserts the same password, and argon2 draws a fresh salt
     * every time, so the stored string differs on every run while verifying the
     * identical password. Requiring byte equality here would be asserting that
     * argon2 is deterministic, which is the one thing a password hash must not
     * be. The demo seed is held to the stricter test precisely because it is
     * supposed to leave these rows untouched entirely.
     */
    const withoutHash = (rows) => rows.map(({ password_hash, ...rest }) => rest)
    expect(withoutHash(await snapshot())).toEqual(withoutHash(before))
  }, 120_000)

  it('leaves the fixed accounts able to sign in', async () => {
    // Equal hashes prove the row did not change. They do not prove the account
    // still authenticates — a demo-seeded permission row or a status change
    // elsewhere could break sign-in with the hash untouched.
    const { buildApp } = await import('../../src/app.js')
    const { createFixtureContentSource } = await import('../../src/public/content.js')

    process.env.DATABASE_URL = url
    const app = await buildApp({ contentSource: createFixtureContentSource([]) })
    await app.ready()
    try {
      let n = 0
      for (const email of FIXED) {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/sign-in',
          payload: { email, password: SEED_PASSWORD },
          // Per-account source address: the sign-in limiter is IP-keyed and six
          // sign-ins from one address is a burst it is right to notice.
          remoteAddress: `10.9.0.${++n}`,
        })
        expect(response.statusCode, `${email}: ${response.body}`).toBe(200)
        expect(response.json().outcome, email).toBe('authenticated')
      }
    } finally {
      await app.close()
    }
  }, 120_000)
})

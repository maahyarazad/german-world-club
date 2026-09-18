import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const run = promisify(execFile)
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * A scratch database, migrated and seeded, for one suite.
 *
 * Its own database rather than the shared test one: the seed inserts hundreds
 * of rows, and a suite that left them behind would change what every other
 * DB-backed suite sees.
 */
export async function withSeededDatabase(name: string, { args = [] }: { args?: string[] } = {}) {
  const url = `postgres://localhost:5432/${name}`
  const admin = new pg.Client({ connectionString: 'postgres://localhost:5432/postgres' })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${name}`)
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()

  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'development' }
  await run('node', ['src/db/migrate.ts'], { cwd: SERVER, env })
  const { stdout } = await run('node', ['src/scripts/seed-demo.ts', ...args], { cwd: SERVER, env })

  const pool = new pg.Pool({ connectionString: url })
  return {
    pool,
    stdout,
    url,
    async drop() {
      await pool.end()
      const cleanup = new pg.Client({ connectionString: 'postgres://localhost:5432/postgres' })
      await cleanup.connect()
      await cleanup.query(`DROP DATABASE IF EXISTS ${name}`)
      await cleanup.end()
    },
  }
}

/** Run the seed and hand back its outcome without throwing. */
export async function runSeed({ env = {}, args = [] }: { env?: Record<string, string>; args?: string[] } = {}) {
  try {
    const { stdout } = await run('node', ['src/scripts/seed-demo.ts', ...args], {
      cwd: SERVER,
      env: { ...process.env, ...env },
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

/** A scratch database plus its pool, as withSeededDatabase hands it back. */
export type SeededDatabase = Awaited<ReturnType<typeof withSeededDatabase>>

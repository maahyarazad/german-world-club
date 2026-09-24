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
export function databaseUrl(name: string) {
  const base = new URL(process.env.DATABASE_URL ?? 'postgres://localhost:5432/postgres')
  base.pathname = `/${name}`
  return base.toString()
}

export async function withSeededDatabase(name: string, { args = [] }: { args?: string[] } = {}) {
  // Same server and credentials as DATABASE_URL, another database: a
  // password-less literal here failed SCRAM on any server that requires one,
  // and made every seed suite fail for a reason unrelated to the seed.
  const url = databaseUrl(name)
  const admin = new pg.Client({ connectionString: databaseUrl('postgres') })
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
      const cleanup = new pg.Client({ connectionString: databaseUrl('postgres') })
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

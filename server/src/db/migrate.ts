#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'
import { loadEnv } from '../config/env.ts'
import type { Pool, PoolClient } from 'pg'

/**
 * SQL migration runner. Applies in filename order and records what it applied.
 *
 * Plain SQL rather than an ORM's generator because §1.2 makes relational
 * integrity load-bearing: partial unique indexes, triggers, CHECK constraints
 * and `FOR UPDATE` are natural in SQL and fiddly through an abstraction.
 */

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

async function ensureTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
}

export async function listMigrations() {
  const files = await readdir(DIR)
  return files.filter((f) => f.endsWith('.sql')).sort()
}

export async function up({ connectionString, log = console.log } = {}) {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    await ensureTable(client)
    const { rows } = await client.query('SELECT filename FROM schema_migrations')
    const applied = new Set(rows.map((r) => r.filename))
    const pending = (await listMigrations()).filter((f) => !applied.has(f))

    if (pending.length === 0) {
      log('migrations: up to date')
      return []
    }

    for (const file of pending) {
      const sql = await readFile(path.join(DIR, file), 'utf8')
      // Each migration is one transaction: a partial apply would leave the
      // schema in a state no later migration expects.
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
        log(`migrations: applied ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err })
      }
    }
    return pending
  } finally {
    await client.end()
  }
}

/** True when every migration on disk has been applied — backs readiness. */
export async function isCurrent(pool: Pool) {
  try {
    const { rows } = await pool.query('SELECT filename FROM schema_migrations')
    const applied = new Set(rows.map((r) => r.filename))
    const pending = (await listMigrations()).filter((f) => !applied.has(f))
    return { ok: pending.length === 0, pending }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Undo every migration, which removes every row along with the schema: the
 * demo, dev and perf seeds and anything the benchmarks left behind.
 *
 * There are no per-migration down scripts, and writing them would not help:
 * `members`, `organisations`, `audit_log`, `thread_posts` and others refuse
 * DELETE by trigger on purpose, so the seeded rows cannot be deleted row by
 * row. Dropping the schema is the one operation those triggers do not stand in
 * front of, and `up` rebuilds everything afterwards, including the reference
 * rows the migrations themselves insert (cities, job definitions).
 *
 * Development only, checked by the caller before this runs: it is total, and
 * on a shared database it would be an outage. Also drops the `pgboss` schema,
 * whose job rows reference the members being removed.
 */
export async function down({ connectionString, log = console.log } = {}) {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const { rows: [target] } = await client.query('SELECT current_database() AS db')
    await client.query('BEGIN')
    try {
      await client.query('DROP SCHEMA IF EXISTS pgboss CASCADE')
      await client.query('DROP SCHEMA public CASCADE')
      await client.query('CREATE SCHEMA public')
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw new Error(`Migrate down failed: ${err.message}`, { cause: err })
    }
    log(`migrations: rolled back everything in database "${target.db}" (all data removed). Run "migrate" to rebuild the schema.`)
  } finally {
    await client.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] ?? 'up'
  if (cmd !== 'up' && cmd !== 'down') {
    console.error(`Unsupported command "${cmd}". Use "up" or "down".`)
    process.exit(1)
  }
  // Before loadEnv(), like the seeders' gate: a refusal must not depend on the
  // rest of the configuration being valid.
  if (cmd === 'down' && process.env.NODE_ENV !== 'development') {
    console.error(
      `refusing to migrate down: NODE_ENV is ${JSON.stringify(process.env.NODE_ENV ?? '')}, not "development".\n` +
        'migrate:down deletes every table and row and must never touch a shared database.',
    )
    process.exit(1)
  }
  const env = loadEnv()
  if (cmd === 'down') await down({ connectionString: env.DATABASE_URL })
  else await up({ connectionString: env.DATABASE_URL })
}

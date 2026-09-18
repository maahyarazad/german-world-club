#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'
import { loadEnv } from '../config/env.js'

/**
 * SQL migration runner. Applies in filename order and records what it applied.
 *
 * Plain SQL rather than an ORM's generator because §1.2 makes relational
 * integrity load-bearing: partial unique indexes, triggers, CHECK constraints
 * and `FOR UPDATE` are natural in SQL and fiddly through an abstraction.
 */

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

async function ensureTable(client) {
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
export async function isCurrent(pool) {
  try {
    const { rows } = await pool.query('SELECT filename FROM schema_migrations')
    const applied = new Set(rows.map((r) => r.filename))
    const pending = (await listMigrations()).filter((f) => !applied.has(f))
    return { ok: pending.length === 0, pending }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv()
  const cmd = process.argv[2] ?? 'up'
  if (cmd !== 'up') {
    console.error(`Unsupported command "${cmd}". Only "up" is implemented; roll back by restoring a snapshot.`)
    process.exit(1)
  }
  await up({ connectionString: env.DATABASE_URL })
}

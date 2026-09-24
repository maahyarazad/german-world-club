import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SEEDED, HISTORY, NEVER_SEEDED, ALL_TABLES, NOT_APPLICATION_DATA, isForbidden,
} from '../../src/seed/tables.ts'

/**
 * SC-014 — "seed all the tables" is a checkable claim.
 *
 * The failure this guards against is quiet: somebody adds a table in six
 * months, nobody adds it to the seed, and the demo database silently has a
 * hole in it that only shows up when a screen renders empty.
 *
 * ── Why the migrations, not information_schema ──────────────────────────────
 * The obvious implementation compares the manifest against a live database.
 * That was the first attempt, and it was wrong: the scratch test database had
 * accumulated a `usage_counters` table from a schema that no longer exists,
 * so the check failed on a table no migration creates. A database is a
 * *history* of schemas; the migrations are the schema. Parsing them is both
 * more correct and immune to whatever a developer's scratch database has
 * collected.
 */

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../migrations')

/**
 * Every table the migrations leave behind, in the order they appear.
 *
 * Renames are applied as they are met (feature 011 renamed push_campaigns to
 * push_notifications). Reading CREATE TABLE alone would report the old name as
 * a table that exists and the new one as a phantom.
 */
function tablesFromMigrations() {
  let tables: string[] = []
  const statement = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_]+)|ALTER TABLE(?:\s+IF EXISTS)?\s+([a-z_]+)\s+RENAME TO\s+([a-z_]+)/gi
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith('.sql')) continue
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--.*$/gm, '')
    for (const [, created, from, to] of sql.matchAll(statement)) {
      if (created) tables.push(created.toLowerCase())
      else tables = tables.map((t) => (t === from!.toLowerCase() ? to!.toLowerCase() : t))
    }
  }
  return [...new Set(tables)]
}

describe('the manifest accounts for every table', () => {
  const schema = tablesFromMigrations()

  it('finds tables to check — the suite is not vacuous', () => {
    expect(schema.length).toBeGreaterThan(15)
    expect(schema).toContain('members')
  })

  it('names every table the migrations create', () => {
    const accounted = new Set([...ALL_TABLES, ...NOT_APPLICATION_DATA])
    const unaccounted = schema.filter((t) => !accounted.has(t))
    expect(
      unaccounted,
      `these tables exist but the seed manifest does not mention them:\n  ${unaccounted.join('\n  ')}`,
    ).toEqual([])
  })

  it('names no table that does not exist', () => {
    // The other direction. A manifest entry for a table that was renamed or
    // dropped would make the check above pass while the seed wrote nowhere.
    const real = new Set(schema)
    const phantom = ALL_TABLES.filter((t) => !real.has(t))
    expect(phantom, `manifest names tables no migration creates: ${phantom.join(', ')}`).toEqual([])
  })

  it('classifies each table exactly once', () => {
    const counts = new Map()
    for (const t of ALL_TABLES) counts.set(t, (counts.get(t) ?? 0) + 1)
    const duplicated = [...counts].filter(([, n]) => n > 1).map(([t]) => t)
    expect(duplicated).toEqual([])
  })
})

describe('the four credential tables are refused by name', () => {
  it.each([
    ['sessions'],
    ['refresh_tokens'],
    ['otp_challenges'],
    ['password_reset_tokens'],
  ])('%s is on the never-seed list', (table) => {
    expect(isForbidden(table)).toBe(true)
    // With a stated reason: a list of names with no reasons is a list nobody
    // dares change, and therefore one that goes stale.
    expect(NEVER_SEEDED[table]).toBeTruthy()
  })

  it('does NOT forbid the tables the seed must write', () => {
    // Counter-assertion: a manifest that forbade everything would pass the
    // four assertions above.
    for (const table of ['members', 'offers', 'events', 'audit_log']) {
      expect(isForbidden(table), table).toBe(false)
    }
  })

  it('keeps the three categories disjoint', () => {
    const never = Object.keys(NEVER_SEEDED)
    expect(SEEDED.filter((t) => HISTORY.includes(t))).toEqual([])
    expect(SEEDED.filter((t) => never.includes(t))).toEqual([])
    expect(HISTORY.filter((t) => never.includes(t))).toEqual([])
  })
})

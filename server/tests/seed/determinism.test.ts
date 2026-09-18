import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withSeededDatabase } from './helpers.ts'
import { hasDatabase } from '../helpers/db.ts'

/**
 * SC-003 — two runs, two databases, one result.
 *
 * This is what separates a seeder from a random data generator: without it a
 * screenshot goes stale, a bug report cannot be reproduced, and the credential
 * table changes under the person reading it.
 */

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** A fingerprint of everything generated, order-independent of insertion. */
const FINGERPRINT = `
  SELECT md5(
    (SELECT coalesce(string_agg(email || '|' || coalesce(display_name,'') || '|' || status, ',' ORDER BY email), '') FROM members) ||
    (SELECT coalesce(string_agg(email || '|' || coalesce(display_name,''), ',' ORDER BY email), '') FROM admin_users) ||
    (SELECT coalesce(string_agg(slug || '|' || legal_name || '|' || status, ',' ORDER BY slug), '') FROM organisations) ||
    (SELECT coalesce(string_agg(title || '|' || state, ',' ORDER BY title, id::text), '') FROM offers) ||
    (SELECT coalesce(string_agg(slug || '|' || title || '|' || state, ',' ORDER BY slug), '') FROM events)
  ) AS fingerprint`

describe.skipIf(!hasDatabase)('the same command gives the same database', () => {
  it('produces identical data on two fresh databases', async () => {
    const a = await withSeededDatabase('gwc_seed_det_a')
    const b = await withSeededDatabase('gwc_seed_det_b')
    try {
      const [{ rows: ra }, { rows: rb }] = await Promise.all([
        a.pool.query(FINGERPRINT),
        b.pool.query(FINGERPRINT),
      ])
      expect(ra[0].fingerprint).toBe(rb[0].fingerprint)
      // Counter-assertion: the fingerprint is of something. Two empty
      // databases would also match.
      expect(ra[0].fingerprint).toBeTruthy()
      const { rows } = await a.pool.query('SELECT count(*)::int AS n FROM members')
      expect(rows[0].n).toBeGreaterThan(50)
    } finally {
      await a.drop()
      await b.drop()
    }
  }, 300_000)

  it('produces DIFFERENT data with --random, and says so', async () => {
    // Without this, a generator emitting constants would satisfy the test
    // above perfectly.
    const fixed = await withSeededDatabase('gwc_seed_det_fixed')
    const random = await withSeededDatabase('gwc_seed_det_random', { args: ['--random'] })
    try {
      const [{ rows: rf }, { rows: rr }] = await Promise.all([
        fixed.pool.query(FINGERPRINT),
        random.pool.query(FINGERPRINT),
      ])
      expect(rr[0].fingerprint).not.toBe(rf[0].fingerprint)

      // And it must say so, or a varying run could be mistaken for a
      // reproducible one.
      expect(random.stdout).toMatch(/RANDOMISED/)
      expect(random.stdout).toMatch(/not reproducible/)
      expect(fixed.stdout).toMatch(/deterministic/)
    } finally {
      await fixed.drop()
      await random.drop()
    }
  }, 300_000)
})

describe('every generator draws from the one seeded instance', () => {
  /**
   * T041. `faker.js` creates one seeded `Faker` and every generator takes it as
   * an argument. A module that imported the package's default `faker` instead
   * would draw from an *unseeded* generator: its own output would vary run to
   * run while every other module stayed fixed, so the fingerprint above would
   * differ and the failure would point at determinism generally rather than at
   * the one import that caused it.
   */
  const SEED_DIR = join(SERVER, 'src', 'seed')
  const sources = readdirSync(SEED_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'faker.ts')
    .map((f) => [f, readFileSync(join(SEED_DIR, f), 'utf8')])

  it('reads the generators — a scan of no files finds no offenders', () => {
    expect(sources.length).toBeGreaterThan(5)
  })

  it.each(sources.map(([name]) => name))('%s does not import @faker-js/faker directly', (name) => {
    const [, body] = sources.find(([f]) => f === name)
    expect(body).not.toMatch(/from\s+['"]@faker-js\/faker['"]/)
  })

  it('leaves exactly one module holding the import', () => {
    // Counter-assertion: if nothing imported Faker anywhere, every case above
    // would pass and there would be no generator at all.
    const faker = readFileSync(join(SEED_DIR, 'faker.ts'), 'utf8')
    expect(faker).toMatch(/from\s+['"]@faker-js\/faker['"]/)
    expect(faker).toMatch(/\.seed\(/)
  })
})

describe('the generator version is pinned', () => {
  it('pins faker exactly, not by range', () => {
    // The pin is load-bearing, not hygiene: Faker's output for a given seed
    // shifts between versions as locale data changes, so a caret range would
    // silently change every generated name on the next install — with no
    // commit to point at.
    const pkg = JSON.parse(readFileSync(join(SERVER, 'package.json'), 'utf8'))
    const version = pkg.dependencies['@faker-js/faker']
    expect(version).toBeTruthy()
    expect(version, `@faker-js/faker is "${version}" — must be an exact version`).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

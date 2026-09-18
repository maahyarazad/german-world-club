import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { listMigrations, isCurrent } from '../../src/db/migrate.ts'
import { createPool } from '../../src/db/pool.ts'
import { loadEnv } from '../../src/config/env.ts'

/**
 * The constraints this platform relies on exist only in the real engine — a
 * partial unique index, an append-only trigger, a CHECK that ties state to a
 * failure reason — so nothing here is mocked (research R20).
 */
let pool: pg.Pool
beforeAll(() => { pool = createPool(loadEnv()) })
afterAll(async () => { await pool.end() })

describe('migrations', () => {
  it('applies every migration on disk', async () => {
    const status = await isCurrent(pool)
    expect(status.ok, `pending: ${status.pending?.join(', ')}`).toBe(true)
  })

  it('applies in filename order', async () => {
    const files = await listMigrations()
    expect(files).toEqual([...files].sort())
    expect(files[0]).toMatch(/^001_/)
  })

  it('is idempotent — a second run applies nothing', async () => {
    const { up } = await import('../../src/db/migrate.ts')
    const applied = await up({ connectionString: loadEnv().DATABASE_URL, log: () => {} })
    expect(applied).toEqual([])
  })
})

describe('enum types (G4)', () => {
  it.each([
    'account_kind', 'member_status', 'approval_state', 'seo_record_type',
    'asset_kind', 'asset_state', 'asset_variant', 'admin_module',
  ])('creates %s before any table references it', async (name) => {
    const { rows } = await pool.query('SELECT 1 FROM pg_type WHERE typname = $1', [name])
    expect(rows).toHaveLength(1)
  })
})

describe('audit_log is append-only (Constitution Principle IV)', () => {
  it('accepts an insert', async () => {
    const { rows } = await pool.query(
      `INSERT INTO audit_log (action, outcome) VALUES ('test_insert', 'allowed') RETURNING id`,
    )
    expect(rows[0].id).toBeTruthy()
  })

  it('refuses an UPDATE at the database level, not by convention', async () => {
    await pool.query(`INSERT INTO audit_log (action, outcome) VALUES ('test_update', 'allowed')`)
    await expect(
      pool.query(`UPDATE audit_log SET outcome = 'denied' WHERE action = 'test_update'`),
    ).rejects.toThrow(/append-only/)
  })

  it('refuses a DELETE at the database level', async () => {
    await pool.query(`INSERT INTO audit_log (action, outcome) VALUES ('test_delete', 'allowed')`)
    await expect(
      pool.query(`DELETE FROM audit_log WHERE action = 'test_delete'`),
    ).rejects.toThrow(/append-only/)
  })
})

describe('asset constraints (Principle VI)', () => {
  const insert = (over = {}) => {
    const a = {
      kind: 'image', mime: 'image/jpeg', checksum: Buffer.from(Math.random().toString()),
      bytes: 2_000_000, width: 4000, height: 3000, alt: 'A test photograph',
      state: 'ready', storage_key: 'ab/cd/test', ...over,
    }
    return pool.query(
      `INSERT INTO assets (kind, mime, checksum, bytes, width, height, alt, state, failure_reason, storage_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [a.kind, a.mime, a.checksum, a.bytes, a.width, a.height, a.alt, a.state, a.failure_reason ?? null, a.storage_key],
    )
  }

  it('requires alt text — §10.1 calls out galleries needing it', async () => {
    await expect(insert({ alt: '   ' })).rejects.toThrow()
  })

  it('requires positive dimensions, since FR-018 needs them at first render', async () => {
    await expect(insert({ width: 0 })).rejects.toThrow()
  })

  it('stores identical content once (content-addressed dedupe)', async () => {
    // A fresh checksum per run: the scratch database is not reset between
    // runs, so a fixed value would fail on the *first* insert the second time.
    const checksum = Buffer.from(`dedupe-${Date.now()}-${Math.random()}`)
    await insert({ checksum })
    await expect(insert({ checksum })).rejects.toThrow(/duplicate key/)
  })

  it('refuses a failed asset with no reason, so nothing sits stuck (FR-059)', async () => {
    await expect(insert({ state: 'failed', failure_reason: null })).rejects.toThrow(/failure_reason_matches_state/)
  })

  it('refuses a ready asset that carries a failure reason', async () => {
    await expect(insert({ state: 'ready', failure_reason: 'but it worked?' })).rejects.toThrow(/failure_reason_matches_state/)
  })

  it('requires a variant to record its own format, dimensions and bytes (FR-061)', async () => {
    const { rows } = await insert()
    await expect(
      pool.query(
        `INSERT INTO asset_variants (asset_id, variant, format, width, height, bytes, storage_key)
         VALUES ($1, 'medium', 'gif', 800, 600, 40000, 'k')`,
        [rows[0].id],
      ),
    ).rejects.toThrow(/format/)
  })
})

describe('seo_metadata constraints', () => {
  it('keeps slugs unique per record type — a collision would 500 a paid partner page', async () => {
    const a = '11111111-1111-1111-1111-111111111111'
    const b = '22222222-2222-2222-2222-222222222222'
    await pool.query(
      `INSERT INTO seo_metadata (record_type, record_id, slug) VALUES ('partner', $1, 'mueller-legal')
       ON CONFLICT DO NOTHING`, [a],
    )
    await expect(
      pool.query(`INSERT INTO seo_metadata (record_type, record_id, slug) VALUES ('partner', $1, 'mueller-legal')`, [b]),
    ).rejects.toThrow(/duplicate key/)
  })
})

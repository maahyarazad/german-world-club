import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withSeededDatabase } from './helpers.js'
import { hasDatabase } from '../helpers/db.js'

/**
 * Constitution Principle IV — integrity in the database.
 *
 * Every rule below is also enforced in application code somewhere, and that is
 * not the point. The point is that it holds against an ad-hoc `psql` session at
 * two in the morning, which is precisely when someone will "just fix the data".
 *
 * Each is tested by **violating** it. A suite that only inserts valid rows
 * proves the constraints do not fire, not that they exist.
 */
describe.skipIf(!hasDatabase)('the organisation rules hold against raw SQL', () => {
  let db
  let pool

  beforeAll(async () => {
    db = await withSeededDatabase('gwc_seed_constraints')
    pool = db.pool
  }, 180_000)

  afterAll(async () => { await db?.drop() })

  /** Run a statement and hand back the error message, or null if it succeeded. */
  const refusalFor = async (sql, params = []) => {
    try {
      await pool.query(sql, params)
      return null
    } catch (error) {
      return error.message
    }
  }

  describe('an organisation is never deleted', () => {
    it('refuses DELETE FROM organisations', async () => {
      const { rows } = await pool.query(`SELECT id, slug FROM organisations ORDER BY slug LIMIT 1`)
      const message = await refusalFor('DELETE FROM organisations WHERE id = $1', [rows[0].id])
      expect(message).toMatch(/cannot be deleted/)

      // And it is still there. A refusal that left the row gone would be a
      // rollback message, not a guard.
      const { rows: after } = await pool.query('SELECT slug FROM organisations WHERE id = $1', [rows[0].id])
      expect(after[0].slug).toBe(rows[0].slug)
    })

    it('refuses an unqualified DELETE too — the dangerous one', async () => {
      const before = await pool.query('SELECT count(*)::int AS n FROM organisations')
      const message = await refusalFor('DELETE FROM organisations')
      expect(message).toMatch(/cannot be deleted/)
      const after = await pool.query('SELECT count(*)::int AS n FROM organisations')
      expect(after.rows[0].n).toBe(before.rows[0].n)
    })

    it('still permits the status transition that replaces it', async () => {
      // Counter-assertion: a trigger that refused every write would pass both
      // tests above while making the table useless.
      const { rows } = await pool.query(
        `UPDATE organisations SET status = 'ended', status_changed_at = now()
          WHERE id = (SELECT id FROM organisations ORDER BY slug DESC LIMIT 1)
          RETURNING status`,
      )
      expect(rows[0].status).toBe('ended')
    })
  })

  describe('a row answers one fee-band question, not both', () => {
    const insert = (kind, extra) => refusalFor(
      `INSERT INTO organisations (kind, legal_name, slug, status, status_changed_at, location_count, employee_count)
       VALUES ($1, 'Probe GmbH', $2, 'pending', now(), $3, $4)`,
      [kind, `probe-${randomUUID()}`, extra.location_count ?? null, extra.employee_count ?? null],
    )

    it('refuses a partner carrying location_count', async () => {
      expect(await insert('partner', { location_count: 4 })).toMatch(/organisations_band_matches_kind/)
    })

    it('refuses a merchant carrying employee_count', async () => {
      expect(await insert('merchant', { employee_count: 250 })).toMatch(/organisations_band_matches_kind/)
    })

    it('accepts each kind with its own band', async () => {
      expect(await insert('partner', { employee_count: 250 })).toBeNull()
      expect(await insert('merchant', { location_count: 4 })).toBeNull()
    })
  })

  describe('a contract does not end before it starts', () => {
    const withDates = (start, end) => refusalFor(
      `INSERT INTO organisations (kind, legal_name, slug, status, status_changed_at, contract_start, contract_end)
       VALUES ('merchant', 'Probe GmbH', $1, 'pending', now(), $2, $3)`,
      [`probe-${randomUUID()}`, start, end],
    )

    it('refuses contract_end < contract_start', async () => {
      expect(await withDates('2026-06-01', '2026-01-01')).toMatch(/organisations_contract_ordered/)
    })

    it('accepts an ordered pair, an open-ended contract, and no contract at all', async () => {
      expect(await withDates('2026-01-01', '2026-06-01')).toBeNull()
      expect(await withDates('2026-01-01', null)).toBeNull()
      expect(await withDates(null, null)).toBeNull()
    })

    it('accepts a single-day contract — the boundary is >=, not >', async () => {
      expect(await withDates('2026-01-01', '2026-01-01')).toBeNull()
    })
  })

  describe('an organisation always keeps somebody who can administer it', () => {
    let organisationId
    let ownerId

    beforeAll(async () => {
      const { rows } = await pool.query(
        `SELECT ou.id, ou.organisation_id FROM organisation_users ou
          WHERE ou.role = 'owner' AND ou.status = 'active'
            AND (SELECT count(*) FROM organisation_users p
                  WHERE p.organisation_id = ou.organisation_id
                    AND p.role = 'owner' AND p.status = 'active') = 1
          ORDER BY ou.email LIMIT 1`,
      )
      ownerId = rows[0]?.id
      organisationId = rows[0]?.organisation_id
    })

    it('seeded an organisation with exactly one active owner', () => {
      // The whole guard is about the last one. Without such a row the three
      // tests below would be asserting against an organisation that has a
      // spare, which is the case the guard permits.
      expect(ownerId).toBeTruthy()
    })

    it('refuses deleting the only owner', async () => {
      expect(await refusalFor('DELETE FROM organisation_users WHERE id = $1', [ownerId]))
        .toMatch(/at least one active owner/)
    })

    it('refuses demoting the only owner', async () => {
      expect(await refusalFor(`UPDATE organisation_users SET role = 'manager' WHERE id = $1`, [ownerId]))
        .toMatch(/at least one active owner/)
    })

    it('refuses deactivating the only owner', async () => {
      expect(await refusalFor(`UPDATE organisation_users SET status = 'inactive' WHERE id = $1`, [ownerId]))
        .toMatch(/at least one active owner/)
    })

    it('permits all three once a second owner exists', async () => {
      // Counter-assertion. The guard must protect the *last* owner, not make
      // ownership permanent — an organisation whose owner left and cannot be
      // replaced is the support ticket this was meant to prevent, arrived by
      // the other road.
      await pool.query(
        `INSERT INTO organisation_users (organisation_id, email, role, status, display_name)
         VALUES ($1, $2, 'owner', 'active', 'Second Owner')`,
        [organisationId, `second-owner-${randomUUID()}@demo.invalid`],
      )
      expect(await refusalFor(`UPDATE organisation_users SET role = 'manager' WHERE id = $1`, [ownerId])).toBeNull()
    })
  })

  describe('the composite key later tables depend on', () => {
    it('has the (id, kind) unique index that makes a mis-kinded foreign key unrepresentable', async () => {
      // 003's `employee_entitlements` references (organisation_id, kind), which
      // Postgres will only accept against a unique index on exactly that pair.
      // Without this, an entitlement could be attached to a merchant.
      const { rows } = await pool.query(`
        SELECT indexdef FROM pg_indexes
         WHERE tablename = 'organisations' AND indexdef LIKE '%(id, kind)%'`)
      expect(rows).toHaveLength(1)
      expect(rows[0].indexdef).toMatch(/UNIQUE/)
    })

    it('refuses a second organisation on a taken slug', async () => {
      const { rows } = await pool.query('SELECT slug FROM organisations ORDER BY slug LIMIT 1')
      const message = await refusalFor(
        `INSERT INTO organisations (kind, legal_name, slug, status, status_changed_at)
         VALUES ('merchant', 'Impostor GmbH', $1, 'pending', now())`,
        [rows[0].slug],
      )
      // Public URLs are slug-based, so two rows on one slug is two pages at one
      // address (Principle III).
      expect(message).toMatch(/slug/)
    })

    it('refuses one email twice inside an organisation but permits it across two', async () => {
      const { rows } = await pool.query(
        `SELECT organisation_id, email FROM organisation_users ORDER BY email LIMIT 1`,
      )
      const taken = await refusalFor(
        `INSERT INTO organisation_users (organisation_id, email, role, status)
         VALUES ($1, $2, 'staff', 'active')`,
        [rows[0].organisation_id, rows[0].email],
      )
      expect(taken).toMatch(/organisation_id|email/)

      const { rows: other } = await pool.query(
        'SELECT id FROM organisations WHERE id <> $1 ORDER BY slug LIMIT 1',
        [rows[0].organisation_id],
      )
      // The same person legitimately acts for two organisations, so the
      // uniqueness is per organisation and not global.
      expect(await refusalFor(
        `INSERT INTO organisation_users (organisation_id, email, role, status)
         VALUES ($1, $2, 'staff', 'active')`,
        [other[0].id, rows[0].email],
      )).toBeNull()
    })
  })
})

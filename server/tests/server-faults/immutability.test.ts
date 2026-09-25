import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import pg from 'pg'
import { hasDatabase, resetServerFaults } from '../helpers/db.ts'

/**
 * Feature 012, data-model.md §1–§2: a fault record is never edited, and nothing
 * younger than 30 days can be deleted — enforced by the database, so it holds
 * against raw SQL too (Principle IV).
 */
describe.skipIf(!hasDatabase)('server fault tables hold their invariants against raw SQL', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  let n = 0
  const ulid = () => `01J8Z3K2QX${String(++n).padStart(16, '0')}`

  const insertFault = (age: string) =>
    pool.query(
      `INSERT INTO server_faults (occurred_at, request_id, method, route, status, error_name, message, fingerprint, instance_id)
       VALUES (now() - $1::interval, $2, 'GET', '/x', 500, 'Error', 'boom', repeat('a', 64), 'test:1')
       RETURNING id`,
      [age, ulid()],
    ).then((r) => r.rows[0].id)

  beforeAll(async () => { await resetServerFaults(pool) })
  beforeEach(async () => { await resetServerFaults(pool) })
  afterAll(async () => { await resetServerFaults(pool); await pool.end() })

  it('refuses any update to a fault record', async () => {
    const id = await insertFault('0 seconds')
    await expect(pool.query(`UPDATE server_faults SET message = 'rewritten' WHERE id = $1`, [id]))
      .rejects.toThrow(/never edited/)
  })

  it('refuses to delete a fault younger than 30 days', async () => {
    const id = await insertFault('29 days')
    await expect(pool.query('DELETE FROM server_faults WHERE id = $1', [id])).rejects.toThrow(/30 days/)
  })

  it('deletes an expired fault', async () => {
    // Counter-assertion: a trigger refusing every delete would pass the test above.
    const id = await insertFault('31 days')
    const { rowCount } = await pool.query('DELETE FROM server_faults WHERE id = $1', [id])
    expect(rowCount).toBe(1)
  })

  it('refuses a request id that is not a server ULID', async () => {
    await expect(pool.query(
      `INSERT INTO server_faults (request_id, method, status, error_name, message, fingerprint, instance_id)
       VALUES ('client-supplied-1234', 'GET', 500, 'Error', 'boom', repeat('a', 64), 'test:1')`,
    )).rejects.toThrow(/check constraint/)
  })

  it('floors suppression deletes the same way, but lets the counter move', async () => {
    await pool.query(
      `INSERT INTO server_fault_suppressions (minute, instance_id, suppressed)
       VALUES (date_trunc('minute', now()), 'test:1', 3),
              (date_trunc('minute', now() - interval '31 days'), 'test:1', 5)`,
    )
    await expect(pool.query(
      `DELETE FROM server_fault_suppressions WHERE minute > now() - interval '1 day'`,
    )).rejects.toThrow(/30 days/)
    // The flush's upsert is the one legitimate update.
    await pool.query(
      `UPDATE server_fault_suppressions SET suppressed = suppressed + 2 WHERE minute > now() - interval '1 day'`,
    )
    const { rowCount } = await pool.query(
      `DELETE FROM server_fault_suppressions WHERE minute < now() - interval '30 days'`,
    )
    expect(rowCount).toBe(1)
  })
})

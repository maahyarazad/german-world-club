import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { hasDatabase, resetReferrals } from '../helpers/db.ts'

/**
 * The link rules hold in the database itself (data-model.md, Principle IV):
 * a hand-typed UPDATE in psql is held to the same rules as the application.
 */
describe.skipIf(!hasDatabase)('referral_links in the database', () => {
  let pool: pg.Pool
  const owner = randomUUID()

  beforeAll(() => { pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }) })
  afterAll(async () => { await pool.end() })
  beforeEach(async () => { await resetReferrals(pool) })

  const insert = (code: string, id = owner) =>
    pool.query(`INSERT INTO referral_links (owner_kind, owner_id, code) VALUES ('member', $1, $2) RETURNING id`, [id, code])

  it('allows active → retired', async () => {
    // Counter-assertion: the refusals below are about the transition, not about updates at all.
    const { rows: [link] } = await insert('ABCDEFGH')
    await pool.query(`UPDATE referral_links SET state = 'retired', state_changed_at = now() WHERE id = $1`, [link.id])
    const { rows } = await pool.query('SELECT state FROM referral_links WHERE id = $1', [link.id])
    expect(rows[0].state).toBe('retired')
  })

  it('refuses retired → active', async () => {
    const { rows: [link] } = await insert('ABCDEFGH')
    await pool.query(`UPDATE referral_links SET state = 'retired', state_changed_at = now() WHERE id = $1`, [link.id])
    await expect(pool.query(
      `UPDATE referral_links SET state = 'active', state_changed_at = NULL WHERE id = $1`, [link.id],
    )).rejects.toThrow(/already retired/)
  })

  it('refuses changing a code', async () => {
    const { rows: [link] } = await insert('ABCDEFGH')
    await expect(pool.query(`UPDATE referral_links SET code = 'ZZZZZZZZ' WHERE id = $1`, [link.id]))
      .rejects.toThrow(/never change/)
  })

  it('refuses DELETE', async () => {
    const { rows: [link] } = await insert('ABCDEFGH')
    await expect(pool.query('DELETE FROM referral_links WHERE id = $1', [link.id])).rejects.toThrow(/never deleted/)
  })

  it('refuses a second active link for the same person', async () => {
    await insert('ABCDEFGH')
    await expect(insert('ABCDEFGJ')).rejects.toThrow(/referral_links_one_active/)
  })

  it('refuses reissuing a retired code to somebody else', async () => {
    const { rows: [link] } = await insert('ABCDEFGH')
    await pool.query(`UPDATE referral_links SET state = 'retired', state_changed_at = now() WHERE id = $1`, [link.id])
    await expect(insert('ABCDEFGH', randomUUID())).rejects.toThrow(/referral_links_code_key/)
  })

  it('refuses disabling without a staff member and a reason', async () => {
    const { rows: [link] } = await insert('ABCDEFGH')
    await expect(pool.query(
      `UPDATE referral_links SET state = 'disabled', state_changed_at = now() WHERE id = $1`, [link.id],
    )).rejects.toThrow(/referral_links_disabled_says_who_and_why/)
  })
})

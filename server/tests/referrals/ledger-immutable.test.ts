import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { hasDatabase, resetReferrals } from '../helpers/db.ts'

/**
 * FR-014: the XP history cannot be edited or deleted by anyone — and "anyone"
 * includes a hand-typed statement in psql, which is why these are triggers
 * and this suite talks to the database directly.
 */
describe.skipIf(!hasDatabase)('the referral ledgers are append-only', () => {
  let pool: pg.Pool
  let ids: { member: string; owner: string; referral: string; award: string; admin: string }

  beforeAll(() => { pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }) })
  afterAll(async () => {
    await resetReferrals(pool)
    await pool.query(`ALTER TABLE members DISABLE TRIGGER members_refuse_delete`)
    await pool.query(`DELETE FROM members WHERE email LIKE 'ledger-%@test.invalid'`)
    await pool.query(`ALTER TABLE members ENABLE TRIGGER members_refuse_delete`)
    await pool.query(`ALTER TABLE admin_users DISABLE TRIGGER admin_users_superadmin_guard`)
    await pool.query(`DELETE FROM admin_users WHERE email LIKE 'ledger-%@test.invalid'`)
    await pool.query(`ALTER TABLE admin_users ENABLE TRIGGER admin_users_superadmin_guard`)
    await pool.end()
  })

  beforeEach(async () => {
    await resetReferrals(pool)
    const owner = randomUUID()
    const { rows: [m] } = await pool.query(
      `INSERT INTO members (email, status) VALUES ($1, 'active') RETURNING id`, [`ledger-${randomUUID()}@test.invalid`],
    )
    const { rows: [a] } = await pool.query(
      `INSERT INTO admin_users (email, password_hash) VALUES ($1, 'x') RETURNING id`, [`ledger-${randomUUID()}@test.invalid`],
    )
    const { rows: [l] } = await pool.query(
      `INSERT INTO referral_links (owner_kind, owner_id, code) VALUES ('member', $1, 'ABCDEFGH') RETURNING id`, [owner],
    )
    const { rows: [r] } = await pool.query(
      `INSERT INTO referrals (link_id, referrer_kind, referrer_id, referee_member_id) VALUES ($1, 'member', $2, $3) RETURNING id`,
      [l.id, owner, m.id],
    )
    const { rows: [e] } = await pool.query(
      `INSERT INTO xp_entries (owner_kind, owner_id, kind, amount, referral_id, rate_id, reason)
       SELECT 'member', $1, 'award', 100, $2, id, 'referral' FROM referral_xp_rates LIMIT 1 RETURNING id`,
      [owner, r.id],
    )
    ids = { member: m.id, owner, referral: r.id, award: e.id, admin: a.id }
  })

  const reversal = (amount: number, target = () => ids.award) => pool.query(
    `INSERT INTO xp_entries (owner_kind, owner_id, kind, amount, referral_id, reverses_entry_id, reason, created_by)
     VALUES ('member', $1, 'reversal', $2, $3, $4, 'test', $5) RETURNING id`,
    [ids.owner, amount, ids.referral, target(), ids.admin],
  )

  it('accepts new entries', async () => {
    // Counter-assertion: the refusals below are about changing history, not about writing at all.
    await expect(reversal(-100)).resolves.toBeDefined()
    const { rows } = await pool.query('SELECT SUM(amount)::int AS s FROM xp_entries WHERE owner_id = $1', [ids.owner])
    expect(rows[0].s).toBe(0)
  })

  for (const [table, update] of [
    ['xp_entries', 'UPDATE xp_entries SET amount = 1'],
    ['referrals', 'UPDATE referrals SET created_at = now()'],
    ['referral_xp_rates', 'UPDATE referral_xp_rates SET xp = 1'],
  ] as const) {
    it(`refuses UPDATE on ${table}`, async () => {
      await expect(pool.query(update)).rejects.toThrow(new RegExp(`${table} is append-only: UPDATE`))
    })
    it(`refuses DELETE on ${table}`, async () => {
      await expect(pool.query(`DELETE FROM ${table}`)).rejects.toThrow(/is append-only: DELETE|violates foreign key/)
    })
  }

  it('refuses a reversal for the wrong amount', async () => {
    await expect(reversal(-50)).rejects.toThrow(/exactly the amount awarded/)
  })

  it('refuses reversing a reversal', async () => {
    const { rows: [first] } = await reversal(-100)
    await expect(reversal(100, () => first.id)).rejects.toThrow(/xp_entries_reversal_shape|only an award/)
  })

  it('refuses reversing one award twice', async () => {
    await reversal(-100)
    await expect(reversal(-100)).rejects.toThrow(/xp_entries_reverses_entry_id_key/)
  })

  it('refuses an award paid to somebody other than the referrer', async () => {
    await expect(pool.query(
      `INSERT INTO xp_entries (owner_kind, owner_id, kind, amount, referral_id, rate_id, reason)
       SELECT 'member', $1, 'award', 100, $2, id, 'referral' FROM referral_xp_rates LIMIT 1`,
      [randomUUID(), ids.referral],
    )).rejects.toThrow(/belongs to that referral's referrer/)
  })
})

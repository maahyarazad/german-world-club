import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resetAuthTables, createAdmin } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, memberOwner, linkOf, registerAndVerify } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-013 / FR-015 / SC-004: the balance is always the sum of the history, and
 * a change of rate never rewrites what was already earned.
 */
describe.skipIf(!hasDatabase)('XP balance and history', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]

  beforeAll(async () => { ({ app, sms } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
  })

  const sumOf = async (ownerId: string) => {
    const { rows } = await app.pg.query('SELECT COALESCE(SUM(amount), 0)::int AS s FROM xp_entries WHERE owner_id = $1', [ownerId])
    return rows[0].s as number
  }

  it('keeps the balance equal to the history through an award, a reversal and a rate change', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)

    await registerAndVerify(app, sms, { referralCode: link.code })
    const afterAward = (await linkOf(app, owner)).xpBalance
    expect(afterAward).toBe(100)
    expect(afterAward).toBe(await sumOf(owner.id))

    // A reversal, as staff would write it.
    const admin = await createAdmin(app.pg)
    await app.pg.query(
      `INSERT INTO xp_entries (owner_kind, owner_id, kind, amount, referral_id, reverses_entry_id, reason, created_by)
       SELECT owner_kind, owner_id, 'reversal', -amount, referral_id, id, 'fake account', $2
         FROM xp_entries WHERE owner_id = $1 AND kind = 'award'`,
      [owner.id, admin.id],
    )
    expect((await linkOf(app, owner)).xpBalance).toBe(0)
    expect(await sumOf(owner.id)).toBe(0)

    // A new rate, then a new referral.
    await app.pg.query(`INSERT INTO referral_xp_rates (xp, set_by, reason) VALUES (150, $1, 'campaign')`, [admin.id])
    await registerAndVerify(app, sms, { referralCode: link.code })
    expect((await linkOf(app, owner)).xpBalance).toBe(150)
    expect(await sumOf(owner.id)).toBe(150)

    const history = await app.inject({ method: 'GET', url: '/referrals/xp', headers: owner.headers })
    expect(history.statusCode).toBe(200)
    const amounts = history.json().items.map((e: { kind: string; amount: number }) => [e.kind, e.amount])
    // Newest first; the first award kept its 100 after the rate changed.
    expect(amounts).toEqual([['award', 150], ['reversal', -100], ['award', 100]])
    const reversed = history.json().items.find((e: { kind: string; amount: number }) => e.kind === 'award' && e.amount === 100)
    expect(reversed.reversed).toBe(true)
  })

  it('starts at zero', async () => {
    // Counter-assertion: the balances above are earned, not defaulted.
    const owner = await memberOwner(app)
    expect((await linkOf(app, owner)).xpBalance).toBe(0)
    const history = await app.inject({ method: 'GET', url: '/referrals/xp', headers: owner.headers })
    expect(history.json()).toEqual({ items: [], nextCursor: null })
  })

  it('pages the history without repeating or skipping an entry', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    // 55 awards, inserted directly: 55 registrations would test onboarding, not paging.
    const { rows: [l] } = await app.pg.query('SELECT id FROM referral_links WHERE code = $1', [link.code])
    for (let i = 0; i < 55; i++) {
      const { rows: [m] } = await app.pg.query(
        `INSERT INTO members (email, status, display_name) VALUES ($1, 'active', 'Paged Person') RETURNING id`,
        [`paged-${i}-${owner.id}@test.invalid`],
      )
      const { rows: [r] } = await app.pg.query(
        `INSERT INTO referrals (link_id, referrer_kind, referrer_id, referee_member_id) VALUES ($1, 'member', $2, $3) RETURNING id`,
        [l.id, owner.id, m.id],
      )
      await app.pg.query(
        `INSERT INTO xp_entries (owner_kind, owner_id, kind, amount, referral_id, rate_id, reason)
         SELECT 'member', $1, 'award', 100, $2, id, 'referral' FROM referral_xp_rates LIMIT 1`,
        [owner.id, r.id],
      )
    }
    const seen = new Set<string>()
    let cursor: string | null = null
    let pages = 0
    do {
      const url: string = `/referrals/xp${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
      const page = (await app.inject({ method: 'GET', url, headers: owner.headers })).json()
      for (const item of page.items) seen.add(item.id)
      cursor = page.nextCursor
      pages++
    } while (cursor)
    expect(seen.size).toBe(55)
    expect(pages).toBe(2)
  })
})

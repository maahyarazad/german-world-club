import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { REFERRAL_CODE } from '@gwc/contracts/referrals'
import { resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, memberOwner, orgOwner, staffOwner, linkOf } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * US1: every principal has one stable personal link (FR-001–FR-003).
 */
describe.skipIf(!hasDatabase)('referral links', () => {
  let app: GwcApp

  beforeAll(async () => { ({ app } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => { await resetAuthTables(app.pg) })

  it('creates the link on first read and returns the same one afterwards', async () => {
    const owner = await memberOwner(app)
    const first = await linkOf(app, owner)
    const second = await linkOf(app, owner)

    expect(first.link.code).toMatch(REFERRAL_CODE)
    expect(first.link.url).toMatch(new RegExp(`/r/${first.link.code}$`))
    expect(second.link.code).toBe(first.link.code)
    expect(first.xpBalance).toBe(0)
    expect(first.counts).toEqual({ registered: 0, approved: 0, joined: 0, did_not_join: 0 })
  })

  it('gives two people two different codes', async () => {
    // Counter-assertion: the stable code above is per person, not a constant.
    const [a, b] = [await memberOwner(app), await memberOwner(app)]
    expect((await linkOf(app, a)).link.code).not.toBe((await linkOf(app, b)).link.code)
  })

  it('creates exactly one active link when the first reads race', async () => {
    const owner = await memberOwner(app)
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => app.inject({ method: 'GET', url: owner.prefix, headers: owner.headers })),
    )
    expect(responses.map((r) => r.statusCode)).toEqual(Array(10).fill(200))
    expect(new Set(responses.map((r) => r.json().link.code)).size).toBe(1)
    const { rows } = await app.pg.query(
      `SELECT count(*)::int AS n FROM referral_links WHERE owner_id = $1 AND state = 'active'`, [owner.id],
    )
    expect(rows[0].n).toBe(1)
  })

  it('replaces the link: a new code, the old one retired, nothing else changed', async () => {
    const owner = await memberOwner(app)
    const before = await linkOf(app, owner)
    const replaced = await app.inject({ method: 'POST', url: `${owner.prefix}/link/replace`, headers: owner.headers })
    expect(replaced.statusCode).toBe(200)
    expect(replaced.json().link.code).not.toBe(before.link.code)

    const { rows } = await app.pg.query(
      'SELECT code, state FROM referral_links WHERE owner_id = $1 ORDER BY created_at', [owner.id],
    )
    expect(rows).toEqual([
      { code: before.link.code, state: 'retired' },
      { code: replaced.json().link.code, state: 'active' },
    ])
    // The next read is the new link, not a third one.
    expect((await linkOf(app, owner)).link.code).toBe(replaced.json().link.code)
  })

  it('gives merchant, partner and staff principals their own link on their own mount', async () => {
    const owners = [await orgOwner(app, 'merchant'), await orgOwner(app, 'partner'), await staffOwner(app)]
    const codes = []
    for (const owner of owners) {
      const summary = await linkOf(app, owner)
      const { rows } = await app.pg.query(
        'SELECT owner_kind, owner_id FROM referral_links WHERE code = $1', [summary.link.code],
      )
      expect(rows[0]).toEqual({ owner_kind: owner.kind, owner_id: owner.id })
      codes.push(summary.link.code)
    }
    expect(new Set(codes).size).toBe(3)
  })

  it('does not let one audience use another audience\'s mount', async () => {
    const merchant = await orgOwner(app, 'merchant')
    const member = await memberOwner(app)
    expect((await app.inject({ method: 'GET', url: '/referrals', headers: merchant.headers })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/referrals/merchant', headers: member.headers })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/referrals' })).statusCode).toBe(401)
  })

  it('records creation and replacement in the audit log by link id, never by code', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    await app.inject({ method: 'POST', url: `${owner.prefix}/link/replace`, headers: owner.headers })
    const { rows } = await app.pg.query(
      `SELECT action, detail::text AS detail FROM audit_log WHERE actor_id = $1 AND action LIKE 'referral_link_%' ORDER BY id`,
      [owner.id],
    )
    expect(rows.map((r) => r.action)).toEqual(['referral_link_created', 'referral_link_replaced'])
    for (const row of rows) expect(row.detail ?? '').not.toContain(link.code)
  })
})

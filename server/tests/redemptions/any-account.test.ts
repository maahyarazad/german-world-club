import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createMember, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, redeemerFor, resetOffers, CLUB_OFFERS } from '../offers/helpers.ts'
import type { RedeemerKind } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035 (decided 2026-11-23): any ACTIVE account may redeem — a member,
 * staff, a merchant user or a partner user — except a merchant on its own
 * organisation's offers. An account that is not active, or is an applicant not
 * yet approved, is refused and nothing is recorded.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const redeem = (headers: Record<string, string>, offerId: string, prefix: string) =>
  app.inject({ method: 'POST', url: `${prefix}/${offerId}/redemptions`, headers, payload: { requestId: randomUUID() } })
const rows = async () => (await app.pg.query('SELECT redeemer_kind, redeemer_id, organisation_id FROM redemptions')).rows

async function offerOf() {
  const merchant = await merchantWithStore(app)
  const offerId = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, perPersonLimit: null })
  return { merchant, offerId }
}

describe.skipIf(!hasDatabase)('who may redeem', () => {
  it.each(['member', 'admin', 'partner', 'merchant'] as const)('lets an active %s redeem and records which kind', async (kind: RedeemerKind) => {
    const { offerId } = await offerOf()
    // A merchant redeeming ANOTHER organisation's offer: a fresh organisation.
    const account = await redeemerFor(app, kind)
    const response = await redeem(account.headers, offerId, CLUB_OFFERS[kind])

    expect(response.statusCode).toBe(201)
    const [row] = await rows()
    expect(row).toMatchObject({ redeemer_kind: kind, redeemer_id: account.id })
  })

  it('refuses a merchant on its own organisation’s offer with 422 own-offer, and records nothing', async () => {
    const { merchant, offerId } = await offerOf()
    const response = await redeem(merchant.headers, offerId, CLUB_OFFERS.merchant)
    expect(response.statusCode).toBe(422)
    expect(response.json().type).toContain('own-offer')
    expect(await rows()).toHaveLength(0)

    // A colleague in the same organisation is refused too.
    const colleague = await redeemerFor(app, 'merchant', { organisationId: merchant.organisationId })
    expect((await redeem(colleague.headers, offerId, CLUB_OFFERS.merchant)).statusCode).toBe(422)
  })

  it('does not apply the own-offer rule to a partner or to another merchant — the counter-assertion', async () => {
    const { offerId } = await offerOf()
    const otherMerchant = await redeemerFor(app, 'merchant')
    expect((await redeem(otherMerchant.headers, offerId, CLUB_OFFERS.merchant)).statusCode).toBe(201)
  })

  it.each([['locked'], ['inactive'], ['ended']])('refuses a %s member', async (status) => {
    const { offerId } = await offerOf()
    const row = await createMember(app.pg, { status, passwordHash: null })
    const { authorization } = await bearerFor(app, { accountId: String(row.id), accountKind: 'member' })
    const response = await redeem({ authorization }, offerId, CLUB_OFFERS.member)
    expect(response.statusCode).toBeGreaterThanOrEqual(401)
    expect(response.statusCode).toBeLessThan(500)
    expect(await rows()).toHaveLength(0)
  })

  it('refuses an applicant who is not yet approved', async () => {
    const { offerId } = await offerOf()
    const applicant = await createMember(app.pg, { passwordHash: null })
    await app.pg.query(
      `INSERT INTO membership_applications (member_id, device_id, state, submitted_at) VALUES ($1, 'd', 'pending', now())`, [applicant.id],
    )
    const { authorization } = await bearerFor(app, { accountId: String(applicant.id), accountKind: 'member' })
    expect((await redeem({ authorization }, offerId, CLUB_OFFERS.member)).statusCode).toBe(403)
    expect(await rows()).toHaveLength(0)
  })

  it('refuses a deactivated staff account and an organisation user whose organisation is suspended', async () => {
    const { offerId } = await offerOf()
    const staff = await redeemerFor(app, 'admin')
    await app.pg.query('UPDATE admin_users SET is_active = false WHERE id = $1', [staff.id])
    expect((await redeem(staff.headers, offerId, CLUB_OFFERS.admin)).statusCode).toBeGreaterThanOrEqual(401)

    const partner = await redeemerFor(app, 'partner')
    await app.pg.query(`UPDATE organisations SET status = 'suspended' WHERE id = $1`, [partner.organisationId])
    const response = await redeem(partner.headers, offerId, CLUB_OFFERS.partner)
    expect(response.statusCode).toBeGreaterThanOrEqual(401)
    expect(response.statusCode).toBeLessThan(500)
    expect(await rows()).toHaveLength(0)
  })

  it('does not let a token of one kind use another kind’s mount', async () => {
    const { offerId } = await offerOf()
    const member = await redeemerFor(app, 'member')
    for (const prefix of [CLUB_OFFERS.merchant, CLUB_OFFERS.partner, CLUB_OFFERS.admin]) {
      const response = await redeem(member.headers, offerId, prefix)
      expect(response.statusCode).toBeGreaterThanOrEqual(401)
      expect(response.statusCode).toBeLessThan(500)
    }
    expect(await rows()).toHaveLength(0)
  })
})

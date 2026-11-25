import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createMember, createAdmin, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, redeemerFor, staffWith, resetOffers, CLUB_OFFERS } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-023: a report shows who redeemed by a handle, "First L." or a
 * display name, and the kind of account — never an email, a mobile number, a
 * legal name or an account id.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const SECRETS = ['secret.person@test.invalid', '+4915112345678', 'Legal Name', 'gold-secret-tier']

describe.skipIf(!hasDatabase)('what a report may reveal about who redeemed', () => {
  it('shows a handle, "First L.", or a display name — and no contact details or ids', async () => {
    const merchant = await merchantWithStore(app)
    const offerId = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, perPersonLimit: null })

    const handled = await createMember(app.pg, {
      passwordHash: null, email: 'secret.person@test.invalid', mobile: '+4915112345678', mobileVerified: true,
      displayName: 'Hanna Beispiel Musterfrau', handle: 'hanna_b',
    })
    const unhandled = await createMember(app.pg, { passwordHash: null, displayName: 'Karl Heinz Schmidt' })
    const staff = await createAdmin(app.pg, { isAdmin: false, displayName: 'Stella Staff' })
    const partner = await redeemerFor(app, 'partner')

    for (const [id, kind, prefix] of [
      [handled.id, 'member', CLUB_OFFERS.member], [unhandled.id, 'member', CLUB_OFFERS.member],
      [staff.id, 'admin', CLUB_OFFERS.admin],
    ] as const) {
      const { authorization } = await bearerFor(app, { accountId: String(id), accountKind: kind })
      const response = await app.inject({
        method: 'POST', url: `${prefix}/${offerId}/redemptions`, headers: { authorization }, payload: { requestId: randomUUID() },
      })
      expect(response.statusCode).toBe(201)
    }
    await app.inject({ method: 'POST', url: `${CLUB_OFFERS.partner}/${offerId}/redemptions`, headers: partner.headers, payload: { requestId: randomUUID() } })

    const admin = await staffWith(app, {}, { superadmin: true })
    for (const [url, headers] of [
      ['/admin/reports/redemptions', admin.headers], ['/merchant/reports/redemptions', merchant.headers],
    ] as const) {
      const response = await app.inject({ method: 'GET', url, headers })
      expect(response.statusCode).toBe(200)
      const body = response.body
      for (const secret of SECRETS) expect(body, `${url} leaked ${secret}`).not.toContain(secret)
      expect(body).not.toContain(String(handled.id))
      expect(body).not.toContain(String(staff.id))
      expect(body).not.toMatch(/"email"|"mobile"|legal_?name|fee_?tier|"redeemerId"/i)

      const names = response.json().rows.map((r: { redeemerName: string }) => r.redeemerName).sort()
      expect(names).toContain('@hanna_b')
      expect(names).toContain('Karl S.')
      expect(names).toContain('Stella Staff')
    }
  })

  it('STILL notices a leak — the counter-assertion', () => {
    expect(JSON.stringify({ redeemerName: 'secret.person@test.invalid' })).toContain('secret.person@test.invalid')
  })
})

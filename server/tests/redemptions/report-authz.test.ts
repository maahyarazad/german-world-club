import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, grant } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, redeemerFor, staffWith, resetOffers } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-022: the platform report is for staff holding `merchant_offers`
 * read, which a superadmin does by the usual rule. Anyone else is refused before
 * the handler runs, and a revoked grant bites on the next request.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const get = (headers: Record<string, string>, url = '/admin/reports/redemptions') => app.inject({ method: 'GET', url, headers })

describe.skipIf(!hasDatabase)('who may open the platform report', () => {
  it('refuses a staff member without the grant', async () => {
    const staff = await staffWith(app, {})
    expect((await get(staff.headers)).statusCode).toBe(403)
  })

  it('refuses a staff member who holds another module, or this one without read', async () => {
    const other = await staffWith(app, { members: true })
    expect((await get(other.headers)).statusCode).toBe(403)
    const writeOnly = await staffWith(app, { merchant_offers: { write: true, edit: true, status: true } })
    expect((await get(writeOnly.headers)).statusCode).toBe(403)
  })

  it('admits staff with the read grant, and a superadmin', async () => {
    expect((await get((await staffWith(app, { merchant_offers: { read: true } })).headers)).statusCode).toBe(200)
    expect((await get((await staffWith(app, {}, { superadmin: true })).headers)).statusCode).toBe(200)
  })

  it('refuses a merchant, a member and an anonymous caller on the platform route', async () => {
    expect((await get((await merchantWithStore(app)).headers)).statusCode).toBeGreaterThanOrEqual(401)
    expect((await get((await redeemerFor(app, 'member')).headers)).statusCode).toBeGreaterThanOrEqual(401)
    expect((await app.inject({ method: 'GET', url: '/admin/reports/redemptions' })).statusCode).toBe(401)
  })

  it('refuses staff on the merchant route: it is a merchant’s own', async () => {
    const admin = await staffWith(app, {}, { superadmin: true })
    expect((await get(admin.headers, '/merchant/reports/redemptions')).statusCode).toBeGreaterThanOrEqual(401)
  })

  it('takes effect on the next request when the grant is revoked', async () => {
    const staff = await staffWith(app, { merchant_offers: { read: true } })
    expect((await get(staff.headers)).statusCode).toBe(200)
    await app.pg.query('DELETE FROM admin_permissions WHERE admin_user_id = $1', [staff.id])
    app.permissions!.invalidate(staff.id)
    expect((await get(staff.headers)).statusCode).toBe(403)
  })

  it('does not widen a merchant’s own report with a grant — the counter-assertion', async () => {
    const merchant = await merchantWithStore(app)
    const response = await get(merchant.headers, '/merchant/reports/redemptions')
    expect(response.statusCode).toBe(200)
  })
})

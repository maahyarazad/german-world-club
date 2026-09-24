import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { countAudience } from '../../src/modules/push/application/audience.ts'
import { resetPush, memberWithDevice } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Notification preferences (feature 011, FR-006, research R13).
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

describe.skipIf(!hasDatabase)('GET/PUT /push/preferences', () => {
  it('reads both on with no row, and round-trips a change', async () => {
    const m = await memberWithDevice(app)
    const { authorization } = await bearerFor(app, { accountId: m.id, accountKind: 'member' })
    const headers = { authorization }

    expect((await app.inject({ method: 'GET', url: '/push/preferences', headers })).json())
      .toEqual({ offers: true, broadcasts: true })

    const put = await app.inject({
      method: 'PUT', url: '/push/preferences', headers, payload: { offers: false, broadcasts: true },
    })
    expect(put.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/push/preferences', headers })).json())
      .toEqual({ offers: false, broadcasts: true })
  })

  it('takes a member with offers off out of the offers audience only', async () => {
    const m = await memberWithDevice(app)
    const { authorization } = await bearerFor(app, { accountId: m.id, accountKind: 'member' })
    await app.inject({
      method: 'PUT', url: '/push/preferences', headers: { authorization }, payload: { offers: false, broadcasts: true },
    })

    expect(await countAudience(app, { audience: 'offers' })).toEqual({ members: 0, devices: 0 })
    // Counter-assertion: club news still reaches them.
    expect(await countAudience(app, { audience: 'broadcasts' })).toEqual({ members: 1, devices: 1 })
  })
})

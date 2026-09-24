import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { stubTransport, resetPush, memberWithDevice, pushStaff, queue, settle } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The broadcast confirm dialog shows the number the send reaches (FR-016),
 * because both come from `ELIGIBLE_DEVICE`.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

describe.skipIf(!hasDatabase)('GET /push/audience', () => {
  it('matches the deliveries a following broadcast materialises', async () => {
    const twoPhones = await memberWithDevice(app)
    await app.pg.query(
      `INSERT INTO push_devices (member_id, token, provider, locale) VALUES ($1, 'ExponentPushToken[second]', 'expo', 'de')`,
      [twoPhones.id],
    )
    await memberWithDevice(app)
    await memberWithDevice(app, { status: 'locked' })
    await memberWithDevice(app, { enabled: false })
    const staff = await pushStaff(app)
    app.pushTransport = stubTransport()

    const audience = await app.inject({ method: 'GET', url: '/push/audience?kind=broadcast', headers: staff.headers })
    expect(audience.statusCode).toBe(200)
    expect(audience.json()).toEqual({ members: 2, devices: 3 })

    const queued = await queue(app, staff.headers)
    await settle(app, app.pushTransport, queued.json().id)
    const { rows } = await app.pg.query(
      `SELECT count(*)::int AS devices, count(DISTINCT member_id)::int AS members FROM push_deliveries WHERE notification_id = $1`,
      [queued.json().id],
    )
    expect(rows[0]).toEqual(audience.json())
  })

  it('refuses an unknown kind', async () => {
    const staff = await pushStaff(app)
    expect((await app.inject({ method: 'GET', url: '/push/audience?kind=everyone', headers: staff.headers })).statusCode).toBe(400)
  })
})

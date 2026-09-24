import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createMember, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetPush } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Sign-out forgets that phone (feature 011, FR-005, research R3; quickstart
 * row 13) — server-side, in the revocation's transaction, so a sign-out whose
 * `DELETE /push/devices/:id` never arrived still stops the notifications.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

describe.skipIf(!hasDatabase)('POST /auth/sign-out', () => {
  it('deletes the devices registered by the revoked session, and only those', async () => {
    const row = await createMember(app.pg, { passwordHash: null })
    const memberId = String(row.id)
    const { rows: [other] } = await app.pg.query(
      `INSERT INTO sessions (account_id, account_kind, revoked_at, revoked_reason)
       VALUES ($1, 'member', now(), 'superseded') RETURNING id`,
      [memberId],
    )
    // A device from an earlier session on another phone.
    await app.pg.query(
      `INSERT INTO push_devices (member_id, session_id, token, provider, locale)
       VALUES ($1, $2, 'ExponentPushToken[older-phone]', 'expo', 'de')`,
      [memberId, other.id],
    )
    const { authorization, sessionId } = await bearerFor(app, { accountId: memberId, accountKind: 'member' })
    const registered = await app.inject({
      method: 'POST', url: '/push/devices', headers: { authorization },
      payload: { token: 'ExponentPushToken[this-phone]', provider: 'expo', locale: 'de' },
    })
    expect(registered.statusCode).toBe(200)

    const response = await app.inject({ method: 'POST', url: '/auth/sign-out', headers: { authorization } })
    expect(response.statusCode).toBe(204)

    const { rows } = await app.pg.query('SELECT token, session_id FROM push_devices WHERE member_id = $1', [memberId])
    expect(rows.map((r) => r.token)).toEqual(['ExponentPushToken[older-phone]'])
    expect(rows.every((r) => r.session_id !== sessionId)).toBe(true)
  })

  it('leaves devices alone when a session is merely superseded', async () => {
    // Counter-assertion for R3's "not done": signing in elsewhere must not
    // silence the phone.
    const row = await createMember(app.pg, { passwordHash: null })
    const memberId = String(row.id)
    const { authorization } = await bearerFor(app, { accountId: memberId, accountKind: 'member' })
    await app.inject({
      method: 'POST', url: '/push/devices', headers: { authorization },
      payload: { token: 'ExponentPushToken[kept]', provider: 'expo', locale: 'de' },
    })
    // A second sign-in supersedes the first session.
    await bearerFor(app, { accountId: memberId, accountKind: 'member' })

    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM push_devices WHERE member_id = $1', [memberId])
    expect(rows[0].n).toBe(1)
  })
})

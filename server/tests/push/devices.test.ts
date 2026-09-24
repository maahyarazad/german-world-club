import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createMember, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetPush } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Device registration (feature 011, US1, research R3; FR-004).
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

async function member() {
  const row = await createMember(app.pg, { passwordHash: null })
  const { authorization, sessionId } = await bearerFor(app, { accountId: String(row.id), accountKind: 'member' })
  return { id: String(row.id), headers: { authorization }, sessionId }
}

const TOKEN = 'ExponentPushToken[devices-test-0001]'

const register = (headers: Record<string, string>, payload: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST', url: '/push/devices', headers,
    payload: { token: TOKEN, provider: 'expo', platform: 'ios', locale: 'en', ...payload },
  })

const list = async (headers: Record<string, string>) =>
  (await app.inject({ method: 'GET', url: '/push/devices', headers })).json().devices

describe.skipIf(!hasDatabase)('POST /push/devices', () => {
  it('upserts on the token and stores the locale and session', async () => {
    const a = await member()
    const first = await register(a.headers)
    const second = await register(a.headers, { locale: 'de' })

    expect(first.statusCode).toBe(200)
    expect(second.json().id).toBe(first.json().id)
    expect(second.json().locale).toBe('de')
    // Never the token itself.
    expect(second.body).not.toContain(TOKEN)
    const { rows } = await app.pg.query('SELECT session_id FROM push_devices WHERE id = $1', [first.json().id])
    expect(rows[0].session_id).toBe(a.sessionId)
  })

  it('requires a locale', async () => {
    const a = await member()
    const response = await app.inject({
      method: 'POST', url: '/push/devices', headers: a.headers,
      payload: { token: TOKEN, provider: 'expo' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('moves a token to the member who signed in last (FR-004)', async () => {
    const a = await member()
    const b = await member()
    await register(a.headers)
    await register(b.headers)

    expect(await list(a.headers)).toEqual([])
    // Counter-assertion: the device did not simply vanish.
    expect(await list(b.headers)).toHaveLength(1)
  })

  it('clears a dead-token mark on re-registration', async () => {
    const a = await member()
    const id = (await register(a.headers)).json().id
    await app.pg.query(`UPDATE push_devices SET disabled_reason = 'unregistered' WHERE id = $1`, [id])
    await register(a.headers)
    const { rows } = await app.pg.query('SELECT disabled_reason FROM push_devices WHERE id = $1', [id])
    expect(rows[0].disabled_reason).toBeNull()
  })
})

describe.skipIf(!hasDatabase)('PATCH /push/devices/:id', () => {
  it('changes enabled and locale on the caller\'s own device', async () => {
    const a = await member()
    const id = (await register(a.headers)).json().id
    const response = await app.inject({
      method: 'PATCH', url: `/push/devices/${id}`, headers: a.headers, payload: { enabled: false, locale: 'de' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id, enabled: false, locale: 'de' })
  })

  it('answers another member\'s device exactly like an absent one', async () => {
    const a = await member()
    const b = await member()
    const id = (await register(a.headers)).json().id

    const foreign = await app.inject({ method: 'PATCH', url: `/push/devices/${id}`, headers: b.headers, payload: { enabled: false } })
    const absent = await app.inject({ method: 'PATCH', url: `/push/devices/${randomUUID()}`, headers: b.headers, payload: { enabled: false } })

    expect(foreign.statusCode).toBe(404)
    expect(absent.statusCode).toBe(404)
    const strip = (body: Record<string, unknown>) => ({ ...body, instance: undefined, requestId: undefined })
    expect(strip(foreign.json())).toEqual(strip(absent.json()))
    // And it really was left alone.
    expect((await list(a.headers))[0].enabled).toBe(true)
  })

  it('refuses an empty change', async () => {
    const a = await member()
    const id = (await register(a.headers)).json().id
    const response = await app.inject({ method: 'PATCH', url: `/push/devices/${id}`, headers: a.headers, payload: {} })
    expect(response.statusCode).toBe(400)
  })
})

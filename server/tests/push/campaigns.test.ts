import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import {
  stubTransport, resetPush, memberWithDevice, addToTestList, pushStaff, queue, text, settle,
} from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Staff sends (feature 011, US3; FR-014–FR-020, research R2).
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
  await app.pg.query(`UPDATE job_definitions SET enabled = true WHERE name = 'push.deliver'`)
})

const count = async (sql: string, params: unknown[] = []) =>
  (await app.pg.query(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0].n as number

describe.skipIf(!hasDatabase)('rehearsal and broadcast', () => {
  it('queues a rehearsal (202) that reaches only the test list', async () => {
    const tester = await memberWithDevice(app)
    const bystander = await memberWithDevice(app)
    await addToTestList(app.pg, tester.id)
    const staff = await pushStaff(app)
    const transport = stubTransport()
    app.pushTransport = transport

    const response = await queue(app, staff.headers, { path: '/preview' })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ kind: 'rehearsal', status: 'queued' })
    await settle(app, transport, response.json().id)

    expect(transport.sentTokens()).toContain(tester.token)
    expect(transport.sentTokens()).not.toContain(bystander.token)
  })

  it('queues a broadcast that reaches every eligible device', async () => {
    const members = [await memberWithDevice(app), await memberWithDevice(app, { locale: 'en' })]
    await memberWithDevice(app, { status: 'locked' })
    const staff = await pushStaff(app)
    const transport = stubTransport()
    app.pushTransport = transport

    const response = await queue(app, staff.headers)
    expect(response.statusCode).toBe(202)
    await settle(app, transport, response.json().id)

    expect(transport.sentTokens().sort()).toEqual(members.map((m) => m.token).sort())
  })

  it('answers a repeat of the same message under the same clientRef with the same row (200)', async () => {
    const staff = await pushStaff(app)
    const clientRef = randomUUID()

    const first = await queue(app, staff.headers, { clientRef })
    const second = await queue(app, staff.headers, { clientRef })

    expect(first.statusCode).toBe(202)
    expect(second.statusCode).toBe(200)
    expect(second.json().id).toBe(first.json().id)
    expect(await count('push_notifications')).toBe(1)
    expect(await count(`audit_log WHERE action = 'push_broadcast_queued'`)).toBe(1)
  })

  it('refuses the same clientRef for a different message, creating and auditing nothing', async () => {
    const staff = await pushStaff(app)
    const clientRef = randomUUID()
    await queue(app, staff.headers, { clientRef, body: text('eins') })

    const conflict = await queue(app, staff.headers, { clientRef, body: text('zwei') })

    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().type).toBe(PROBLEMS.PUSH_IDEMPOTENCY_CONFLICT.type)
    expect(await count('push_notifications')).toBe(1)
    expect(await count(`audit_log WHERE action = 'push_broadcast_queued'`)).toBe(1)

    // Counter-assertion: the same content under a fresh ref is a new send.
    const fresh = await queue(app, staff.headers, { body: text('zwei') })
    expect(fresh.statusCode).toBe(202)
    expect(await count('push_notifications')).toBe(2)
  })

  it('refuses a rehearsal with an empty test list, and creates nothing', async () => {
    await memberWithDevice(app)
    const staff = await pushStaff(app)

    const response = await queue(app, staff.headers, { path: '/preview' })

    expect(response.statusCode).toBe(409)
    expect(response.json().type).toBe(PROBLEMS.PUSH_NO_TEST_RECIPIENTS.type)
    expect(await count('push_notifications')).toBe(0)
  })

  it('requires both languages and enforces the length limits', async () => {
    const staff = await pushStaff(app)
    const send = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/push/campaigns', headers: staff.headers, payload: { clientRef: randomUUID(), ...payload } })

    expect((await send({ de: text().de })).statusCode).toBe(400)
    expect((await send({ de: { title: 'x'.repeat(66), body: 'b' }, en: text().en })).statusCode).toBe(400)
    expect((await send({ de: text().de, en: { title: 't', body: 'x'.repeat(241) } })).statusCode).toBe(400)
    expect((await send({ de: { title: '   ', body: 'b' }, en: text().en })).statusCode).toBe(400)
    expect(await count('push_notifications')).toBe(0)
    // Counter-assertion: exactly at the limits is fine.
    expect((await send({ de: { title: 'x'.repeat(65), body: 'y'.repeat(240) }, en: text().en })).statusCode).toBe(202)
  })

  it('refuses staff without mass_messages.write', async () => {
    const reader = await pushStaff(app, { read: true })
    expect((await queue(app, reader.headers)).statusCode).toBe(403)
    expect(await count('push_notifications')).toBe(0)
  })

  it('lists history newest first, and returns one entry for polling', async () => {
    const staff = await pushStaff(app)
    await addToTestList(app.pg, (await memberWithDevice(app)).id)
    const a = await queue(app, staff.headers, { path: '/preview' })
    const b = await queue(app, staff.headers)

    const list = await app.inject({ method: 'GET', url: '/push/campaigns', headers: staff.headers })
    expect(list.json().notifications.map((n: { id: string }) => n.id)).toEqual([b.json().id, a.json().id])

    const rehearsals = await app.inject({ method: 'GET', url: '/push/campaigns?kind=rehearsal', headers: staff.headers })
    expect(rehearsals.json().notifications.map((n: { id: string }) => n.id)).toEqual([a.json().id])
    // The pre-011 filter still works for a release; "false" must mean false.
    const broadcasts = await app.inject({ method: 'GET', url: '/push/campaigns?isTest=false', headers: staff.headers })
    expect(broadcasts.json().notifications.map((n: { id: string }) => n.id)).toEqual([b.json().id])

    const one = await app.inject({ method: 'GET', url: `/push/campaigns/${a.json().id}`, headers: staff.headers })
    expect(one.statusCode).toBe(200)
    expect(one.json()).toMatchObject({ id: a.json().id, kind: 'rehearsal', de: text().de, en: text().en })
    expect((await app.inject({ method: 'GET', url: `/push/campaigns/${randomUUID()}`, headers: staff.headers })).statusCode).toBe(404)
  })
})

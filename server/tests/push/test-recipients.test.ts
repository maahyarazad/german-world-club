import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetPush, memberWithDevice, pushStaff } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The rehearsal list (feature 011, US3; FR-020, constitution VI).
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

const audits = async (action: string) =>
  (await app.pg.query('SELECT actor_id, target_id FROM audit_log WHERE action = $1', [action])).rows

describe.skipIf(!hasDatabase)('push test recipients', () => {
  it('adds by id and by handle, removes, and audits each naming the actor', async () => {
    const staff = await pushStaff(app)
    const byId = await memberWithDevice(app)
    const byHandle = await memberWithDevice(app, { handle: 'probe.tester' })

    const add1 = await app.inject({ method: 'POST', url: '/push/test-recipients', headers: staff.headers, payload: { memberId: byId.id } })
    const add2 = await app.inject({ method: 'POST', url: '/push/test-recipients', headers: staff.headers, payload: { handle: '@Probe.Tester' } })
    expect(add1.json()).toEqual({ memberId: byId.id })
    expect(add2.json()).toEqual({ memberId: byHandle.id })

    const removed = await app.inject({ method: 'DELETE', url: `/push/test-recipients/${byId.id}`, headers: staff.headers })
    expect(removed.statusCode).toBe(200)

    expect(await audits('push_test_recipient_added')).toEqual(expect.arrayContaining([
      { actor_id: staff.id, target_id: byId.id },
      { actor_id: staff.id, target_id: byHandle.id },
    ]))
    expect(await audits('push_test_recipient_removed')).toEqual([{ actor_id: staff.id, target_id: byId.id }])
  })

  it('answers 404 for a member who is not on the list, or does not exist', async () => {
    const staff = await pushStaff(app)
    expect((await app.inject({ method: 'DELETE', url: `/push/test-recipients/${randomUUID()}`, headers: staff.headers })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/push/test-recipients', headers: staff.headers, payload: { handle: 'nobody.here' } })).statusCode).toBe(404)
    expect(await audits('push_test_recipient_removed')).toEqual([])
  })

  it('lists who is on it without any contact detail', async () => {
    const staff = await pushStaff(app)
    const tester = await memberWithDevice(app, { handle: 'list.tester' })
    await app.inject({ method: 'POST', url: '/push/test-recipients', headers: staff.headers, payload: { memberId: tester.id } })

    const response = await app.inject({ method: 'GET', url: '/push/test-recipients', headers: staff.headers })

    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('"email"')
    expect(response.body).not.toContain('@')
    // Counter-assertion: the list does say who.
    expect(response.json().recipients).toEqual([
      { memberId: tester.id, displayName: 'Test Member', handle: 'list.tester', deviceCount: 1 },
    ])
  })
})

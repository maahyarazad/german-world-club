import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createMember, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { stubTransport, resetPush, memberWithDevice, insertNotification, dispatch, deliveries, notificationRow } from '../push/helpers.ts'
import type { MessageOutcome } from '../../src/modules/push/providers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * A provider outage, end to end (feature 011, quickstart row 15, constitution V).
 *
 * With the push breaker open, the outbox keeps every delivery `pending` —
 * nothing is failed, nothing is lost, no attempt is spent — and no member
 * request fails, because no route calls a push provider at all.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

describe.skipIf(!hasDatabase)('push provider outage', () => {
  it('keeps deliveries pending while the circuit is open, then sends them once it closes', async () => {
    const member = await memberWithDevice(app)
    const id = await insertNotification(app.pg)
    let open = true
    const transport = stubTransport((): MessageOutcome =>
      open ? { status: 'retry', error: 'circuit open', notAttempted: true } : { status: 'sent', providerRef: 't' })

    await dispatch(app, transport)
    let [row] = await deliveries(app.pg, id)
    expect(row).toMatchObject({ status: 'pending', attempts: 0 })
    expect((await notificationRow(app.pg, id)).status).toBe('sending')

    // No request fails meanwhile.
    const other = await createMember(app.pg, { passwordHash: null })
    const { authorization } = await bearerFor(app, { accountId: String(other.id), accountKind: 'member' })
    const response = await app.inject({ method: 'GET', url: '/push/devices', headers: { authorization } })
    expect(response.statusCode).toBe(200)

    // Counter-assertion: recovery delivers, exactly once.
    open = false
    await dispatch(app, transport)
    ;[row] = await deliveries(app.pg, id)
    expect(row.status).toBe('sent')
    expect(transport.sentTokens()).toEqual([member.token, member.token])
    expect((await notificationRow(app.pg, id)).status).toBe('done')
  })
})

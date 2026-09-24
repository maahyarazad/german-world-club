import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { stubTransport, resetPush, memberWithDevice, pushStaff, queue } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * What arrives on the phone (contracts/push-payload.md).
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

describe.skipIf(!hasDatabase)('the push payload', () => {
  it('carries {v, nid, type, id} as strings, and each device its own language', async () => {
    const german = await memberWithDevice(app, { locale: 'de' })
    const english = await memberWithDevice(app, { locale: 'en' })
    const staff = await pushStaff(app)
    const transport = stubTransport()
    app.pushTransport = transport
    const eventId = '6b0c2f4e-8a55-4d0e-9d5b-3b9d7a1c2e10'

    const queued = await queue(app, staff.headers, { destination: { type: 'event', id: eventId, label: 'Sommerfest' } })
    expect(queued.statusCode).toBe(202)
    // The kick delivers; wait for both phones.
    for (let i = 0; i < 100 && transport.sentTokens().length < 2; i += 1) await new Promise((r) => setTimeout(r, 20))
    const messages = transport.calls.flatMap((c) => c.messages)

    const byToken = new Map(messages.map((m) => [m.token, m]))
    const de = byToken.get(german.token)!
    const en = byToken.get(english.token)!

    expect(de.data).toEqual({ v: '1', nid: queued.json().id, type: 'event', id: eventId })
    for (const value of Object.values(de.data)) expect(typeof value).toBe('string')
    expect(de).toMatchObject({ title: 'Titel', body: 'Nachricht' })
    expect(en).toMatchObject({ title: 'Title', body: 'Message' })
    // Counter-assertion: a German phone does not get the English text.
    expect(de.title).not.toBe(en.title)
    // No member data, token or label in the payload.
    expect(JSON.stringify(de.data)).not.toContain('Sommerfest')
    expect(JSON.stringify(de.data)).not.toContain(german.token)
  })

  it('sends type "none" with an empty id when there is no destination', async () => {
    await memberWithDevice(app)
    const staff = await pushStaff(app)
    const transport = stubTransport()
    app.pushTransport = transport

    const queued = await queue(app, staff.headers)
    for (let i = 0; i < 50 && transport.calls.length === 0; i += 1) await new Promise((r) => setTimeout(r, 20))

    expect(transport.calls[0]!.messages[0]!.data).toEqual({ v: '1', nid: queued.json().id, type: 'none', id: '' })
  })
})

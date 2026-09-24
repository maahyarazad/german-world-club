import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { stubTransport, resetPush, memberWithDevice, pushStaff, queue, notificationRow } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Persist before notify, for push (feature 011, plan.md "Tech baseline").
 *
 * Before this feature a broadcast was sent inside the request and written down
 * afterwards, so a failure to write the record left a send nobody could see.
 * Now the request only queues. These tests fail against the old shape: its
 * transport is called before any row exists, and before the response.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
  await app.pg.query(`UPDATE job_definitions SET enabled = true WHERE name = 'push.deliver'`)
})

/** Resolves once the stub has been called, or after `ms`. */
const calledWithin = (calls: unknown[], ms: number) => new Promise<boolean>((resolve) => {
  const started = Date.now()
  const tick = () => {
    if (calls.length > 0) resolve(true)
    else if (Date.now() - started > ms) resolve(false)
    else setTimeout(tick, 20)
  }
  tick()
})

describe.skipIf(!hasDatabase)('a push is persisted before it is sent', () => {
  it('commits the notification before the first transport call, and answers before any', async () => {
    await memberWithDevice(app)
    const staff = await pushStaff(app)

    const committedAtFirstCall: (number | null)[] = []
    const transport = stubTransport()
    const send = transport.send.bind(transport)
    transport.send = async (provider, messages) => {
      // A separate pool connection sees only committed rows.
      const { rows } = await app.pg.query(`SELECT count(*)::int AS n FROM push_notifications`)
      committedAtFirstCall.push(rows[0].n)
      return send(provider, messages)
    }
    app.pushTransport = transport

    const response = await queue(app, staff.headers)
    const answeredAt = Date.now()

    expect(response.statusCode).toBe(202)
    // Counter-assertion: the kick really does deliver, within SC-001's budget
    // (5 s here, 30 s in the spec) — otherwise the assertions below would hold
    // for a server that never sends anything.
    expect(await calledWithin(transport.calls, 5000), 'the transport was never called').toBe(true)

    expect(committedAtFirstCall[0]).toBe(1)
    expect(transport.calls[0]!.at).toBeGreaterThanOrEqual(answeredAt)
  })

  it('does not send inside the request when the kick is lost', async () => {
    await memberWithDevice(app)
    const staff = await pushStaff(app)
    const transport = stubTransport()
    app.pushTransport = transport
    const boss = app.boss
    // A kick that vanishes between commit and pg-boss (research R1).
    app.boss = { ...boss, send: async () => { throw new Error('pg-boss unavailable') } }
    try {
      const response = await queue(app, staff.headers)
      // Still accepted: the row is committed and the tick will send it.
      expect(response.statusCode).toBe(202)
      expect(transport.calls).toHaveLength(0)
      expect((await notificationRow(app.pg, response.json().id)).status).toBe('queued')

      // The sweep is what makes a lost kick safe.
      await app.runJob('push.deliver')
      expect(transport.calls).toHaveLength(1)
    } finally {
      app.boss = boss
    }
  })
})

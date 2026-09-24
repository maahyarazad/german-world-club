import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { MAX_ATTEMPTS } from '../../src/modules/push/application/dispatch.ts'
import {
  stubTransport, resetPush, memberWithDevice, insertNotification, dispatch, deliveries, notificationRow,
} from './helpers.ts'
import type { MessageOutcome } from '../../src/modules/push/providers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The outbox dispatcher (feature 011, research R1, R2, R6; SC-002, FR-026–FR-028).
 *
 * Every test here carries a counter-assertion: a dispatcher that sends nothing
 * trivially sends nothing twice.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
  await app.pg.query(`UPDATE job_definitions SET enabled = true WHERE name = 'push.deliver'`)
})

describe.skipIf(!hasDatabase)('at most once per device', () => {
  it('two concurrent dispatchers create no duplicate delivery and send each device once', async () => {
    const members = await Promise.all(Array.from({ length: 12 }, () => memberWithDevice(app)))
    const id = await insertNotification(app.pg)
    const transport = stubTransport()

    await Promise.all([
      dispatch(app, transport, { batchSize: 3 }),
      dispatch(app, transport, { batchSize: 3 }),
    ])

    const { rows } = await app.pg.query(
      `SELECT count(*)::int AS n, count(DISTINCT device_id)::int AS devices
         FROM push_deliveries WHERE notification_id = $1`,
      [id],
    )
    expect(rows[0].n).toBe(rows[0].devices)
    const sent = transport.sentTokens()
    expect(new Set(sent).size).toBe(sent.length)
    // Counter-assertion: everybody was reached.
    expect(sent.sort()).toEqual(members.map((m) => m.token).sort())
    expect((await notificationRow(app.pg, id)).status).toBe('done')
  })

  it('never resends a delivery whose outcome is unknown', async () => {
    const member = await memberWithDevice(app)
    const id = await insertNotification(app.pg)
    // The process died after handing the batch to the provider and before
    // saving the outcome: the row is left in `sending`, past the lease.
    await app.pg.query(
      `INSERT INTO push_deliveries (notification_id, device_id, member_id, provider, status, updated_at)
       VALUES ($1, $2, $3, 'expo', 'sending', now() - interval '10 minutes')`,
      [id, member.deviceId, member.id],
    )
    await app.pg.query(`UPDATE push_notifications SET status = 'sending' WHERE id = $1`, [id])
    const transport = stubTransport()

    await dispatch(app, transport)

    const [row] = await deliveries(app.pg, id)
    expect(row.status).toBe('failed')
    expect(row.error_message).toBe('outcome unknown')
    expect(transport.calls).toHaveLength(0)
    expect((await notificationRow(app.pg, id)).status).toBe('failed')
  })

  it('does retry a delivery the provider demonstrably refused', async () => {
    // Counter-assertion for the test above: "never resend" must not mean
    // "never retry".
    const member = await memberWithDevice(app)
    const id = await insertNotification(app.pg)
    let refuse = true
    const transport = stubTransport((): MessageOutcome =>
      refuse ? { status: 'retry', error: 'HTTP 503' } : { status: 'sent', providerRef: 'ticket-1' })

    await dispatch(app, transport)
    let [row] = await deliveries(app.pg, id)
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(1)

    refuse = false
    await dispatch(app, transport)
    ;[row] = await deliveries(app.pg, id)
    expect(row.status).toBe('sent')
    expect(row.provider_ref).toBe('ticket-1')
    expect(transport.sentTokens()).toEqual([member.token, member.token])
    expect((await notificationRow(app.pg, id)).status).toBe('done')
  })

  it(`gives up after ${MAX_ATTEMPTS} refusals and finishes partial`, async () => {
    const failing = await memberWithDevice(app)
    const fine = await memberWithDevice(app)
    const id = await insertNotification(app.pg)
    const transport = stubTransport((_provider, message): MessageOutcome =>
      message.token === failing.token ? { status: 'retry', error: 'HTTP 503' } : { status: 'sent', providerRef: 'ok' })

    for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) await dispatch(app, transport)

    const rows = await deliveries(app.pg, id)
    const failed = rows.find((r) => r.device_id === failing.deviceId)
    expect(failed.status).toBe('failed')
    expect(failed.attempts).toBe(MAX_ATTEMPTS)
    expect(transport.sentTokens().filter((t) => t === failing.token)).toHaveLength(MAX_ATTEMPTS)
    // Counter-assertion: the other device was reached, once.
    expect(rows.find((r) => r.device_id === fine.deviceId).status).toBe('sent')
    expect((await notificationRow(app.pg, id)).status).toBe('partial')
  })
})

describe.skipIf(!hasDatabase)('dead tokens and eligibility', () => {
  it('disables a device whose token the provider reports dead', async () => {
    const dead = await memberWithDevice(app)
    const alive = await memberWithDevice(app)
    const id = await insertNotification(app.pg)
    const transport = stubTransport((_p, m): MessageOutcome =>
      m.token === dead.token
        ? { status: 'failed', permanent: true, error: 'DeviceNotRegistered' }
        : { status: 'sent', providerRef: 'ok' })

    await dispatch(app, transport)

    const { rows } = await app.pg.query(
      'SELECT id, disabled_reason FROM push_devices WHERE id = ANY($1::uuid[])',
      [[dead.deviceId, alive.deviceId]],
    )
    expect(rows.find((r) => r.id === dead.deviceId).disabled_reason).toBe('unregistered')
    expect(rows.find((r) => r.id === alive.deviceId).disabled_reason).toBeNull()

    // And the next broadcast does not try it again (SC-007).
    const next = await insertNotification(app.pg)
    await dispatch(app, transport)
    expect((await deliveries(app.pg, next)).map((d) => d.device_id)).toEqual([alive.deviceId])
  })

  it('skips a member locked mid-broadcast', async () => {
    const pair = [await memberWithDevice(app), await memberWithDevice(app)]
    const id = await insertNotification(app.pg)
    const transport = stubTransport()
    // Lock whichever member was NOT in the first batch, right after it went.
    let locked: (typeof pair)[number] | undefined
    const send = transport.send.bind(transport)
    transport.send = async (provider, messages) => {
      const result = await send(provider, messages)
      if (!locked) {
        locked = pair.find((m) => m.token !== messages[0]!.token)!
        await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [locked.id])
      }
      return result
    }

    await dispatch(app, transport, { batchSize: 1 })

    const rows = await deliveries(app.pg, id)
    const reached = pair.find((m) => m !== locked)!
    expect(rows.find((r) => r.device_id === locked!.deviceId).status).toBe('skipped')
    // Counter-assertion: the member who was still active got it.
    expect(rows.find((r) => r.device_id === reached.deviceId).status).toBe('sent')
    expect(transport.sentTokens()).toEqual([reached.token])
    expect((await notificationRow(app.pg, id)).status).toBe('done')
  })

  it('finishes an audience of zero as done', async () => {
    await memberWithDevice(app, { status: 'locked' })
    const id = await insertNotification(app.pg)
    const transport = stubTransport()

    await dispatch(app, transport)

    const row = await notificationRow(app.pg, id)
    expect(row.status).toBe('done')
    expect(row.finished_at).not.toBeNull()
    expect(transport.calls).toHaveLength(0)
  })

  it('never sends an expo device through FCM or the reverse (FR-026)', async () => {
    const expo = await memberWithDevice(app, { provider: 'expo' })
    const fcm = await memberWithDevice(app, { provider: 'fcm' })
    await insertNotification(app.pg)
    const transport = stubTransport()

    await dispatch(app, transport)

    const byProvider = (p: string) => transport.calls.filter((c) => c.provider === p).flatMap((c) => c.messages.map((m) => m.token))
    expect(byProvider('expo')).toEqual([expo.token])
    expect(byProvider('fcm')).toEqual([fcm.token])
  })
})

describe.skipIf(!hasDatabase)('the push.deliver kill switch', () => {
  it('with the job disabled, neither a kick nor a tick sends', async () => {
    await memberWithDevice(app)
    await insertNotification(app.pg)
    const transport = stubTransport()
    app.pushTransport = transport
    await app.pg.query(`UPDATE job_definitions SET enabled = false WHERE name = 'push.deliver'`)

    // The kick's worker only ever calls runJob; so does the cron tick.
    await app.boss.send('push.dispatch', {}, { singletonKey: 'push.dispatch' })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await app.runJob('push.deliver')

    expect(transport.calls).toHaveLength(0)
  })

  it('re-enabled, a kick delivers and leaves a job_runs row', async () => {
    await memberWithDevice(app)
    await insertNotification(app.pg)
    const transport = stubTransport()
    app.pushTransport = transport
    const { rows: before } = await app.pg.query(`SELECT count(*)::int AS n FROM job_runs WHERE job_name = 'push.deliver'`)

    await app.boss.send('push.dispatch', {}, { singletonKey: 'push.dispatch' })
    for (let i = 0; i < 50 && transport.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    expect(transport.calls).toHaveLength(1)
    const { rows: after } = await app.pg.query(`SELECT count(*)::int AS n FROM job_runs WHERE job_name = 'push.deliver'`)
    expect(after[0].n).toBe(before[0].n + 1)
  })
})

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { checkReceipts } from '../../src/modules/push/application/receipts.ts'
import { stubTransport, resetPush, memberWithDevice, insertNotification } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Expo receipts (research R6, SC-007): a ticket says Expo accepted a message;
 * the receipt says whether the phone's platform did.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

async function sentDelivery(ticket: string, age = '20 minutes') {
  const member = await memberWithDevice(app)
  const id = await insertNotification(app.pg)
  const { rows } = await app.pg.query(
    `INSERT INTO push_deliveries (notification_id, device_id, member_id, provider, status, provider_ref, updated_at)
     VALUES ($1, $2, $3, 'expo', 'sent', $4, now() - $5::interval) RETURNING id`,
    [id, member.deviceId, member.id, ticket, age],
  )
  return { ...member, deliveryId: String(rows[0].id) }
}

const state = async (deliveryId: string) =>
  (await app.pg.query(
    `SELECT dl.status, dl.error_message, d.disabled_reason
       FROM push_deliveries dl LEFT JOIN push_devices d ON d.id = dl.device_id WHERE dl.id = $1`,
    [deliveryId],
  )).rows[0]

describe.skipIf(!hasDatabase)('push receipts', () => {
  it('disables the device on DeviceNotRegistered, and marks an ok receipt delivered', async () => {
    const dead = await sentDelivery('ticket-dead')
    const fine = await sentDelivery('ticket-ok')
    const transport = stubTransport()
    transport.receiptAnswers['ticket-dead'] = { status: 'error', permanent: true, error: 'DeviceNotRegistered' }
    transport.receiptAnswers['ticket-ok'] = { status: 'ok' }

    await checkReceipts(app, { transport })

    expect(await state(dead.deliveryId)).toMatchObject({
      status: 'failed', error_message: 'DeviceNotRegistered', disabled_reason: 'unregistered',
    })
    expect(await state(fine.deliveryId)).toMatchObject({ status: 'delivered', disabled_reason: null })
  })

  it('leaves tickets alone while their receipts are not ready, or once Expo has dropped them', async () => {
    const young = await sentDelivery('ticket-young', '2 minutes')
    const old = await sentDelivery('ticket-old', '30 hours')
    const transport = stubTransport()
    transport.receiptAnswers['ticket-young'] = { status: 'ok' }
    transport.receiptAnswers['ticket-old'] = { status: 'ok' }

    await checkReceipts(app, { transport })

    expect((await state(young.deliveryId)).status).toBe('sent')
    expect((await state(old.deliveryId)).status).toBe('sent')
  })
})

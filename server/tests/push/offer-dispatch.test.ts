import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { TITLE_MAX } from '@gwc/contracts/push'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import {
  stubTransport, resetPush, merchantOffer, publish, memberWithDevice, dispatch, notificationRow, deliveries,
  insertNotification,
} from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Sending an offer notification (US4; FR-006, FR-023; acceptance 4.3–4.5).
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

const idFor = async (offerId: string) =>
  String((await app.pg.query('SELECT id FROM push_notifications WHERE offer_id = $1', [offerId])).rows[0].id)

describe.skipIf(!hasDatabase)('offer notifications', () => {
  it('are not sent before valid_from, and are once it arrives', async () => {
    await memberWithDevice(app)
    const offer = await merchantOffer(app.pg, {
      validFrom: new Date(Date.now() + 3_600_000), validUntil: new Date(Date.now() + 30 * 86_400_000),
    })
    await publish(app.pg, offer.id)
    const id = await idFor(offer.id)
    const transport = stubTransport()

    await dispatch(app, transport)
    expect(transport.calls).toHaveLength(0)
    expect((await notificationRow(app.pg, id)).status).toBe('queued')

    // Counter-assertion: the hold ends. The offer becomes valid, and the
    // notification comes due.
    await app.pg.query(`UPDATE offers SET valid_from = now() - interval '1 minute' WHERE id = $1`, [offer.id])
    await app.pg.query(`UPDATE push_notifications SET not_before = now() WHERE id = $1`, [id])
    await dispatch(app, transport)
    expect(transport.calls).toHaveLength(1)
    expect((await notificationRow(app.pg, id)).status).toBe('done')
  })

  it('are cancelled, sending nothing, when the offer is withdrawn before dispatch', async () => {
    await memberWithDevice(app)
    const offer = await merchantOffer(app.pg)
    await publish(app.pg, offer.id)
    await app.pg.query(`UPDATE offers SET state = 'withdrawn' WHERE id = $1`, [offer.id])
    const transport = stubTransport()

    await dispatch(app, transport)

    const row = await notificationRow(app.pg, await idFor(offer.id))
    expect(row.status).toBe('cancelled')
    expect(row.finished_at).not.toBeNull()
    expect(transport.calls).toHaveLength(0)
  })

  it('are written from the merchant\'s public name, in both languages, truncated to fit', async () => {
    const de = await memberWithDevice(app, { locale: 'de' })
    const en = await memberWithDevice(app, { locale: 'en' })
    const offer = await merchantOffer(app.pg, {
      displayName: 'Konditorei mit einem ausgesprochen langen und ausführlichen Namen',
      title: 'Zwei Stück Kuchen zum Preis von einem',
    })
    await publish(app.pg, offer.id)
    const transport = stubTransport()

    await dispatch(app, transport)

    const sent = new Map(transport.calls.flatMap((c) => c.messages).map((m) => [m.token, m]))
    const deTitle = sent.get(de.token)!.title
    const enTitle = sent.get(en.token)!.title
    expect(deTitle.startsWith('Neues Angebot: Konditorei')).toBe(true)
    expect(enTitle.startsWith('New offer: Konditorei')).toBe(true)
    expect([...deTitle]).toHaveLength(TITLE_MAX)
    expect(deTitle.endsWith('…')).toBe(true)
    expect(sent.get(de.token)!.body).toBe('Zwei Stück Kuchen zum Preis von einem')
    expect(sent.get(de.token)!.data).toMatchObject({ type: 'offer', id: offer.id })
    // Never the legal name.
    expect(JSON.stringify([...sent.values()])).not.toContain('Push Test GmbH')
  })

  it('skip a member who switched offers off, while a broadcast still reaches them', async () => {
    const quiet = await memberWithDevice(app)
    const keen = await memberWithDevice(app)
    await app.pg.query(
      'INSERT INTO member_push_preferences (member_id, offers, broadcasts) VALUES ($1, false, true)', [quiet.id],
    )
    const offer = await merchantOffer(app.pg)
    await publish(app.pg, offer.id)
    const transport = stubTransport()
    await dispatch(app, transport)
    expect(transport.sentTokens()).toEqual([keen.token])
    expect((await deliveries(app.pg, await idFor(offer.id))).map((d) => d.device_id)).toEqual([keen.deviceId])

    // Counter-assertion: club news still reaches the member.
    const broadcast = await insertNotification(app.pg)
    const next = stubTransport()
    await dispatch(app, next)
    expect(next.sentTokens().sort()).toEqual([quiet.token, keen.token].sort())
    expect((await notificationRow(app.pg, broadcast)).status).toBe('done')
  })
})

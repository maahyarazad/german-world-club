import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetPush, merchantOffer, publish } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The offer trigger (029_offer_push_trigger.sql, US4, research R12; FR-021, FR-022).
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

const offerNotifications = async (offerId: string) =>
  (await app.pg.query(
    `SELECT kind, status, audience, not_before, idempotency_key, destination_type, destination_id
       FROM push_notifications WHERE offer_id = $1`,
    [offerId],
  )).rows

describe.skipIf(!hasDatabase)('publishing an offer queues its notification', () => {
  it('draft → published queues one, held until valid_from', async () => {
    const validFrom = new Date(Date.now() + 3 * 86_400_000)
    const offer = await merchantOffer(app.pg, { validFrom, validUntil: new Date(Date.now() + 30 * 86_400_000) })

    await publish(app.pg, offer.id)

    const rows = await offerNotifications(offer.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'offer', status: 'queued', audience: 'offers', idempotency_key: `offer:${offer.id}`,
      destination_type: 'offer', destination_id: offer.id,
    })
    expect(new Date(rows[0].not_before).getTime()).toBe(validFrom.getTime())
  })

  it('an offer already valid is due now, not at its past valid_from', async () => {
    const offer = await merchantOffer(app.pg)
    const before = Date.now()
    await publish(app.pg, offer.id)
    const [row] = await offerNotifications(offer.id)
    expect(new Date(row.not_before).getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('draft → pending queues nothing', async () => {
    // Counter-assertion: the trigger fires on publication, not on any change.
    const offer = await merchantOffer(app.pg)
    await app.pg.query(`UPDATE offers SET state = 'pending' WHERE id = $1`, [offer.id])
    expect(await offerNotifications(offer.id)).toHaveLength(0)
  })

  it('published → withdrawn → published announces once (FR-022)', async () => {
    const offer = await merchantOffer(app.pg)
    await publish(app.pg, offer.id)
    await app.pg.query(`UPDATE offers SET state = 'withdrawn' WHERE id = $1`, [offer.id])
    await publish(app.pg, offer.id)
    expect(await offerNotifications(offer.id)).toHaveLength(1)
  })

  it('queues nothing when the publication rolls back', async () => {
    const offer = await merchantOffer(app.pg)
    const client = await app.pg.connect()
    try {
      await client.query('BEGIN')
      await client.query(`UPDATE offers SET state = 'published', published_at = now() WHERE id = $1`, [offer.id])
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    expect(await offerNotifications(offer.id)).toHaveLength(0)
  })

  it('honours gwc.suppress_offer_push for the transaction that sets it, and only that one', async () => {
    const quiet = await merchantOffer(app.pg)
    const loud = await merchantOffer(app.pg)
    const client = await app.pg.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL gwc.suppress_offer_push = 'on'`)
      await client.query(`UPDATE offers SET state = 'published', published_at = now() WHERE id = $1`, [quiet.id])
      await client.query('COMMIT')
      // SET LOCAL ended with that transaction, on the same connection.
      await client.query(`UPDATE offers SET state = 'published', published_at = now() WHERE id = $1`, [loud.id])
    } finally {
      client.release()
    }
    expect(await offerNotifications(quiet.id)).toHaveLength(0)
    expect(await offerNotifications(loud.id)).toHaveLength(1)
  })

  it('queues an offer inserted already published', async () => {
    const offer = await merchantOffer(app.pg, { state: 'published' })
    expect(await offerNotifications(offer.id)).toHaveLength(1)
  })
})

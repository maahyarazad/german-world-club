import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetPush } from '../push/helpers.ts'
import { merchantWithStore, seedOffer, resetOffers } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035 (research R7): publishing an offer announces it to members ONCE.
 *
 * The announcement is queued by the `offers_queue_push` trigger, keyed
 * `offer:<id>`, so withdrawing and publishing again, a repeated request and two
 * simultaneous requests all leave one row. These tests assert that through the
 * merchant's own route — and that the application code never queues one itself,
 * which would be a second path outside the key's protection. The dispatch side
 * (at most once per device, cancelled when no longer visible) is covered by
 * tests/push/offer-trigger.test.ts and offer-dispatch.test.ts.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const DAY = 86_400_000
const notificationsFor = async (offerId: string) => {
  const { rows } = await app.pg.query(
    'SELECT idempotency_key, not_before, status FROM push_notifications WHERE offer_id = $1', [offerId],
  )
  return rows
}
const publish = (headers: Record<string, string>, id: string) =>
  app.inject({ method: 'POST', url: `/merchant/offers/${id}/publish`, headers })
const withdraw = (headers: Record<string, string>, id: string) =>
  app.inject({ method: 'POST', url: `/merchant/offers/${id}/withdraw`, headers })

describe.skipIf(!hasDatabase)('one announcement per offer', () => {
  it('queues exactly one notification when a draft is published', async () => {
    const merchant = await merchantWithStore(app)
    const id = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft' })
    expect(await notificationsFor(id)).toHaveLength(0)

    expect((await publish(merchant.headers, id)).statusCode).toBe(200)

    const rows = await notificationsFor(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].idempotency_key).toBe(`offer:${id}`)
  })

  it('does not queue another when the offer is withdrawn and published again', async () => {
    const merchant = await merchantWithStore(app)
    const id = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft' })
    await publish(merchant.headers, id)
    await withdraw(merchant.headers, id)
    await publish(merchant.headers, id)
    expect(await notificationsFor(id)).toHaveLength(1)
  })

  it('does not queue another for a repeated publish', async () => {
    const merchant = await merchantWithStore(app)
    const id = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft' })
    await publish(merchant.headers, id)
    await publish(merchant.headers, id)
    expect(await notificationsFor(id)).toHaveLength(1)
  })

  it('leaves one when two publish requests arrive at the same moment', async () => {
    const merchant = await merchantWithStore(app)
    const id = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft' })
    const results = await Promise.all([publish(merchant.headers, id), publish(merchant.headers, id)])
    expect(results.map((r) => r.statusCode)).toEqual([200, 200])
    expect(await notificationsFor(id)).toHaveLength(1)
  })

  it('holds the announcement until the offer starts', async () => {
    const merchant = await merchantWithStore(app)
    const validFrom = new Date(Date.now() + 5 * DAY)
    const id = await seedOffer(app.pg, {
      organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft',
      validFrom, validUntil: new Date(Date.now() + 40 * DAY),
    })
    await publish(merchant.headers, id)
    const [row] = await notificationsFor(id)
    expect(new Date(row.not_before).getTime()).toBeGreaterThanOrEqual(validFrom.getTime() - 1000)
  })

  it('queues nothing for an offer that is never published, and one each for two offers', async () => {
    const merchant = await merchantWithStore(app)
    const draftOnly = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft' })
    const a = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft' })
    const b = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft' })
    await publish(merchant.headers, a)
    await publish(merchant.headers, b)

    expect(await notificationsFor(draftOnly)).toHaveLength(0)
    // Counter-assertion: the key is per offer, not global.
    expect(await notificationsFor(a)).toHaveLength(1)
    expect(await notificationsFor(b)).toHaveLength(1)
  })

  it('queues nothing when a publish is refused', async () => {
    const merchant = await merchantWithStore(app, { profile: false })
    const id = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft' })
    expect((await publish(merchant.headers, id)).statusCode).toBe(403)
    expect(await notificationsFor(id)).toHaveLength(0)
  })
})

describe('the application code never queues a notification itself', () => {
  function* sourceFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) yield* sourceFiles(full)
      else if (entry.endsWith('.ts')) yield full
    }
  }
  const files = [...sourceFiles(join(process.cwd(), 'src/modules/offers')), ...sourceFiles(join(process.cwd(), 'src/modules/stores'))]

  it('has files to scan — the suite is not vacuous', () => {
    expect(files.length).toBeGreaterThan(3)
  })

  it('has no INSERT INTO push_notifications outside the trigger', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/INSERT\s+INTO\s+push_notifications/i)
    }
    // Counter-assertion: the scan would see one.
    expect('INSERT INTO push_notifications (kind)').toMatch(/INSERT\s+INTO\s+push_notifications/i)
  })
})

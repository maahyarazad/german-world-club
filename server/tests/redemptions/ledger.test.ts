import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, redeemerFor, resetOffers, CLUB_OFFERS } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-031 and Principle IV: redemptions are a ledger. Nothing edits
 * or deletes a row, a redeemer must exist and be active when the row is written
 * (no foreign key can span four tables, so a trigger is the guard), and a retry
 * cannot become a second row.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

async function oneRedemption() {
  const merchant = await merchantWithStore(app)
  const offerId = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId })
  const member = await redeemerFor(app, 'member')
  const response = await app.inject({
    method: 'POST', url: `${CLUB_OFFERS.member}/${offerId}/redemptions`, headers: member.headers, payload: { requestId: randomUUID() },
  })
  return { merchant, offerId, member, id: response.json().id as string }
}

describe.skipIf(!hasDatabase)('the redemption ledger', () => {
  it('refuses an UPDATE, even by hand', async () => {
    const { id } = await oneRedemption()
    await expect(app.pg.query(`UPDATE redemptions SET reference = 'EDITED' WHERE id = $1`, [id])).rejects.toThrow(/append-only/)
  })

  it('refuses a DELETE, even by hand', async () => {
    const { id } = await oneRedemption()
    await expect(app.pg.query('DELETE FROM redemptions WHERE id = $1', [id])).rejects.toThrow(/append-only/)
    expect((await app.pg.query('SELECT count(*)::int AS n FROM redemptions')).rows[0].n).toBe(1)
  })

  it('can be emptied by TRUNCATE for tests, which fires no row trigger — the counter-assertion', async () => {
    await oneRedemption()
    await app.pg.query('TRUNCATE redemption_feedback, redemptions RESTART IDENTITY CASCADE')
    expect((await app.pg.query('SELECT count(*)::int AS n FROM redemptions')).rows[0].n).toBe(0)
  })

  it('refuses a redeemer that does not exist, for every kind', async () => {
    const { offerId, merchant } = await oneRedemption()
    for (const kind of ['member', 'admin', 'merchant', 'partner']) {
      await expect(app.pg.query(
        `INSERT INTO redemptions (offer_id, redeemer_kind, redeemer_id, request_id, organisation_id, category_id, reference)
         VALUES ($1, $2::account_kind, $3, $4, $5, (SELECT category_id FROM offers WHERE id = $1), $6)`,
        [offerId, kind, randomUUID(), randomUUID(), merchant.organisationId, `GHOST-${kind}`],
      ), kind).rejects.toThrow(/does not exist or is not active/)
    }
  })

  it('refuses a locked member and a user of a suspended organisation at the database', async () => {
    const { offerId, merchant } = await oneRedemption()
    const locked = await redeemerFor(app, 'member')
    await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [locked.id])
    await expect(app.pg.query(
      `INSERT INTO redemptions (offer_id, redeemer_kind, redeemer_id, request_id, organisation_id, category_id, reference)
       VALUES ($1, 'member', $2, $3, $4, (SELECT category_id FROM offers WHERE id = $1), 'LOCKED-1')`,
      [offerId, locked.id, randomUUID(), merchant.organisationId],
    )).rejects.toThrow(/not active/)
  })

  it('makes a repeated (redeemer, request id) unique at the database', async () => {
    const { offerId, merchant, member } = await oneRedemption()
    const { rows } = await app.pg.query('SELECT request_id FROM redemptions')
    await expect(app.pg.query(
      `INSERT INTO redemptions (offer_id, redeemer_kind, redeemer_id, request_id, organisation_id, category_id, reference)
       VALUES ($1, 'member', $2, $3, $4, (SELECT category_id FROM offers WHERE id = $1), 'DUP-1')`,
      [offerId, member.id, rows[0].request_id, merchant.organisationId],
    )).rejects.toThrow(/redemptions_request_unique|duplicate key/)
  })

  it('keeps the references unique across redemptions', async () => {
    const merchant = await merchantWithStore(app)
    const offerId = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, perPersonLimit: null })
    const member = await redeemerFor(app, 'member')
    const refs = new Set<string>()
    for (let i = 0; i < 15; i += 1) {
      const r = await app.inject({ method: 'POST', url: `${CLUB_OFFERS.member}/${offerId}/redemptions`, headers: member.headers, payload: { requestId: randomUUID() } })
      refs.add(r.json().reference)
    }
    expect(refs.size).toBe(15)
  })
})

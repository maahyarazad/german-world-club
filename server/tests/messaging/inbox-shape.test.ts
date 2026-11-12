import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetMarketplace } from '../marketplace/helpers.ts'
import { poster, seedListing, resetMessaging, inquire, inbox, readConversation } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 020, research R8: the inbox and a conversation say what they are
 * about — the listing's title, the other person's name, the latest message —
 * in the @gwc/contracts/messaging shape, and still nothing that identifies
 * either person beyond their platform name (008 FR-026).
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

describe.skipIf(!hasDatabase)('the inbox says what each conversation is about', () => {
  let seller: Awaited<ReturnType<typeof poster>>
  let buyer: Awaited<ReturnType<typeof poster>>
  let listingId: string

  beforeEach(async () => {
    await resetMessaging(app.pg)
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    seller = await poster(app)
    buyer = await poster(app)
    await app.pg.query(`UPDATE members SET display_name = 'Sabine Seller', mobile = '+4915100000001' WHERE id = $1`, [seller.id])
    await app.pg.query(`UPDATE members SET display_name = 'Bernd Buyer', mobile = '+4915100000002', handle = 'bernd' WHERE id = $1`, [buyer.id])
    listingId = await seedListing(app.pg, { ownerId: seller.id, title: 'Kinderfahrrad 20 Zoll' })
  })

  it('names the listing, the other person and the latest message', async () => {
    const sent = await inquire(app, buyer.headers, listingId, 'Is the bike still there?')
    expect(sent.statusCode).toBe(201)
    const conversationId = sent.json().conversationId

    const forSeller = (await inbox(app, seller.headers)).json().items[0]
    expect(forSeller).toMatchObject({
      id: conversationId,
      subject: { type: 'marketplace_listing', id: listingId, title: 'Kinderfahrrad 20 Zoll' },
      counterpart: { memberId: buyer.id, displayName: 'Bernd Buyer', handle: 'bernd' },
      lastMessage: { senderId: buyer.id, excerpt: 'Is the bike still there?' },
      unreadCount: 1,
    })

    const view = (await readConversation(app, seller.headers, conversationId)).json()
    expect(view.conversation).toMatchObject({
      subject: { title: 'Kinderfahrrad 20 Zoll' },
      counterpart: { displayName: 'Bernd Buyer' },
    })
  })

  it('shows each side the other person', async () => {
    // Counter-assertion: `counterpart` is "not me", not "the first participant".
    const sent = await inquire(app, buyer.headers, listingId)
    expect(sent.statusCode).toBe(201)
    const forBuyer = (await inbox(app, buyer.headers)).json().items[0]
    expect(forBuyer.counterpart).toMatchObject({ memberId: seller.id, displayName: 'Sabine Seller' })
  })

  it('cuts the excerpt to 140 characters', async () => {
    await inquire(app, buyer.headers, listingId, 'x'.repeat(500))
    const item = (await inbox(app, seller.headers)).json().items[0]
    expect(item.lastMessage.excerpt).toHaveLength(140)
  })

  it('carries no email address or phone number of either person', async () => {
    const sent = await inquire(app, buyer.headers, listingId)
    const { rows } = await app.pg.query('SELECT email, mobile FROM members WHERE id = ANY($1)', [[seller.id, buyer.id]])
    const bodies = [
      (await inbox(app, seller.headers)).body,
      (await inbox(app, buyer.headers)).body,
      (await readConversation(app, seller.headers, sent.json().conversationId)).body,
    ].join('\n')
    for (const row of rows) {
      expect(bodies).not.toContain(row.email)
      expect(bodies).not.toContain(row.mobile)
    }
  })
})

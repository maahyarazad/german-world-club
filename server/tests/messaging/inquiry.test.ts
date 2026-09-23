import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetMarketplace } from '../marketplace/helpers.ts'
import {
  poster, seedListing, resetMessaging, inquire, reply, readConversation, inbox,
} from './helpers.ts'
import type { TestMessage, TestParticipant, TestConversation } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The inquiry flow (US5, FR-025, FR-027, SC-011).
 *
 * §7's contact method, made real: a member asks about a listing, the owner
 * answers, and the exchange survives both of them going away. Asynchrony is the
 * point — nothing here has the two parties online at the same time, because
 * persistence is the substrate and real-time is a later, additive feature.
 */

/**
 * One app for the whole file. A second `buildAuthApp()` in the same process
 * collides on `ops/jobs.ts`'s named cron jobs, and the collision does not
 * surface as a clear error — it surfaces as the two apps contending on the
 * TRUNCATEs in `beforeEach` until the hook times out.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

let seller: Awaited<ReturnType<typeof poster>>
let buyer: Awaited<ReturnType<typeof poster>>

async function freshParticipants() {
  await resetMessaging(app.pg)
  await resetMarketplace(app.pg)
  await resetAuthTables(app.pg)
  seller = await poster(app)
  buyer = await poster(app)
}

describe.skipIf(!hasDatabase)('a member contacts a seller', () => {
  let listingId: string

  beforeEach(async () => {
    await freshParticipants()
    listingId = await seedListing(app.pg, { ownerId: seller.id, title: 'A bicycle' })
  })

  it('creates a conversation linked to the listing', async () => {
    const response = await inquire(app, buyer.headers, listingId)

    expect(response.statusCode).toBe(201)
    expect(response.json().created).toBe(true)
    expect(response.json().conversationId).toBeTruthy()

    const { rows } = await app.pg.query(
      'SELECT subject_type, subject_id FROM conversations WHERE id = $1',
      [response.json().conversationId],
    )
    expect(rows[0].subject_type).toBe('marketplace_listing')
    expect(String(rows[0].subject_id)).toBe(listingId)
  })

  it('carries the exchange between two members who are never online together', async () => {
    const started = await inquire(app, buyer.headers, listingId, 'Is the bicycle still available?')
    const conversationId = started.json().conversationId

    // The seller reads it later, from their own session.
    const sellerView = await readConversation(app, seller.headers, conversationId)
    expect(sellerView.statusCode).toBe(200)
    expect(sellerView.json().messages.map((m: TestMessage) => m.body))
      .toContain('Is the bicycle still available?')

    const answered = await reply(app, seller.headers, conversationId, 'Yes, come by Saturday.')
    expect(answered.statusCode).toBe(201)

    // And the buyer reads the reply later still.
    const buyerView = await readConversation(app, buyer.headers, conversationId)
    expect(buyerView.json().messages.map((m: TestMessage) => m.body)).toContain('Yes, come by Saturday.')
    expect(buyerView.json().messages).toHaveLength(2)
  })

  it('puts both parties in the conversation, and nobody else', async () => {
    const started = await inquire(app, buyer.headers, listingId)
    const view = await readConversation(app, seller.headers, started.json().conversationId)

    const ids = view.json().participants.map((p: TestParticipant) => p.memberId).sort()
    expect(ids).toEqual([seller.id, buyer.id].sort())
  })

  it('appends to the existing thread rather than opening a second one', async () => {
    const first = await inquire(app, buyer.headers, listingId, 'Still available?')
    const second = await inquire(app, buyer.headers, listingId, 'Would you take less?')

    expect(second.statusCode).toBe(201)
    // Two threads about one listing between the same two people is a split
    // conversation where each party sees half of what was said.
    expect(second.json().created).toBe(false)
    expect(second.json().conversationId).toBe(first.json().conversationId)

    const view = await readConversation(app, buyer.headers, first.json().conversationId)
    expect(view.json().messages).toHaveLength(2)
  })

  it('shows the conversation in both inboxes, newest activity first', async () => {
    const started = await inquire(app, buyer.headers, listingId)
    const conversationId = started.json().conversationId

    for (const who of [buyer, seller]) {
      const list = await inbox(app, who.headers)
      expect(list.statusCode).toBe(200)
      expect(list.json().items.map((c: TestConversation) => c.id)).toContain(conversationId)
    }
  })

  it('moves a conversation up the inbox when it gets a reply', async () => {
    const older = await inquire(app, buyer.headers, listingId, 'About the bicycle')
    const second = await seedListing(app.pg, { ownerId: seller.id, title: 'A desk' })
    const newer = await inquire(app, buyer.headers, second, 'About the desk')

    // `last_message_at` is the ordering key, maintained on every append (T061).
    expect((await inbox(app, buyer.headers)).json().items[0].id)
      .toBe(newer.json().conversationId)

    await reply(app, seller.headers, older.json().conversationId, 'Still here.')

    expect((await inbox(app, buyer.headers)).json().items[0].id)
      .toBe(older.json().conversationId)
  })

  it('counts unread messages for the other party only', async () => {
    const started = await inquire(app, buyer.headers, listingId)
    const conversationId = started.json().conversationId

    const sellerInbox = await inbox(app, seller.headers)
    const forSeller = sellerInbox.json().items.find((c: TestConversation) => c.id === conversationId)
    expect(forSeller.unreadCount).toBe(1)

    // Counter-assertion: your own message is not unread to you.
    const buyerInbox = await inbox(app, buyer.headers)
    const forBuyer = buyerInbox.json().items.find((c: TestConversation) => c.id === conversationId)
    expect(forBuyer.unreadCount).toBe(0)
  })

  it('clears the unread count once read — delivery is on read', async () => {
    const started = await inquire(app, buyer.headers, listingId)
    const conversationId = started.json().conversationId

    await readConversation(app, seller.headers, conversationId)

    const after = (await inbox(app, seller.headers)).json().items
      .find((c: TestConversation) => c.id === conversationId)
    expect(after.unreadCount).toBe(0)
  })
})

describe.skipIf(!hasDatabase)('what an inquiry refuses', () => {
  beforeEach(freshParticipants)

  it('refuses an inquiry on your own listing', async () => {
    const own = await seedListing(app.pg, { ownerId: seller.id })
    const response = await inquire(app, seller.headers, own)

    expect(response.statusCode).toBe(400)
    expect(response.json().type).toMatch(/validation-failed/)
  })

  it.each(['withdrawn', 'sold', 'hidden', 'expired'])(
    'refuses a new inquiry on a %s listing with 410',
    async (state) => {
      const listing = await seedListing(app.pg, { ownerId: seller.id, state })
      const response = await inquire(app, buyer.headers, listing)

      // 410, not 404: it existed and stopped accepting enquiries. A 404 would
      // say it never existed, which is a different fact.
      expect(response.statusCode).toBe(410)
    },
  )

  it('leaves an EXISTING conversation readable after the listing is withdrawn (FR-027)', async () => {
    const listing = await seedListing(app.pg, { ownerId: seller.id })
    const started = await inquire(app, buyer.headers, listing, 'Interested!')
    const conversationId = started.json().conversationId

    await app.pg.query(
      `UPDATE marketplace_listings SET state = 'withdrawn' WHERE id = $1`,
      [listing],
    )

    // The headline of FR-027: two people mid-negotiation when the seller
    // withdraws must not lose the thread, and the record of what was agreed
    // goes with it if the conversation vanishes.
    const view = await readConversation(app, buyer.headers, conversationId)
    expect(view.statusCode).toBe(200)
    expect(view.json().messages.map((m: TestMessage) => m.body)).toContain('Interested!')

    // And both may still speak in it.
    expect((await reply(app, seller.headers, conversationId, 'Sorry, sold elsewhere.')).statusCode)
      .toBe(201)

    // The counter-assertion: a NEW inquiry is still refused.
    expect((await inquire(app, buyer.headers, listing)).statusCode).toBe(410)
  })

  it('refuses an inquiry about a listing that does not exist', async () => {
    const response = await inquire(app, buyer.headers, '00000000-0000-0000-0000-000000000000')
    expect(response.statusCode).toBe(404)
  })

  it('refuses an empty message, and one past the ceiling', async () => {
    const listing = await seedListing(app.pg, { ownerId: seller.id })
    expect((await inquire(app, buyer.headers, listing, '')).statusCode).toBe(400)
    expect((await inquire(app, buyer.headers, listing, 'x'.repeat(4001))).statusCode).toBe(400)

    // Counter-assertion: a reasonable message is accepted.
    expect((await inquire(app, buyer.headers, listing, 'Hello')).statusCode).toBe(201)
  })
})

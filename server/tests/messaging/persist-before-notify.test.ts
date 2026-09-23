import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetMarketplace } from '../marketplace/helpers.ts'
import {
  poster, seedListing, resetMessaging, inquire, reply, readConversation,
} from './helpers.ts'
import type { TestMessage } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * SC-011 — a message is persisted BEFORE it is notified.
 *
 * The Technology & Security Baseline: "Real-time transport is additive — a
 * message MUST be persisted before it is delivered, so a dropped connection
 * never loses data."
 *
 * The failure this guards against is silent. Notify inside the transaction and
 * everything works until the day the push provider is down — at which point the
 * transaction rolls back and the message the sender was told was accepted is
 * gone. Nothing logs a lost message, because from the database's point of view
 * nothing happened.
 *
 * So every test here **deliberately fails the notification path**. A happy-path
 * test passes against an implementation that notifies inside the transaction,
 * which is exactly the implementation this exists to reject.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

let seller: Awaited<ReturnType<typeof poster>>
let buyer: Awaited<ReturnType<typeof poster>>
let listingId: string

/** Replaces the notification seam with one that always throws. */
function breakNotifications() {
  const calls: unknown[] = []
  app.notifyMessage = async (event) => {
    calls.push(event)
    throw new Error('push provider is down')
  }
  return calls
}

beforeEach(async () => {
  await resetMessaging(app.pg)
  await resetMarketplace(app.pg)
  await resetAuthTables(app.pg)
  seller = await poster(app)
  buyer = await poster(app)
  listingId = await seedListing(app.pg, { ownerId: seller.id })
})

afterAll(() => { app.notifyMessage = undefined })

describe.skipIf(!hasDatabase)('a failing notification never costs a message', () => {
  it('accepts an inquiry whose notification throws', async () => {
    const calls = breakNotifications()

    const response = await inquire(app, buyer.headers, listingId, 'Is this available?')

    // The sender is told it was accepted — and it genuinely was.
    expect(response.statusCode).toBe(201)
    // The counter-assertion for the whole file: if this is empty, the
    // notification path was never reached and the tests below prove nothing.
    expect(calls.length, 'the notification path was never exercised').toBe(1)
  })

  it('leaves that message in the database', async () => {
    breakNotifications()
    const response = await inquire(app, buyer.headers, listingId, 'Is this available?')

    const { rows } = await app.pg.query(
      'SELECT body FROM messages WHERE conversation_id = $1',
      [response.json().conversationId],
    )
    expect(rows.map((r) => r.body)).toContain('Is this available?')
  })

  it('leaves it READABLE by the recipient — the assertion SC-011 actually names', async () => {
    breakNotifications()
    const response = await inquire(app, buyer.headers, listingId, 'Is this available?')

    // Not just present in a table: reachable by the person it was sent to,
    // through the API they would actually use.
    const view = await readConversation(app, seller.headers, response.json().conversationId)
    expect(view.statusCode).toBe(200)
    expect(view.json().messages.map((m: TestMessage) => m.body)).toContain('Is this available?')
  })

  it('does the same for a reply, not only for the opening message', async () => {
    const conversationId = (await inquire(app, buyer.headers, listingId)).json().conversationId

    const calls = breakNotifications()
    const answered = await reply(app, seller.headers, conversationId, 'Yes — Saturday works.')

    expect(answered.statusCode).toBe(201)
    expect(calls.length).toBe(1)

    const view = await readConversation(app, buyer.headers, conversationId)
    expect(view.json().messages.map((m: TestMessage) => m.body)).toContain('Yes — Saturday works.')
  })

  it('keeps the conversation ordering key correct despite the failure', async () => {
    const conversationId = (await inquire(app, buyer.headers, listingId)).json().conversationId
    const { rows: before } = await app.pg.query(
      'SELECT last_message_at FROM conversations WHERE id = $1', [conversationId],
    )

    breakNotifications()
    await reply(app, seller.headers, conversationId, 'Later message.')

    const { rows: after } = await app.pg.query(
      'SELECT last_message_at FROM conversations WHERE id = $1', [conversationId],
    )
    // The append and the ordering key are in one transaction; the notification
    // is outside it. A failure outside must not leave the inbox stale.
    expect(new Date(after[0].last_message_at).getTime())
      .toBeGreaterThan(new Date(before[0].last_message_at).getTime())
  })

  it('STILL succeeds when the notification works — the other half', async () => {
    // Without this, an implementation that had simply stopped notifying
    // altogether would pass every test above.
    const delivered: unknown[] = []
    app.notifyMessage = async (event) => { delivered.push(event) }

    const response = await inquire(app, buyer.headers, listingId, 'Hello there.')

    expect(response.statusCode).toBe(201)
    expect(delivered).toHaveLength(1)
    // And it names the recipient, not the sender.
    expect((delivered[0] as { recipientIds: string[] }).recipientIds).toEqual([seller.id])
  })
})

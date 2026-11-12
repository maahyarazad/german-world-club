import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetMarketplace } from '../marketplace/helpers.ts'
import { poster, seedListing, resetMessaging, inquire, reply } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 020 US2: every message emails the other participant (Q1), through
 * the mail outbox, combined so a burst is one email and nothing is dropped
 * (research R3), and never to somebody who cannot or should not get it (R4).
 * Read straight from `mail_outbox`: the outbox IS the promise to send.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

type OutboxRow = { message_id: string; to_address: string; template: string; variables: Record<string, any>; next_attempt_at: Date; sent_at: Date | null }

describe.skipIf(!hasDatabase)('message emails', () => {
  let seller: Awaited<ReturnType<typeof poster>>
  let buyer: Awaited<ReturnType<typeof poster>>
  let listingId: string
  let emails: { seller: string; buyer: string }
  const original = () => app.notifyMessage

  beforeEach(async () => {
    await resetMessaging(app.pg)
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    await app.pg.query('TRUNCATE message_mail_schedule')
    seller = await poster(app)
    buyer = await poster(app)
    await app.pg.query(`UPDATE members SET display_name = 'Sabine Seller', mobile = '+4915100000001' WHERE id = $1`, [seller.id])
    await app.pg.query(`UPDATE members SET display_name = 'Bernd Buyer', mobile = '+4915100000002' WHERE id = $1`, [buyer.id])
    const { rows } = await app.pg.query('SELECT id, email FROM members WHERE id = ANY($1)', [[seller.id, buyer.id]])
    emails = {
      seller: rows.find((r) => r.id === seller.id).email,
      buyer: rows.find((r) => r.id === buyer.id).email,
    }
    listingId = await seedListing(app.pg, { ownerId: seller.id, title: 'Kinderfahrrad 20 Zoll' })
  })

  const outboxTo = async (address: string): Promise<OutboxRow[]> =>
    (await app.pg.query(
      `SELECT message_id, to_address::text, template, variables, next_attempt_at, sent_at
         FROM mail_outbox WHERE to_address = $1 AND template = 'messaging.new-message' ORDER BY created_at`,
      [address],
    )).rows

  it('emails the owner once when a request arrives, about a minute later', async () => {
    const started = Date.now()
    expect((await inquire(app, buyer.headers, listingId, 'Is the bike still there?')).statusCode).toBe(201)

    const rows = await outboxTo(emails.seller)
    expect(rows).toHaveLength(1)
    const delay = rows[0]!.next_attempt_at.getTime() - started
    expect(delay).toBeGreaterThan(50_000)
    expect(delay).toBeLessThan(75_000)
    expect(rows[0]!.variables).toMatchObject({
      listingTitle: 'Kinderfahrrad 20 Zoll',
      count: 1,
      messages: [{ senderName: 'Bernd Buyer', body: 'Is the bike still there?' }],
    })
    // Nothing to the sender about their own message.
    expect(await outboxTo(emails.buyer)).toHaveLength(0)
  })

  it('combines a burst into one email that says how many', async () => {
    const first = await inquire(app, buyer.headers, listingId, 'message 1')
    const conversationId = first.json().conversationId
    for (let i = 2; i <= 10; i++) expect((await reply(app, buyer.headers, conversationId, `message ${i}`)).statusCode).toBe(201)

    const rows = await outboxTo(emails.seller)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.variables.count).toBe(10)
    expect(rows[0]!.variables.messages.map((m: { body: string }) => m.body)).toEqual(['message 10', 'message 9', 'message 8'])
  })

  it('schedules the next email at least 15 minutes after the last one, dropping nothing', async () => {
    const first = await inquire(app, buyer.headers, listingId, 'first')
    const conversationId = first.json().conversationId
    const [sent] = await outboxTo(emails.seller)
    // The job sends it (and clears it, as mail.deliver does).
    await app.pg.query(`UPDATE mail_outbox SET sent_at = now(), variables = '{}' WHERE message_id = $1`, [sent!.message_id])

    await reply(app, buyer.headers, conversationId, 'second')
    const rows = await outboxTo(emails.seller)
    expect(rows).toHaveLength(2)
    expect(rows[1]!.next_attempt_at.getTime() - sent!.next_attempt_at.getTime()).toBeGreaterThanOrEqual(15 * 60_000)
    expect(rows[1]!.variables.messages[0].body).toBe('second')
  })

  it('does not merge into an email the job has already picked up', async () => {
    const first = await inquire(app, buyer.headers, listingId, 'first')
    const [picked] = await outboxTo(emails.seller)
    // What deliverDueMail's lease does: move next_attempt_at.
    await app.pg.query(`UPDATE mail_outbox SET next_attempt_at = now() + interval '5 minutes' WHERE message_id = $1`, [picked!.message_id])

    await reply(app, buyer.headers, first.json().conversationId, 'while sending')
    const rows = await outboxTo(emails.seller)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.variables.count).toBe(1)
    expect(rows[1]!.variables.messages[0].body).toBe('while sending')
  })

  it('emails the requester when the owner replies', async () => {
    const first = await inquire(app, buyer.headers, listingId, 'Hello')
    await reply(app, seller.headers, first.json().conversationId, 'Yes, still here.')
    const rows = await outboxTo(emails.buyer)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.variables.messages[0]).toMatchObject({ senderName: 'Sabine Seller', body: 'Yes, still here.' })
  })

  it.each([
    ['locked', `UPDATE members SET status = 'locked' WHERE id = $1`],
    ['suppressed after bounces', `UPDATE members SET email_suppressed = true WHERE id = $1`],
  ])('sends nothing to a recipient who is %s', async (_case, sql) => {
    const first = await inquire(app, buyer.headers, listingId, 'Hello')
    await app.pg.query('DELETE FROM mail_outbox')
    await app.pg.query(sql, [buyer.id])
    await reply(app, seller.headers, first.json().conversationId, 'Reply')
    expect(await outboxTo(emails.buyer)).toHaveLength(0)
  })

  it('sends nothing across a block', async () => {
    const first = await inquire(app, buyer.headers, listingId, 'Hello')
    await app.pg.query('DELETE FROM mail_outbox')
    await app.pg.query('INSERT INTO member_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [buyer.id, seller.id])
    await reply(app, seller.headers, first.json().conversationId, 'Reply')
    expect(await outboxTo(emails.buyer)).toHaveLength(0)
  })

  it('puts no email address or phone number into the email', async () => {
    await inquire(app, buyer.headers, listingId, 'Hello')
    const [row] = await outboxTo(emails.seller)
    const variables = JSON.stringify(row!.variables)
    for (const value of [emails.buyer, emails.seller, '+4915100000001', '+4915100000002']) {
      expect(variables).not.toContain(value)
    }
  })

  it('writes nothing when no notifier is installed', async () => {
    // Counter-assertion: the rows above come from this feature's notifier.
    const installed = original()
    app.notifyMessage = undefined
    try {
      await inquire(app, buyer.headers, listingId, 'Hello')
      expect(await outboxTo(emails.seller)).toHaveLength(0)
    } finally {
      app.notifyMessage = installed
    }
  })
})

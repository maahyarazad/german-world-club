import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetMarketplace } from '../marketplace/helpers.ts'
import {
  poster, seedListing, resetMessaging, inquire, reply, readConversation, inbox,
} from './helpers.ts'
import type { TestMessage, TestParticipant, TestConversation } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-026 — no messaging or marketplace response carries an email address or a
 * phone number, for either party.
 *
 * A conversation payload already holds two members' data in one object, and
 * constitution 2.0.0 removed the response schemas that used to shape it. The
 * only thing standing between `members.email` and this payload is the
 * explicit-columns rule, so the assertion is specific here rather than left to
 * the general convention.
 *
 * The values are asserted against the REAL fixtures' address and number rather
 * than a regex alone: a regex proves no string looks like an email, while
 * naming the actual values proves this particular member's details did not
 * travel.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

/** Anything shaped like an address or a number, in a whole serialized payload. */
const EMAIL_SHAPED = /[\w.+-]+@[\w-]+\.[\w.]+/
const PHONE_SHAPED = /\+?\d[\d\s().-]{7,}\d/

/**
 * Timestamps and uuids, removed before the shape test.
 *
 * `2026-09-22T14:23:45.678Z` is digits and separators, so it matches
 * PHONE_SHAPED, and every payload here is full of them. Leaving them in makes
 * the assertion fire on every response regardless of what it carries — a test
 * that fails for a reason unrelated to its subject is worse than no test,
 * because the next person deletes it.
 *
 * This only narrows the *shape* net. The assertion that actually proves the
 * absence is the one above it, which names the fixtures' real values.
 */
const withoutTimestampsAndIds = (body: string) =>
  body
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')

describe.skipIf(!hasDatabase)('no contact detail reaches any response', () => {
  let seller: Awaited<ReturnType<typeof poster>>
  let buyer: Awaited<ReturnType<typeof poster>>
  let listingId: string
  let conversationId: string
  let details: string[]

  beforeEach(async () => {
    await resetMessaging(app.pg)
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    seller = await poster(app)
    buyer = await poster(app)

    // Give both parties a real address and a real number, so there is
    // something to leak. Without this the suite would pass against a server
    // that emitted nulls it never had.
    for (const who of [seller, buyer]) {
      await app.pg.query(
        `UPDATE members SET mobile = $2, display_name = $3 WHERE id = $1`,
        [who.id, `+9715${Math.floor(1000000 + Math.random() * 8999999)}`, 'A Member'],
      )
    }
    const { rows } = await app.pg.query(
      'SELECT email, mobile FROM members WHERE id = ANY($1::uuid[])',
      [[seller.id, buyer.id]],
    )
    details = rows.flatMap((r) => [String(r.email), String(r.mobile)])
    expect(details.every(Boolean), 'fixtures have no contact details to leak').toBe(true)

    listingId = await seedListing(app.pg, { ownerId: seller.id })
    conversationId = (await inquire(app, buyer.headers, listingId)).json().conversationId
    await reply(app, seller.headers, conversationId, 'Yes, still here.')
  })

  const payloads = async () => [
    ['inbox (buyer)', await inbox(app, buyer.headers)],
    ['inbox (seller)', await inbox(app, seller.headers)],
    ['conversation (buyer)', await readConversation(app, buyer.headers, conversationId)],
    ['conversation (seller)', await readConversation(app, seller.headers, conversationId)],
    ['listing', await app.inject({
      method: 'GET', url: `/marketplace/listings/${listingId}`, headers: buyer.headers,
    })],
    ['listing index', await app.inject({
      method: 'GET', url: '/marketplace/listings', headers: buyer.headers,
    })],
  ] as const

  it('carries neither fixture\'s email address or mobile number', async () => {
    for (const [label, response] of await payloads()) {
      expect(response.statusCode, label).toBe(200)
      const body = response.body
      for (const detail of details) {
        expect(body, `${label} leaked ${detail}`).not.toContain(detail)
      }
    }
  })

  it('carries nothing even SHAPED like an address or a number', async () => {
    // The broader net: it catches a leak through a column nobody thought of,
    // including one added to `members` after this test was written.
    for (const [label, response] of await payloads()) {
      const body = withoutTimestampsAndIds(response.body)
      expect(EMAIL_SHAPED.test(body), `${label} contains an email-shaped string`).toBe(false)
      expect(PHONE_SHAPED.test(body), `${label} contains a phone-shaped string`).toBe(false)
    }
  })

  it('STILL carries the display identity — the counter-assertion', async () => {
    // Without this, a server that returned empty objects would satisfy every
    // assertion above while making the feature useless.
    const view = await readConversation(app, buyer.headers, conversationId)
    expect(view.json().participants).toHaveLength(2)
    expect(view.json().participants.map((p: TestParticipant) => p.displayName)).toContain('A Member')
    expect(view.json().messages.map((m: TestMessage) => m.body)).toContain('Yes, still here.')
  })
})

describe.skipIf(!hasDatabase)('a non-participant cannot tell a conversation exists', () => {
  let seller: Awaited<ReturnType<typeof poster>>
  let buyer: Awaited<ReturnType<typeof poster>>
  let stranger: Awaited<ReturnType<typeof poster>>
  let conversationId: string

  beforeEach(async () => {
    await resetMessaging(app.pg)
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    seller = await poster(app)
    buyer = await poster(app)
    stranger = await poster(app)

    const listing = await seedListing(app.pg, { ownerId: seller.id })
    conversationId = (await inquire(app, buyer.headers, listing)).json().conversationId
  })

  it('answers 404 to a real conversation they are not in', async () => {
    const response = await readConversation(app, stranger.headers, conversationId)
    // 403 would confirm it exists, turning id-guessing into discovering who is
    // talking to whom. For private correspondence that is worse than for a
    // listing — the `guardOrganisationScope` precedent.
    expect(response.statusCode).toBe(404)
  })

  it('answers BYTE-IDENTICALLY for a conversation that does not exist', async () => {
    const real = await readConversation(app, stranger.headers, conversationId)
    const imaginary = await readConversation(app, stranger.headers, randomUUID())

    expect(imaginary.statusCode).toBe(real.statusCode)
    // The whole point: the two answers must be indistinguishable. A difference
    // in a `detail` string is enough to leak existence.
    expect({ ...imaginary.json(), instance: null }).toEqual({ ...real.json(), instance: null })
  })

  it('refuses to let a non-participant speak into it, also with 404', async () => {
    const response = await reply(app, stranger.headers, conversationId, 'Hello?')
    expect(response.statusCode).toBe(404)

    // Counter-assertion: an actual participant CAN speak, so this is not a
    // route that refuses everyone.
    expect((await reply(app, seller.headers, conversationId, 'Hi.')).statusCode).toBe(201)
  })

  it('keeps it out of a non-participant\'s inbox', async () => {
    const list = await inbox(app, stranger.headers)
    expect(list.json().items.map((c: TestConversation) => c.id)).not.toContain(conversationId)

    // Counter-assertion: it IS in a participant's inbox.
    expect((await inbox(app, buyer.headers)).json().items.map((c: TestConversation) => c.id))
      .toContain(conversationId)
  })
})

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, createMember, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Member event registration (§4): once per event, capacity enforced by the
 * database, cancellation that frees the seat, and the price computed now.
 */
describe.skipIf(!hasDatabase)('member events (§4)', () => {
  let app: GwcApp
  let member: { id: string; headers: Record<string, string> }

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  const memberWithBearer = async () => {
    const row = await createMember(app.pg)
    return { id: String(row.id), headers: await bearerFor(app, { accountId: String(row.id), accountKind: 'member' }) }
  }

  const seedEvent = async (overrides: Record<string, unknown> = {}) => {
    const values = {
      slug: `event-${Math.random().toString(36).slice(2)}`,
      title: 'Summer reception',
      starts_at: new Date(Date.now() + 30 * 86_400_000),
      capacity: 10,
      state: 'open',
      price_standard_cents: 5000,
      kids_price_cents: 1500,
      max_kids: 3,
      ...overrides,
    }
    const keys = Object.keys(values)
    const { rows } = await app.pg.query(
      `INSERT INTO events (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(values),
    )
    return String(rows[0].id)
  }

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    await app.pg.query('DELETE FROM events')
    member = await memberWithBearer()
  })

  const registerFor = (eventId: string, headers: Record<string, string>, body: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST', url: `/member/events/${eventId}/registration`, headers,
      payload: { paymentMethod: 'door', ...body },
    })

  it('lists upcoming events with the price that applies now and the seats left', async () => {
    const eventId = await seedEvent()
    const response = await app.inject({ method: 'GET', url: '/member/events', headers: member.headers })
    expect(response.statusCode).toBe(200)
    expect(response.json().items).toEqual([
      expect.objectContaining({ id: eventId, phase: 'standard', currentPriceCents: 5000, seatsLeft: 10, registered: false }),
    ])
  })

  it('is never served under the public, indexed /events prefix', async () => {
    const response = await app.inject({ method: 'GET', url: '/member/events', headers: member.headers })
    expect(String(response.headers['x-robots-tag'] ?? '')).toContain('noindex')
  })

  it('registers once, charging the member, guests and charged kids at the current price', async () => {
    const eventId = await seedEvent()
    const response = await registerFor(eventId, member.headers, { guestCount: 1, kidsFree: 1, kidsCharged: 1 })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ amountCents: 2 * 5000 + 1500, paid: false, paymentMethod: 'door' })

    const again = await registerFor(eventId, member.headers)
    expect(again.statusCode).toBe(409)
    expect(again.json().type).toBe(PROBLEMS.ALREADY_REGISTERED.type)
  })

  it('refuses the registration that would exceed capacity, and admits the one that fits', async () => {
    const eventId = await seedEvent({ capacity: 3 })
    const first = await memberWithBearer()
    expect((await registerFor(eventId, first.headers, { guestCount: 1 })).statusCode).toBe(201) // 2 seats

    const tooMany = await registerFor(eventId, member.headers, { guestCount: 1 }) // would be 4
    expect(tooMany.statusCode).toBe(409)
    expect(tooMany.json().type).toBe(PROBLEMS.EVENT_FULL.type)

    // The counter-assertion: the last seat is still there for one person.
    expect((await registerFor(eventId, member.headers)).statusCode).toBe(201)
  })

  it('frees the seat on cancellation, and re-registering reuses the row', async () => {
    const eventId = await seedEvent({ capacity: 1 })
    expect((await registerFor(eventId, member.headers)).statusCode).toBe(201)
    const cancelled = await app.inject({ method: 'DELETE', url: `/member/events/${eventId}/registration`, headers: member.headers })
    expect(cancelled.statusCode).toBe(204)

    const other = await memberWithBearer()
    expect((await registerFor(eventId, other.headers)).statusCode).toBe(201)
    // Full again, so the returning member is refused — capacity, not the old row.
    expect((await registerFor(eventId, member.headers)).json().type).toBe(PROBLEMS.EVENT_FULL.type)

    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM event_registrations WHERE member_id = $1', [member.id])
    expect(rows[0].n).toBe(1)
  })

  it('will not cancel a paid registration from the app', async () => {
    const eventId = await seedEvent()
    await registerFor(eventId, member.headers)
    await app.pg.query('UPDATE event_registrations SET paid = true WHERE member_id = $1', [member.id])
    const response = await app.inject({ method: 'DELETE', url: `/member/events/${eventId}/registration`, headers: member.headers })
    expect(response.statusCode).toBe(409)
  })

  it('refuses registration while staff have not opened the event', async () => {
    const eventId = await seedEvent({ state: 'not_opened' })
    const response = await registerFor(eventId, member.headers)
    expect(response.json().type).toBe(PROBLEMS.REGISTRATION_CLOSED.type)
  })

  it('enforces the kids ceiling', async () => {
    const eventId = await seedEvent({ max_kids: 2 })
    const response = await registerFor(eventId, member.headers, { kidsFree: 2, kidsCharged: 1 })
    expect(response.statusCode).toBe(400)
  })

  it('offers only the offline payment methods on this face', async () => {
    const eventId = await seedEvent()
    const response = await registerFor(eventId, member.headers, { paymentMethod: 'online' })
    expect(response.statusCode).toBe(400)
  })
})

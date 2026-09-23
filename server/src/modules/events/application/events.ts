import { PROBLEMS } from '@gwc/contracts/errors'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { resolveEntitlement } from '../../auth/application/me.ts'
import { phaseAt, priceFor, amountFor } from './pricing.ts'
import type { GwcApp } from '../../../app.ts'
import type {
  EventDetail, EventRegistration, EventSummary, EventState, RegisterForEventRequest,
} from '@gwc/contracts/events'

/**
 * Club events, member face (§4). Pricing is `pricing.ts`; capacity is the
 * trigger in 023_event_rsvp.sql. This file never re-implements either.
 */

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)

// Named columns. `seats_taken` counts every live registration with its guests
// and kids, the same sum the capacity trigger uses — two formulas for one
// number would disagree on the day it matters.
const EVENT_COLUMNS = `
  e.id, e.slug, e.title, e.description, e.venue, e.city, e.latitude, e.longitude,
  e.starts_at, e.ends_at, e.capacity, e.currency, e.state, e.max_kids,
  e.early_until, e.standard_until, e.registration_opens, e.registration_closes,
  e.price_early_cents, e.price_standard_cents, e.price_late_cents, e.kids_price_cents,
  (SELECT COALESCE(sum(1 + r.guest_count + r.kids_free + r.kids_charged), 0)::int
     FROM event_registrations r
    WHERE r.event_id = e.id AND r.cancelled_at IS NULL) AS seats_taken`

const REGISTRATION_COLUMNS = `
  r.id, r.event_id, r.guest_count, r.kids_free, r.kids_charged, r.payment_method,
  r.paid, r.amount_cents, r.registered_at`

type Row = Record<string, any>

function toSummary(row: Row, registered: boolean, now: Date): EventSummary {
  const phase = phaseAt(row as never, now)
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    venue: row.venue ?? null,
    city: row.city ?? null,
    startsAt: iso(row.starts_at)!,
    endsAt: iso(row.ends_at),
    state: row.state as EventState,
    phase,
    currentPriceCents: priceFor(row as never, phase),
    currency: String(row.currency),
    seatsLeft: Math.max(0, Number(row.capacity) - Number(row.seats_taken)),
    registered,
  }
}

function toRegistration(row: Row, currency: string): EventRegistration {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    guestCount: row.guest_count,
    kidsFree: row.kids_free,
    kidsCharged: row.kids_charged,
    paymentMethod: String(row.payment_method),
    paid: Boolean(row.paid),
    amountCents: row.amount_cents ?? null,
    currency,
    registeredAt: iso(row.registered_at)!,
  }
}

const PAGE = 20

/**
 * Upcoming events soonest first, or past ones latest first. An event still in
 * progress is upcoming until it ends.
 */
export async function listEvents(
  app: GwcApp,
  { memberId, when = 'upcoming', cursor, signal, now = new Date() }:
    { memberId: string; when?: 'upcoming' | 'past'; cursor?: { startsAt: string; id: string } | null; signal?: AbortSignal; now?: Date },
) {
  const upcoming = when === 'upcoming'
  const params: unknown[] = [memberId, now, PAGE + 1]
  let keyset = ''
  if (cursor) {
    params.push(cursor.startsAt, cursor.id)
    keyset = upcoming
      ? 'AND (e.starts_at, e.id) > ($4::timestamptz, $5::uuid)'
      : 'AND (e.starts_at, e.id) < ($4::timestamptz, $5::uuid)'
  }
  const { rows } = await query(
    app.pg,
    `SELECT ${EVENT_COLUMNS},
            EXISTS (SELECT 1 FROM event_registrations r
                     WHERE r.event_id = e.id AND r.member_id = $1 AND r.cancelled_at IS NULL) AS registered
       FROM events e
      WHERE COALESCE(e.ends_at, e.starts_at) ${upcoming ? '>=' : '<'} $2
        ${keyset}
      ORDER BY e.starts_at ${upcoming ? 'ASC' : 'DESC'}, e.id ${upcoming ? 'ASC' : 'DESC'}
      LIMIT $3`,
    params,
    { signal },
  )
  const page = rows.slice(0, PAGE)
  const last = page[page.length - 1]
  return {
    items: page.map((row) => toSummary(row, row.registered, now)),
    nextCursor: rows.length > PAGE && last
      ? Buffer.from(JSON.stringify({ startsAt: iso(last.starts_at), id: String(last.id) })).toString('base64url')
      : null,
  }
}

export function decodeEventCursor(cursor: string | undefined) {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (typeof parsed?.startsAt === 'string' && typeof parsed?.id === 'string') return parsed
  } catch {
    // A cursor is opaque; a mangled one is simply the first page.
  }
  return null
}

async function loadEventRow(app: GwcApp, eventId: string, signal?: AbortSignal) {
  const { rows } = await query(app.pg, `SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id = $1`, [eventId], { signal })
  if (!rows[0]) throw refuse(PROBLEMS.NOT_FOUND, 'No such event.')
  return rows[0]
}

async function loadRegistrationRow(app: GwcApp, eventId: string, memberId: string, signal?: AbortSignal) {
  const { rows } = await query(
    app.pg,
    `SELECT ${REGISTRATION_COLUMNS}, r.cancelled_at FROM event_registrations r WHERE r.event_id = $1 AND r.member_id = $2`,
    [eventId, memberId],
    { signal },
  )
  return rows[0] ?? null
}

export async function getEvent(
  app: GwcApp,
  { memberId, eventId, signal, now = new Date() }: { memberId: string; eventId: string; signal?: AbortSignal; now?: Date },
): Promise<EventDetail> {
  const row = await loadEventRow(app, eventId, signal)
  const registration = await loadRegistrationRow(app, eventId, memberId, signal)
  const live = registration && registration.cancelled_at === null ? registration : null
  return {
    ...toSummary(row, Boolean(live), now),
    description: row.description ?? null,
    // numeric(9,6) arrives as a string from pg.
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    capacity: Number(row.capacity),
    prices: {
      earlyCents: row.price_early_cents ?? null,
      standardCents: row.price_standard_cents ?? null,
      lateCents: row.price_late_cents ?? null,
      kidsCents: row.kids_price_cents ?? null,
    },
    earlyUntil: iso(row.early_until),
    standardUntil: iso(row.standard_until),
    registrationOpens: iso(row.registration_opens),
    registrationCloses: iso(row.registration_closes),
    maxKids: row.max_kids ?? null,
    myRegistration: live ? toRegistration(live, String(row.currency)) : null,
  }
}

/**
 * Register, once (§4). Or re-register after cancelling, which reuses the row.
 *
 * Capacity is not checked here. The trigger checks it under a row lock on the
 * event, which is the only check that holds for two members racing for the
 * last seat; a count here would merely make the refusal arrive later.
 */
export async function registerForEvent(
  app: GwcApp,
  { memberId, eventId, request, requestId, signal, now = new Date() }:
    { memberId: string; eventId: string; request: Required<RegisterForEventRequest>; requestId?: string; signal?: AbortSignal; now?: Date },
) {
  const event = await loadEventRow(app, eventId, signal)
  const phase = phaseAt(event as never, now)
  if (phase === 'not_open' || phase === 'closed') {
    throw refuse(PROBLEMS.REGISTRATION_CLOSED, 'Registration for this event is not open.')
  }

  const kids = request.kidsFree + request.kidsCharged
  if (event.max_kids !== null && kids > event.max_kids) {
    throw refuse(PROBLEMS.VALIDATION_FAILED, `At most ${event.max_kids} children may be registered.`)
  }

  const entitlement = await resolveEntitlement() as { eventDiscountPct?: number | null } | null
  const amount = amountFor(event as never, phase, request, entitlement?.eventDiscountPct ?? null)

  try {
    const row = await withTransaction(app.pg, async (client) => {
      const { rows: existing } = await client.query(
        'SELECT id, cancelled_at FROM event_registrations WHERE event_id = $1 AND member_id = $2 FOR UPDATE',
        [eventId, memberId],
      )
      if (existing[0] && existing[0].cancelled_at === null) return null

      const values = [eventId, memberId, request.guestCount, request.kidsFree, request.kidsCharged, request.paymentMethod, amount]
      const { rows } = existing[0]
        ? await client.query(
            `UPDATE event_registrations r
                SET guest_count = $3, kids_free = $4, kids_charged = $5, payment_method = $6,
                    amount_cents = $7, paid = false, reminded_at = NULL,
                    registered_at = now(), cancelled_at = NULL
              WHERE event_id = $1 AND member_id = $2
              RETURNING ${REGISTRATION_COLUMNS}`,
            values,
          )
        : await client.query(
            `INSERT INTO event_registrations AS r
               (event_id, member_id, guest_count, kids_free, kids_charged, payment_method, amount_cents)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING ${REGISTRATION_COLUMNS}`,
            values,
          )
      return rows[0]
    }, { signal })

    if (!row) throw refuse(PROBLEMS.ALREADY_REGISTERED, 'You are already registered for this event.')

    await app.audit({
      action: 'event_registered', outcome: 'allowed', requestId,
      actorId: memberId, actorKind: 'member', targetType: 'event', targetId: eventId,
      detail: { phase, amountCents: amount, guests: request.guestCount },
    })
    return toRegistration(row, String(event.currency))
  } catch (err) {
    const pgErr = err as { code?: string; constraint?: string }
    if (pgErr.code === '23514' && pgErr.constraint === 'event_registrations_capacity') {
      throw refuse(PROBLEMS.EVENT_FULL, 'This event is full.')
    }
    throw err
  }
}

/**
 * Cancel, by timestamp (023_event_rsvp.sql says why not DELETE).
 *
 * Refused once paid: a paid cancellation is a refund, and a refund is a staff
 * decision with money attached, not something the app does on a tap.
 */
export async function cancelRegistration(
  app: GwcApp,
  { memberId, eventId, requestId, signal, now = new Date() }:
    { memberId: string; eventId: string; requestId?: string; signal?: AbortSignal; now?: Date },
) {
  const event = await loadEventRow(app, eventId, signal)
  if (new Date(event.starts_at).getTime() <= now.getTime()) {
    throw refuse(PROBLEMS.REGISTRATION_CLOSED, 'This event has already started.')
  }
  const registration = await loadRegistrationRow(app, eventId, memberId, signal)
  if (!registration || registration.cancelled_at !== null) {
    throw refuse(PROBLEMS.NOT_FOUND, 'You are not registered for this event.')
  }
  if (registration.paid) {
    throw refuse(PROBLEMS.CONFLICT, 'This registration is paid. Please contact the club to cancel it.')
  }
  await query(
    app.pg,
    'UPDATE event_registrations SET cancelled_at = now() WHERE id = $1 AND cancelled_at IS NULL',
    [registration.id],
    { signal },
  )
  await app.audit({
    action: 'event_registration_cancelled', outcome: 'allowed', requestId,
    actorId: memberId, actorKind: 'member', targetType: 'event', targetId: eventId,
  })
}

import type { PricePhase } from '@gwc/contracts/events'

/**
 * §4's pricing phases, computed live — the single place they are computed.
 *
 * Pure and framework-free on purpose: §12.3 says the price is a function of
 * *now* against the event's dates, and a function that takes `now` as an
 * argument is one a test can pin to any instant without a database or a clock.
 */

export type PricedEvent = {
  state: string
  registration_opens: Date | string | null
  registration_closes: Date | string | null
  early_until: Date | string | null
  standard_until: Date | string | null
  price_early_cents: number | null
  price_standard_cents: number | null
  price_late_cents: number | null
  kids_price_cents?: number | null
}

const at = (value: Date | string | null) => (value === null ? null : new Date(value).getTime())

/**
 * Which phase applies at `now`.
 *
 * The admin state machine comes first: an event staff have not opened is not
 * open, whatever its dates say, and a closed one stays closed (§4). Within an
 * open event, a phase exists only if its end date does — no `early_until` means
 * no early bird, and no `standard_until` means standard pricing to the end.
 */
export function phaseAt(event: PricedEvent, now: Date): PricePhase {
  if (event.state === 'not_opened') return 'not_open'
  if (event.state !== 'open') return 'closed'

  const t = now.getTime()
  const opens = at(event.registration_opens)
  const closes = at(event.registration_closes)
  if (opens !== null && t < opens) return 'not_open'
  if (closes !== null && t > closes) return 'closed'

  const earlyUntil = at(event.early_until)
  const standardUntil = at(event.standard_until)
  if (earlyUntil !== null && t <= earlyUntil) return 'early'
  if (standardUntil === null || t <= standardUntil) return 'standard'
  return 'late'
}

/**
 * The adult price for a phase, or null when no phase is open.
 *
 * A phase without its own price falls back to the standard one, because that
 * is what "no early-bird discount configured" means. A missing standard price
 * is a free event — §4 prices are optional, and the club runs free ones.
 */
export function priceFor(event: PricedEvent, phase: PricePhase): number | null {
  const standard = event.price_standard_cents ?? 0
  switch (phase) {
    case 'early': return event.price_early_cents ?? standard
    case 'standard': return standard
    case 'late': return event.price_late_cents ?? standard
    default: return null
  }
}

/**
 * What a registration costs now: the adult price for the member and each
 * guest, the kids rate for 6–12s, nothing for 0–5s (§4). Then the card
 * discount, resolved at point of use (§12.2) — `null` until the membership
 * card feature supplies one, which is why it is a parameter and not a lookup.
 */
export function amountFor(
  event: PricedEvent,
  phase: PricePhase,
  { guestCount, kidsCharged }: { guestCount: number; kidsCharged: number },
  eventDiscountPct: number | null = null,
): number | null {
  const adult = priceFor(event, phase)
  if (adult === null) return null
  const gross = adult * (1 + guestCount) + (event.kids_price_cents ?? 0) * kidsCharged
  if (!eventDiscountPct) return gross
  return Math.round(gross * (100 - eventDiscountPct) / 100)
}

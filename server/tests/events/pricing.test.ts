import { describe, it, expect } from 'vitest'
import { phaseAt, priceFor, amountFor } from '../../src/modules/events/application/pricing.ts'
import type { PricedEvent } from '../../src/modules/events/application/pricing.ts'

/**
 * §4 / §12.3 — the price is a function of *now*, not of the moment somebody
 * signed up. Pure units, pinned to instants, no database.
 */
const event = (overrides: Partial<PricedEvent> = {}): PricedEvent => ({
  state: 'open',
  registration_opens: '2026-01-01T00:00:00Z',
  registration_closes: '2026-03-01T00:00:00Z',
  early_until: '2026-01-15T00:00:00Z',
  standard_until: '2026-02-15T00:00:00Z',
  price_early_cents: 4000,
  price_standard_cents: 5000,
  price_late_cents: 6500,
  kids_price_cents: 1500,
  ...overrides,
})

const at = (iso: string) => new Date(iso)

describe('pricing phases (§4)', () => {
  it('walks early → standard → late across the configured dates', () => {
    expect(phaseAt(event(), at('2026-01-10T00:00:00Z'))).toBe('early')
    expect(phaseAt(event(), at('2026-02-01T00:00:00Z'))).toBe('standard')
    expect(phaseAt(event(), at('2026-02-20T00:00:00Z'))).toBe('late')
  })

  it('is not open before the window and closed after it', () => {
    expect(phaseAt(event(), at('2025-12-31T23:59:59Z'))).toBe('not_open')
    expect(phaseAt(event(), at('2026-03-01T00:00:01Z'))).toBe('closed')
  })

  it('lets the admin state machine override the dates', () => {
    // Inside every date window, and still not open: staff have not opened it.
    expect(phaseAt(event({ state: 'not_opened' }), at('2026-01-10T00:00:00Z'))).toBe('not_open')
    expect(phaseAt(event({ state: 'closed' }), at('2026-01-10T00:00:00Z'))).toBe('closed')
    expect(phaseAt(event({ state: 'review' }), at('2026-01-10T00:00:00Z'))).toBe('closed')
  })

  it('has no early bird without an early date, and no late phase without a standard end', () => {
    const plain = event({ early_until: null, standard_until: null })
    expect(phaseAt(plain, at('2026-01-02T00:00:00Z'))).toBe('standard')
    expect(phaseAt(plain, at('2026-02-28T00:00:00Z'))).toBe('standard')
  })
})

describe('what a registration costs', () => {
  it('prices each phase, falling back to standard where a phase has no price of its own', () => {
    expect(priceFor(event(), 'early')).toBe(4000)
    expect(priceFor(event({ price_late_cents: null }), 'late')).toBe(5000)
    expect(priceFor(event(), 'closed')).toBeNull()
  })

  it('charges the member and each guest, the kids rate for 6–12s, nothing for 0–5s', () => {
    // 2 adults at the standard price, 1 charged child; free children cost nothing.
    expect(amountFor(event(), 'standard', { guestCount: 1, kidsCharged: 1 })).toBe(2 * 5000 + 1500)
  })

  it('applies a card discount when one is resolved, and none when it is not', () => {
    expect(amountFor(event(), 'standard', { guestCount: 0, kidsCharged: 0 }, 30)).toBe(3500)
    expect(amountFor(event(), 'standard', { guestCount: 0, kidsCharged: 0 }, 100)).toBe(0)
    expect(amountFor(event(), 'standard', { guestCount: 0, kidsCharged: 0 }, null)).toBe(5000)
  })
})

import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Countdown from '../../src/components/Countdown.jsx'

const SECOND = 1000
const NOW = new Date('2026-01-01T00:00:00Z').getTime()

/** Contract: contracts/component-api.md (N1–N5) */
describe('<Countdown />', () => {
  afterEach(() => vi.restoreAllMocks())

  function pinClock(at = NOW) {
    vi.spyOn(Date, 'now').mockImplementation(() => at)
  }

  const future = new Date(NOW + (3 * 86400 + 4 * 3600 + 5 * 60 + 6) * SECOND).toISOString()
  const past = new Date(NOW - 86400 * SECOND).toISOString()

  it('N1: renders each unit with its label while counting', () => {
    pinClock()
    const { container } = render(<Countdown launchDate={future} />)
    const digits = within(container.querySelector('[data-testid="countdown-digits"]'))

    expect(digits.getByText('03')).toBeInTheDocument()
    expect(digits.getByText('04')).toBeInTheDocument()
    expect(digits.getByText('05')).toBeInTheDocument()
    expect(digits.getByText('06')).toBeInTheDocument()

    // Scoped to the digit list: /days/i also matches the screen-reader summary.
    for (const label of [/days/i, /hours/i, /minutes/i, /seconds/i]) {
      expect(digits.getByText(label)).toBeInTheDocument()
    }
  })

  it('N2: renders the launch message and no digits once launched', () => {
    pinClock()
    const { container } = render(<Countdown launchDate={past} />)

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/now open|launched|live/i)
    expect(container.querySelector('[data-testid="countdown-digits"]')).toBeNull()
  })

  it('N2: shows no negative or NaN values for a past date', () => {
    pinClock()
    const { container } = render(<Countdown launchDate={past} />)
    expect(container.textContent).not.toMatch(/-\d|NaN/)
  })

  it('N2: treats an unparseable date as launched rather than rendering NaN', () => {
    pinClock()
    const { container } = render(<Countdown launchDate="not-a-date" />)
    expect(container.textContent).not.toMatch(/NaN/)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/now open|launched|live/i)
  })

  it('N3: hides the per-second digits from assistive tech', () => {
    pinClock()
    const { container } = render(<Countdown launchDate={future} />)
    const digits = container.querySelector('[data-testid="countdown-digits"]')

    expect(digits).not.toBeNull()
    expect(digits).toHaveAttribute('aria-hidden', 'true')
  })

  it('N3: provides a screen-reader summary at day granularity, not per second', () => {
    pinClock()
    render(<Countdown launchDate={future} />)

    // The accessible summary names days, and must not announce seconds.
    const summary = screen.getByTestId('countdown-summary')
    expect(summary.textContent).toMatch(/3 days/i)
    expect(summary.textContent).not.toMatch(/second/i)
  })

  it('N3: the live region is not assertive, so it cannot flood the a11y tree', () => {
    pinClock()
    render(<Countdown launchDate={future} />)
    const summary = screen.getByTestId('countdown-summary')
    expect(summary.getAttribute('aria-live')).not.toBe('assertive')
  })

  it('N5: pads single-digit values so the layout cannot jitter', () => {
    pinClock()
    render(<Countdown launchDate={new Date(NOW + 5 * SECOND).toISOString()} />)
    expect(screen.getAllByText('00').length).toBeGreaterThan(0)
    expect(screen.getByText('05')).toBeInTheDocument()
  })

  it('exposes the section as an accessibly named region', () => {
    pinClock()
    render(<Countdown launchDate={future} />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(screen.getByRole('region', { name: heading.textContent })).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { expectNoA11yViolations } from '../setup'
import Button from '../../src/components/ui/Button'
import PageLoader from '../../src/components/ui/PageLoader'
import { LocaleProvider } from '../../src/i18n/index'
import { t } from '../../src/i18n/de'

/**
 * The loader is announced and decorative (feature 030, US3). As in the sibling
 * file, jsdom cannot resolve colours, so contrast is not asserted here: the
 * spinner draws only `text-navy` or `currentColor` (the button's own text colour),
 * both already contrast-checked in `console-components.test.tsx`.
 */
afterEach(() => vi.useRealTimers())

describe('loader accessibility', () => {
  it('the page loader is a polite status with a name and has no axe violations', async () => {
    vi.useFakeTimers()
    const { container } = render(<LocaleProvider initialLocale="de"><PageLoader /></LocaleProvider>)
    act(() => { vi.advanceTimersByTime(200) })
    vi.useRealTimers()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(t.console.loading)
    // The drawing itself is hidden, so the label is heard once.
    expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await expectNoA11yViolations(container)
  })

  it('a busy button keeps its name, announces busy and has no axe violations', async () => {
    const { container } = render(<Button loading>Speichern</Button>)
    const button = screen.getByRole('button', { name: 'Speichern' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    await expectNoA11yViolations(container)
  })

  it('an idle button is unchanged (counter-assertion)', async () => {
    const { container } = render(<Button>Speichern</Button>)
    expect(screen.getByRole('button', { name: 'Speichern' })).not.toHaveAttribute('aria-busy')
    await expectNoA11yViolations(container)
  })
})

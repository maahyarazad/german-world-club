import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { PageLoader } from '../../src/components/ui/PageLoader'
import { t } from '../../src/i18n/de'
import { LocaleProvider } from '../../src/i18n/index'
import type { ReactNode } from 'react'

const renderWithLocale = (ui: ReactNode) => render(<LocaleProvider initialLocale="de">{ui}</LocaleProvider>)

/** The page loader (feature 030): silent during the grace period, then a status. */
afterEach(() => vi.useRealTimers())

describe('PageLoader', () => {
  it('shows nothing before the grace period, so a fast response never flickers', () => {
    vi.useFakeTimers()
    renderWithLocale(<PageLoader />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(149) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('appears after 150 ms as a polite status with the translated label', () => {
    vi.useFakeTimers()
    renderWithLocale(<PageLoader />)
    act(() => { vi.advanceTimersByTime(150) })
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent(t.console.loading)
    expect(status.querySelector('svg[data-spinner="lg"]')).not.toBeNull()
  })

  it('takes a custom delay, size and label', () => {
    vi.useFakeTimers()
    renderWithLocale(<PageLoader delayMs={500} size="md" label="Wird gesendet" />)
    act(() => { vi.advanceTimersByTime(499) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('status')).toHaveTextContent('Wird gesendet')
    expect(screen.getByRole('status').querySelector('svg[data-spinner="md"]')).not.toBeNull()
  })

  it('never shows if it is gone before the grace period ends', () => {
    vi.useFakeTimers()
    const { unmount } = renderWithLocale(<PageLoader />)
    act(() => { vi.advanceTimersByTime(100) })
    unmount()
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

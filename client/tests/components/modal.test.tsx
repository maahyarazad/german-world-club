import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, createEvent, act } from '@testing-library/react'
import { Modal } from '../../src/member/threads/Modal'

/**
 * The shared web dialog (feature 021, Story 5): centered, animated in and
 * out, and still starting fresh every time it opens.
 *
 * jsdom has no layout and no `showModal()`, so centering and the animation
 * are asserted through the classes that produce them — the reason each class
 * is needed is in Modal.tsx. Behaviour (the deferred unmount, Escape, the
 * reset) is asserted directly.
 */

afterEach(() => vi.useRealTimers())

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>open it</button>
      <Modal title="Anfrage" open={open} onClose={() => { onClose?.(); setOpen(false) }}>
        <label>
          Nachricht
          <input defaultValue="" />
        </label>
        <button onClick={() => setOpen(false)}>Abbrechen</button>
      </Modal>
    </>
  )
}

const dialog = () => document.querySelector('dialog')

describe('Modal', () => {
  it('is centered: margin auto (Tailwind v4 preflight zeroes the browser’s) and bounded to the window', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('open it'))
    const classes = dialog()!.className.split(/\s+/)
    expect(classes).toContain('m-auto')
    expect(classes).toContain('max-h-[calc(100dvh-2rem)]')
    expect(classes).toContain('overflow-y-auto')
  })

  it('animates in and out with classes only, and not at all under reduced motion', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('open it'))
    const className = dialog()!.className
    expect(className).toMatch(/starting:open:opacity-0/)
    expect(className).toMatch(/starting:open:scale-95/)
    expect(className).toMatch(/transition-discrete/)
    expect(className).toMatch(/motion-reduce:transition-none/)
    // No inline style: the CSP allows styles by nonce only.
    expect(dialog()!.getAttribute('style')).toBeNull()
  })

  it('stays mounted while it fades out, and unmounts when its own transition ends', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('open it'))
    fireEvent.click(screen.getByText('Abbrechen'))

    // Closed, but still there to be animated.
    expect(dialog()).not.toBeNull()
    expect(dialog()!.hasAttribute('open')).toBe(false)

    // A transition ending on a CHILD bubbles up — it must not end the exit early.
    fireEvent.transitionEnd(screen.getByLabelText('Nachricht'))
    expect(dialog()).not.toBeNull()

    fireEvent.transitionEnd(dialog()!)
    expect(dialog()).toBeNull()
  })

  it('unmounts after the fallback when no transition ends (reduced motion, older browsers)', () => {
    vi.useFakeTimers()
    render(<Harness />)
    fireEvent.click(screen.getByText('open it'))
    fireEvent.click(screen.getByText('Abbrechen'))
    expect(dialog()).not.toBeNull()

    act(() => { vi.advanceTimersByTime(300) })
    expect(dialog()).toBeNull()
  })

  it('starts fresh when reopened — typed text does not survive a close', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('open it'))
    fireEvent.change(screen.getByLabelText('Nachricht'), { target: { value: 'Noch da?' } })
    fireEvent.click(screen.getByText('Abbrechen'))
    fireEvent.transitionEnd(dialog()!)

    fireEvent.click(screen.getByText('open it'))
    expect((screen.getByLabelText('Nachricht') as HTMLInputElement).value).toBe('')
  })

  it('reopening during the fade-out keeps it open — the counter-assertion for the timer', () => {
    vi.useFakeTimers()
    render(<Harness />)
    fireEvent.click(screen.getByText('open it'))
    fireEvent.click(screen.getByText('Abbrechen'))
    fireEvent.click(screen.getByText('open it'))

    act(() => { vi.advanceTimersByTime(300) })
    expect(dialog()).not.toBeNull()
    expect(dialog()!.hasAttribute('open')).toBe(true)
  })

  it('closes on Escape without the browser closing it behind React’s back', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.click(screen.getByText('open it'))
    const cancel = createEvent('cancel', dialog()!, { cancelable: true }, { EventType: 'Event' })
    fireEvent(dialog()!, cancel)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(cancel.defaultPrevented).toBe(true)
  })
})

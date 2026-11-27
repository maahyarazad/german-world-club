import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { FormMessage } from '../../src/components/ui/Field'
import { useReveal } from '../../src/lib/useReveal'
import { installScrollSpy, type ScrollSpy } from '../helpers/scroll-spy'

/**
 * `useReveal` on its own (feature 041).
 *
 * A message object is shown when a button is pressed; the hook is given that
 * object and its ref goes on the `FormMessage`. Each case has the assertion
 * that would pass for a hook that does nothing, turned round: nothing is
 * revealed when nothing new has appeared.
 */

let scroll: ScrollSpy

beforeEach(() => { scroll = installScrollSpy() })
afterEach(() => {
  scroll.restore()
  delete (window as { matchMedia?: unknown }).matchMedia
})

/** Two animation frames: the hook moves one frame after the commit, so "nothing happened" needs waiting for. */
const settle = () => act(() => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
}))

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: query.includes('prefers-reduced-motion') && reduce, media: query }),
  })
}

function Harness() {
  const [message, setMessage] = useState<{ text: string } | null>(null)
  const [, rerender] = useState(0)
  const ref = useReveal<HTMLDivElement>(message)
  return (
    <>
      <button onClick={() => setMessage({ text: 'Saved.' })}>save</button>
      <button onClick={() => setMessage(null)}>clear</button>
      <button onClick={() => rerender((n) => n + 1)}>rerender</button>
      {message && <FormMessage ref={ref} tone="success">{message.text}</FormMessage>}
    </>
  )
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

describe('useReveal', () => {
  it('reveals the message, nearest, and eases when motion is allowed', async () => {
    setReducedMotion(false)
    render(<Harness />)
    press('save')

    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(scroll.revealed()[0]).toBe(screen.getByRole('alert'))
    expect(scroll.options()[0]).toEqual({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  })

  it('does not ease for a person who asked for reduced motion, nor where it cannot ask', async () => {
    setReducedMotion(true)
    const first = render(<Harness />)
    press('save')
    await waitFor(() => expect(scroll.options()).toHaveLength(1))
    expect(scroll.options()[0]).toMatchObject({ behavior: 'auto' })
    first.unmount()

    // Counter-assertion: the same page without the preference does ease, so the
    // case above is the setting at work and not a hook that never eases.
    setReducedMotion(false)
    const second = render(<Harness />)
    press('save')
    await waitFor(() => expect(scroll.options()).toHaveLength(2))
    expect(scroll.options()[1]).toMatchObject({ behavior: 'smooth' })
    second.unmount()

    // jsdom has no matchMedia: no animation is the safe answer.
    delete (window as { matchMedia?: unknown }).matchMedia
    render(<Harness />)
    press('save')
    await waitFor(() => expect(scroll.options()).toHaveLength(3))
    expect(scroll.options()[2]).toMatchObject({ behavior: 'auto' })
  })

  it('reveals again for a second outcome with the very same text', async () => {
    setReducedMotion(false)
    render(<Harness />)
    press('save')
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))

    // The message is still on screen with the same words: a new object, not a new mount.
    expect(screen.getByRole('alert')).toHaveTextContent('Saved.')
    press('save')
    await waitFor(() => expect(scroll.revealed()).toHaveLength(2))
    expect(scroll.revealed()[1]).toBe(scroll.revealed()[0])
  })

  it('moves nothing when nothing new has appeared', async () => {
    setReducedMotion(false)
    render(<Harness />)

    // First render, no message.
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    press('save')
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))

    // The same value on a re-render.
    press('rerender')
    await settle()
    expect(scroll.revealed()).toHaveLength(1)

    // The message going away.
    press('clear')
    await settle()
    expect(scroll.revealed()).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not move the page if the message is gone before the frame', async () => {
    setReducedMotion(false)
    const { unmount } = render(<Harness />)
    press('save')
    unmount()

    await settle()
    expect(scroll.revealed()).toHaveLength(0)
  })

  it('is not an error where there is no scrollIntoView, as in jsdom', async () => {
    scroll.restore()
    expect(Element.prototype.scrollIntoView).toBeUndefined()

    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => errors.push(event.error)
    window.addEventListener('error', onError)
    try {
      render(<Harness />)
      press('save')
      await settle()
      expect(screen.getByRole('alert')).toHaveTextContent('Saved.')
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })
})

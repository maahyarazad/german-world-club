import { describe, it, expect, vi } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen, fireEvent, createEvent } from '@testing-library/react'
import { Drawer } from '../../src/components/ui/Drawer'
import { t } from '../../src/i18n/de'

/**
 * The right-edge drawer (feature 017, R1–R3).
 *
 * What matters is what a member would lose or be stuck in: a draft that
 * vanished on close, a panel Escape could not dismiss, focus left on a hidden
 * control. jsdom has no showModal(), so `open` here is the attribute the
 * component's fallback sets — the same fallback threads/Modal.tsx relies on.
 */

function Harness({ initiallyOpen = false, onClose }: { initiallyOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(initiallyOpen)
  const [draft, setDraft] = useState('')
  const opener = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={opener} onClick={() => setOpen(true)}>open it</button>
      <Drawer
        open={open}
        onClose={() => { onClose?.(); setOpen(false) }}
        title="Neue Anzeige"
        closeLabel={t.memberMarketplace.close}
        returnFocusTo={opener}
      >
        <label>
          Titel
          <input value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
      </Drawer>
    </>
  )
}

const dialog = () => document.querySelector('dialog')!

describe('Drawer', () => {
  it('stays mounted while closed, and opens on request', () => {
    render(<Harness />)
    expect(dialog()).toBeInTheDocument()
    expect(dialog().hasAttribute('open')).toBe(false)
    // Mounted while closed — that is what keeps a draft.
    expect(screen.getByLabelText('Titel')).toBeInTheDocument()

    // Counter-assertion: a drawer that never opened would pass the lines above.
    fireEvent.click(screen.getByText('open it'))
    expect(dialog().hasAttribute('open')).toBe(true)
    expect(screen.getByRole('heading', { name: 'Neue Anzeige' })).toBeInTheDocument()
  })

  it('closes on Escape, without the browser closing it behind React’s back', () => {
    const onClose = vi.fn()
    render(<Harness initiallyOpen onClose={onClose} />)
    const cancel = createEvent('cancel', dialog(), { cancelable: true }, { EventType: 'Event' })
    fireEvent(dialog(), cancel)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(cancel.defaultPrevented).toBe(true)
    expect(dialog().hasAttribute('open')).toBe(false)
  })

  it('closes on a click on the backdrop, but not on a click inside the panel', () => {
    const onClose = vi.fn()
    render(<Harness initiallyOpen onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Titel'))
    expect(onClose).not.toHaveBeenCalled()

    // A click whose target is the <dialog> itself landed on ::backdrop.
    fireEvent.click(dialog())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from its close button', () => {
    const onClose = vi.fn()
    render(<Harness initiallyOpen onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.close }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialog().hasAttribute('open')).toBe(false)
  })

  it('returns focus to the control that opened it', () => {
    render(<Harness />)
    const opener = screen.getByText('open it')
    fireEvent.click(opener)
    screen.getByLabelText('Titel').focus()
    expect(document.activeElement).not.toBe(opener)

    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.close }))
    expect(document.activeElement).toBe(opener)
  })

  it('keeps what was typed across close and reopen', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('open it'))
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'BMW 320d Touring' } })
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.close }))
    fireEvent.click(screen.getByText('open it'))
    expect(screen.getByLabelText('Titel')).toHaveValue('BMW 320d Touring')
  })
})

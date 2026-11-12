import { useEffect, useId, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import Button from './Button'

/**
 * A panel that slides in from the right edge, over the page (feature 017).
 *
 * Built on `<dialog>` + `showModal()` like threads/Modal.tsx, for the same
 * reason: the top layer, an inert page behind, focus containment and Escape
 * come from the browser rather than from code here.
 *
 * Unlike Modal it NEVER unmounts when closed. A closed dialog is
 * `display:none` and outside the accessibility tree, so keeping it costs
 * nothing visible — and unmounting would silently throw away a half-written
 * form and the files chosen for it.
 *
 * The slide is classes only (`@starting-style` for the way in,
 * `transition-discrete` so `display` waits for the way out): the CSP allows
 * styles by nonce alone, and utilities live in the nonce'd stylesheet.
 */
export type DrawerProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Passed in rather than read from a catalogue, like every ui/ component. */
  closeLabel: string
  /** Where focus goes back to on close — normally the button that opened it. */
  returnFocusTo?: RefObject<HTMLElement | null>
  children: ReactNode
}

export function Drawer({ open, onClose, title, closeLabel, returnFocusTo, children }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const wasOpen = useRef(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // jsdom has no showModal/close; the attribute is what they would set.
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
    // Only on a real open → closed transition, not on the first render.
    if (!open && wasOpen.current) returnFocusTo?.current?.focus()
    wasOpen.current = open
  }, [open, returnFocusTo])

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      // Escape: keep React the owner of `open` instead of letting the browser
      // close the dialog behind it.
      onCancel={(e) => { e.preventDefault(); onClose() }}
      // A click whose target is the dialog itself landed on the backdrop; the
      // panel's content fills the dialog, so a click inside never matches.
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(560px,100vw)] max-w-none
        overflow-y-auto border-0 border-l border-hairline bg-surface p-0 text-text shadow-xl
        translate-x-full open:translate-x-0 starting:open:translate-x-full
        transition-[translate,overlay,display] transition-discrete duration-300 ease-out
        motion-reduce:transition-none backdrop:bg-ink/40"
    >
      <div className="flex min-h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id={headingId} className="text-[16px] font-semibold">{title}</h2>
          <Button variant="secondary" onClick={onClose}>{closeLabel}</Button>
        </div>
        {children}
      </div>
    </dialog>
  )
}

export default Drawer

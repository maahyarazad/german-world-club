import { useEffect, useRef, useState } from 'react'
import type { ReactNode, TransitionEvent } from 'react'

/** Longer than the 200 ms transition, for when no `transitionend` arrives. */
const EXIT_FALLBACK_MS = 250

/**
 * A modal dialog on the native `<dialog>` element: focus trapping, Escape
 * and the top layer come from the browser rather than from code here.
 *
 * **Centered by `m-auto`** (feature 021, Story 5). The browser centers a modal
 * dialog with `inset: 0; margin: auto`, but Tailwind v4's preflight sets
 * `margin: 0` on every element, which wins — the dialog sat in the top-left
 * corner. The max height keeps a tall dialog inside the window, scrolling.
 *
 * **Animated with classes only**, like `ui/Drawer.tsx`: `@starting-style` for
 * the way in, `transition-discrete` so `display` and the top layer wait for
 * the way out. The CSP allows styles by nonce alone, so no inline styles and
 * no animation library. `motion-reduce` turns it off.
 *
 * **Unmounts after the exit, not on close.** Every consumer relies on a
 * reopened dialog starting fresh (the request and compose dialogs would
 * otherwise keep a half-written message), so the content still goes — but
 * only once the fade-out has finished: on the dialog's own `transitionend`,
 * or after a fallback for browsers (and reduced motion) that send none.
 */
export function Modal({ title, open, onClose, children }: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // Rendered while open AND while fading out after a close.
  const [mounted, setMounted] = useState(open)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearExit = () => {
    if (exitTimer.current !== null) clearTimeout(exitTimer.current)
    exitTimer.current = null
  }

  useEffect(() => {
    if (open) {
      clearExit()
      setMounted(true)
    }
  }, [open])

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
      clearExit()
      exitTimer.current = setTimeout(() => {
        exitTimer.current = null
        setMounted(false)
      }, EXIT_FALLBACK_MS)
    }
  }, [open, mounted])

  useEffect(() => clearExit, [])

  const onTransitionEnd = (e: TransitionEvent<HTMLDialogElement>) => {
    // A child's transition bubbles here too; only the dialog's own ends the exit.
    if (e.target !== e.currentTarget || open) return
    clearExit()
    setMounted(false)
  }

  if (!mounted) return null
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onTransitionEnd={onTransitionEnd}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] overflow-y-auto
        rounded-card border border-hairline bg-surface p-0 text-text shadow-xl
        scale-95 opacity-0 open:scale-100 open:opacity-100
        starting:open:scale-95 starting:open:opacity-0
        transition-[opacity,scale,overlay,display] transition-discrete duration-200 ease-out
        motion-reduce:transition-none
        backdrop:bg-ink/40 backdrop:opacity-0 open:backdrop:opacity-100 starting:open:backdrop:opacity-0
        backdrop:transition-[opacity,overlay,display] backdrop:transition-discrete backdrop:duration-200
        motion-reduce:backdrop:transition-none"
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        {children}
      </div>
    </dialog>
  )
}

export default Modal

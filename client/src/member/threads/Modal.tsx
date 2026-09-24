import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * A modal dialog on the native `<dialog>` element: focus trapping, Escape
 * and the top layer come from the browser rather than from code here.
 */
export function Modal({ title, open, onClose, children }: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // jsdom has no showModal; the dialog still renders its content there.
    if (open && !dialog.open) dialog.showModal?.() ?? dialog.setAttribute('open', '')
    if (!open && dialog.open) dialog.close?.() ?? dialog.removeAttribute('open')
  }, [open])
  if (!open) return null
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      className="w-[min(560px,calc(100vw-2rem))] rounded-card border border-hairline bg-surface p-0 text-text shadow-xl backdrop:bg-ink/40"
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        {children}
      </div>
    </dialog>
  )
}

export default Modal

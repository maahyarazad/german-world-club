/**
 * A button whose click sends a request (feature 030): it shows the loader and
 * ignores further presses until the request ends, with no state of its own to
 * write at the call site.
 *
 *   <AsyncButton name="Privacy.unblock" onAction={() => del(`/threads/blocks/${id}`).then(drop)}>…</AsyncButton>
 *
 * Failures are logged under `name` and swallowed (`useAction`); this is for
 * buttons that have nothing to show on failure. A button with a state of its own
 * (a form with `busy`) passes `loading` to `Button` directly.
 */
import type { ReactNode } from 'react'
import Button from './Button'
import type { ButtonProps } from './Button'
import { useAction } from '../../lib/useAction'

export type AsyncButtonProps = Omit<ButtonProps, 'onClick' | 'loading' | 'children'> & {
  name: string
  onAction: () => Promise<unknown>
  children?: ReactNode
}

export function AsyncButton({ name, onAction, children, ...props }: AsyncButtonProps) {
  const [run, pending] = useAction(name, onAction)
  return <Button {...props} loading={pending} onClick={() => void run()}>{children}</Button>
}

export default AsyncButton

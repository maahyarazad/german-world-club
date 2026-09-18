import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

/**
 * A labelled input.
 *
 * The error is wired to the input through `aria-describedby` and
 * `aria-invalid`, so a screen reader announces it as part of the field rather
 * than as loose text somewhere on the page. That is the difference between an
 * error message and an error message somebody can find.
 */
export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode
  type?: string
  /** Rendered and wired to the input via aria-describedby / aria-invalid. */
  error?: ReactNode
  hint?: ReactNode
}

export function Field({ label, type = 'text', error, hint, ...rest }: FieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        className={`rounded-card border bg-surface px-3 py-2.5 text-[13px] text-text
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy
          ${error ? 'border-tint-danger-fg' : 'border-hairline'}`}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-[11px] text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[12px] text-tint-danger-fg">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * A refusal or an outcome, announced.
 *
 * `role="alert"` so it reaches assistive technology when it appears — a
 * sign-in failure that is only visible is a sign-in failure some people never
 * learn about.
 */
const FORM_MESSAGE_TONES = {
  danger: 'bg-tint-danger text-tint-danger-fg',
  info: 'bg-tint-info text-tint-info-fg',
  success: 'bg-tint-success text-tint-success-fg',
  gold: 'bg-tint-gold text-tint-gold-fg',
} as const

export type FormMessageTone = keyof typeof FORM_MESSAGE_TONES

export type FormMessageProps = {
  tone?: FormMessageTone
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
}

export function FormMessage({ tone = 'danger', title, children, actions }: FormMessageProps) {
  return (
    <div role="alert" className={`rounded-card px-3 py-2.5 text-[13px] ${FORM_MESSAGE_TONES[tone] ?? FORM_MESSAGE_TONES.danger}`}>
      {title && <strong className="font-semibold">{title}</strong>}
      {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export default Field

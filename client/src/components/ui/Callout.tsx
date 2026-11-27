/**
 * A tinted block with a 4px left rule — the mockups' way of stating a rule the
 * reader must not miss ("Keine Mitgliedschaft.", "Merchant-Regeln",
 * "Publishing-Flow").
 *
 * `emphatic` is the ink variant: white text on #171B20. It is reserved for a
 * statement the design document itself emphasises, because a page where
 * everything is emphatic emphasises nothing.
 *
 * A page that shows one as the outcome of a save (Marketplace's "Posted", the
 * push page's "queued") gives it the ref `useReveal` returns (feature 041), so
 * the page moves to it when it appears. `scroll-my-6` only sets the gap that
 * move leaves at the window's edge; it changes nothing you can see.
 */
import type { ReactNode, Ref } from 'react'

const VARIANTS = {
  gold: 'bg-tint-gold border-l-accent text-text',
  neutral: 'bg-ground border-l-navy text-text',
  info: 'bg-tint-info border-l-navy-2 text-text',
  emphatic: 'bg-ink border-l-accent text-text-on-dark',
} as const

export type CalloutVariant = keyof typeof VARIANTS

export type CalloutProps = {
  variant?: CalloutVariant
  title?: ReactNode
  children?: ReactNode
  className?: string
  /** React 19 passes `ref` as a prop (as `Button` does); it reaches the root `div`. */
  ref?: Ref<HTMLDivElement>
}

export function Callout({ variant = 'neutral', title, children, className = '', ref }: CalloutProps) {
  const emphatic = variant === 'emphatic'
  return (
    <div
      ref={ref}
      className={`scroll-my-6 rounded-card border-l-4 px-5 py-4 ${VARIANTS[variant] ?? VARIANTS.neutral} ${className}`}
    >
      {title && <h3 className="text-[17px] font-semibold leading-tight">{title}</h3>}
      {children && (
        <div
          className={`text-[13px] leading-relaxed ${title ? 'mt-1.5' : ''} ${
            emphatic ? 'text-text-on-dark' : 'text-text-muted'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export default Callout

/**
 * A tinted block with a 4px left rule — the mockups' way of stating a rule the
 * reader must not miss ("Keine Mitgliedschaft.", "Merchant-Regeln",
 * "Publishing-Flow").
 *
 * `emphatic` is the ink variant: white text on #171B20. It is reserved for a
 * statement the design document itself emphasises, because a page where
 * everything is emphatic emphasises nothing.
 */
import type { ReactNode } from 'react'

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
}

export function Callout({ variant = 'neutral', title, children, className = '' }: CalloutProps) {
  const emphatic = variant === 'emphatic'
  return (
    <div
      className={`rounded-card border-l-4 px-5 py-4 ${VARIANTS[variant] ?? VARIANTS.neutral} ${className}`}
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

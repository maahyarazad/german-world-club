/**
 * The console's basic surface.
 *
 * Flat: a white fill, a 1px hairline, an 8px radius and no shadow. The mockups
 * contain no drop shadow anywhere, and that is not an omission — the design
 * document asks for "hohe Kontraste, funktionale Hierarchie", and separating
 * surfaces by hairline rather than by elevation is what produces it. A shadow
 * here would work against the whole system.
 */
import type { HTMLAttributes, ReactNode } from 'react'

export type CardProps = HTMLAttributes<HTMLElement> & {
  title?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}

export function Card({ title, actions, children, className = '', ...rest }: CardProps) {
  return (
    <section
      className={`rounded-card border border-hairline bg-surface p-5 sm:p-6 ${className}`}
      {...rest}
    >
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          {title && <h2 className="text-[17px] font-semibold leading-tight text-text">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export default Card

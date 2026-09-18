import type { ReactNode } from 'react'

/**
 * One tile in the four-across KPI row every portal dashboard opens with.
 *
 * The numeral is navy and large; the caption is 11px and muted. That ordering
 * is the point of the component — the mockups put the figure first and explain
 * it second, because a dashboard that leads with its labels makes the reader
 * do the scanning.
 */
export type KpiTileProps = { value: ReactNode; caption: ReactNode; className?: string }

export function KpiTile({ value, caption, className = '' }: KpiTileProps) {
  return (
    <div className={`rounded-card border border-hairline bg-ground px-5 py-4 ${className}`}>
      <div className="text-[28px] font-bold leading-none text-navy">{value}</div>
      <div className="mt-1.5 text-[11px] leading-snug text-text-muted">{caption}</div>
    </div>
  )
}

/** The row itself. One column on a phone, four on a wide screen. */
export type KpiRowProps = { children?: ReactNode; className?: string }

export function KpiRow({ children, className = '' }: KpiRowProps) {
  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${className}`}>
      {children}
    </div>
  )
}

export default KpiTile

/**
 * The page header from every mockup: title, one explanatory line, and the 3px
 * gold rule beneath the whole thing.
 *
 * That rule is the single largest piece of gold on the page and the reason the
 * accent reads as a brand mark rather than as decoration — it appears once per
 * page, always in the same place.
 */
export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="border-b-[3px] border-accent pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-text">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export default PageHeader

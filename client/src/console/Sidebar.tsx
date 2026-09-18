import type { Module } from '@gwc/contracts/permissions'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { hasAnyGrant, isAvailable } from '@gwc/contracts/capabilities'
import { useCapabilities } from '../lib/capabilities'
import { useTranslations } from '../i18n/index'

/**
 * The dark sidebar from every portal mockup.
 *
 * Derived from the capability snapshot on every render. Never stored, never
 * merged with a local default, and never falling back to a hard-coded list —
 * those are three different ways of showing someone a link the server will
 * refuse, and the third is the one that survives a code review.
 *
 * Items the principal holds a grant on but the server cannot serve yet are
 * rendered as disabled with the reason attached. That is SC-001: a module is
 * either working or visibly marked unavailable, never silently missing.
 */
export type SidebarItem = {
  to: string
  /** Absent for items that need no grant at all (the dashboard root). */
  module?: Module
  /** Falls back to the translated module name. */
  label?: ReactNode
  /** Passed to NavLink: exact-match this route rather than prefix-match. */
  end?: boolean
}

export type SidebarProps = { items?: readonly SidebarItem[]; title?: string }

export function Sidebar({ items = [], title }: SidebarProps) {
  const t = useTranslations()
  const { snapshot } = useCapabilities()

  const visible = items.filter((item: SidebarItem) => !item.module || hasAnyGrant(snapshot, item.module))

  return (
    <nav aria-label={title} className="flex h-full flex-col bg-ink py-4">
      <p className="px-5 pb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-on-dark-muted">
        {title}
      </p>
      <ul className="flex flex-col">
        {visible.map((item: SidebarItem) => {
          const ready = !item.module || isAvailable(snapshot, item.module)
          const label = item.label ?? (item.module ? t.modules[item.module] : undefined) ?? item.module

          if (!ready) {
            return (
              <li key={item.to}>
                <span
                  className="block px-5 py-2.5 text-[13px] text-text-on-dark-muted"
                  title={t.console.notAvailableHint}
                >
                  {label}
                  <span className="ml-2 text-[11px]">({t.console.notAvailable})</span>
                </span>
              </li>
            )
          }

          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  // The 4px gold rule on the active item is the single most
                  // repeated use of the accent in the mockups. Inactive items
                  // carry a transparent rule of the same width so switching
                  // between them shifts nothing.
                  `block border-l-4 px-5 py-2.5 text-[13px] transition-colors ${
                    isActive
                      ? 'border-l-accent bg-navy font-semibold text-text-on-dark'
                      : 'border-l-transparent text-text-on-dark-muted hover:bg-ink-2 hover:text-text-on-dark'
                  }`
                }
              >
                {label}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default Sidebar

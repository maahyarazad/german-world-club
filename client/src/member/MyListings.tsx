import { useEffect, useState } from 'react'
import { get, ApiError } from '../lib/api'
import type { OwnListingSummary } from '@gwc/contracts/marketplace'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import PageLoader from '../components/ui/PageLoader'
import Callout from '../components/ui/Callout'
import { useLocale, useTranslations } from '../i18n/index'
import { formatDate } from '../lib/format'

/**
 * The member's own listings, in every state (feature 037, US1).
 *
 * `GET /marketplace/mine` is the owner's management list: unlike the browse
 * page it includes drafts, sold, withdrawn and staff-disabled listings. What to
 * offer on each row comes from the server's `canEdit` and `moderated` flags —
 * this component only draws them (Principle I); the server re-checks every
 * save. A disabled listing is shown as disabled with no reason: the owner is
 * told it was taken down, never by whom or why.
 */

const STATE_TONE: Record<string, 'success' | 'pending' | 'danger' | 'neutral'> = {
  active: 'success', draft: 'pending', hidden: 'danger',
  sold: 'neutral', filled: 'neutral', withdrawn: 'neutral', expired: 'neutral',
}

export function MyListings({ refreshKey, onEdit }: {
  /** Bumped by the page after a save so the list reloads. */
  refreshKey: number
  onEdit: (id: string) => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [items, setItems] = useState<OwnListingSummary[] | null>(null)
  // A flag that stops the loader and says why, not a stored server refusal.
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setFailed(false)
    get('/marketplace/mine', { signal: controller.signal })
      .then((body) => setItems((body as { items: OwnListingSummary[] }).items))
      .catch((err) => {
        if (controller.signal.aborted) return
        console.error('MyListings.load', err instanceof ApiError ? err.problem : err)
        setFailed(true)
      })
    return () => controller.abort()
  }, [refreshKey])

  if (failed) return <Callout variant="neutral" title={t.memberMarketplace.myListingsLoadFailed} />

  return (
    <Card title={t.memberMarketplace.myListings}>
      {items === null ? <PageLoader size="md" className="min-h-0 py-6" /> : items.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-text-muted">{t.memberMarketplace.myListingsEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-card border border-hairline p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[15px] font-semibold text-text">{item.title}</p>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {t.memberMarketplace.categories[item.category] ?? item.category}
                    {' · '}
                    {formatDate(item.createdAt, locale)}
                  </p>
                </div>
                <StatusPill tone={STATE_TONE[item.state] ?? 'neutral'}>
                  {t.memberMarketplace.states[item.state] ?? item.state}
                </StatusPill>
              </div>
              {item.moderated && (
                <p className="mt-2 text-[12px] text-text-muted">{t.memberMarketplace.publishDisabledByStaff}</p>
              )}
              {item.canEdit && (
                <div className="mt-3">
                  <Button variant="secondary" onClick={() => onEdit(item.id)}>{t.memberMarketplace.edit}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default MyListings

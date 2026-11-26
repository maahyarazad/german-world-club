import { useEffect, useState, useCallback } from 'react'
import { get, post, request, ApiError } from '../../lib/api'
import { useCanEdit } from '../RequireGrant'
import RequireGrant from '../RequireGrant'
import PageHeader from '../../components/ui/PageHeader'
import Card from '../../components/ui/Card'
import DataTable from '../../components/ui/DataTable'
import type { DataColumn } from '../../components/ui/DataTable'
import StatusPill from '../../components/ui/StatusPill'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import { useLocale, useTranslations } from '../../i18n/index'
import { formatDateTime } from '../../lib/format'
import PageLoader from '../../components/ui/PageLoader'
import MarketplaceListings from './MarketplaceListings'

/**
 * Staff moderation of the marketplace (US4, contracts/moderation-api.md).
 *
 * Two tabs. **Reports** is the queue a complaint arrives in. **All listings**
 * (feature 037) is a browser over every member listing in every state, because
 * staff must be able to find and stop a bad record without waiting for someone
 * to report it. That reverses this file's earlier stance ("there is no separate
 * listing browser here"), and the part of it that mattered is kept: the browser
 * calls only `read`, `status` and `delete` routes. `write`/`edit` do not exist
 * on this module (server/src/modules/marketplace/staff-routes.ts), so nothing
 * on either tab can change what a member said.
 *
 * Every hide/disable, restore/enable, remove and resolve asks for a reason
 * before sending — FR-020's confirmation, and the same field the server refuses
 * to act without. There is no `danger` button variant in this system
 * (Button.tsx); a destructive action here is a secondary button behind that
 * reason field, never a red button inviting the click it warns about.
 */

type Report = {
  id: string
  listingId: string
  reporterId: string
  reason: string
  state: 'open' | 'upheld' | 'dismissed'
  createdAt: string
  listingTitle: string
  listingState: string
}

const REPORT_TONE = { open: 'pending', upheld: 'danger', dismissed: 'neutral' } as const
const LISTING_TONE: Record<string, 'success' | 'pending' | 'danger' | 'neutral'> = {
  active: 'success', hidden: 'danger', withdrawn: 'neutral', sold: 'neutral',
  filled: 'neutral', expired: 'neutral', draft: 'neutral',
}

/** The one action a report row can be mid-flight on, so only one reason field is ever open per row. */
type PendingAction = { reportId: string; kind: 'hide' | 'restore' | 'remove' | 'upheld' | 'dismissed' }

function ModerationQueue() {
  const t = useTranslations()
  const { locale } = useLocale()
  const canStatus = useCanEdit('marketplace_moderation', 'status')
  const canDelete = useCanEdit('marketplace_moderation', 'delete')

  const [reports, setReports] = useState<Report[] | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const body = (await get('/admin/marketplace/reports', { signal })) as { items: Report[] }
      setReports(body.items)
    } catch (err) {
      console.error('ModerationQueue.load', err instanceof ApiError ? err.problem : err)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const startAction = (reportId: string, kind: PendingAction['kind']) => {
    setPending({ reportId, kind })
    setReason('')
  }

  const cancelAction = () => {
    setPending(null)
    setReason('')
  }

  const confirmAction = async () => {
    if (!pending) return
    const report = reports?.find((r) => r.id === pending.reportId)
    if (!report) return

    setBusy(true)
    try {
      if (pending.kind === 'hide') {
        await post(`/admin/marketplace/listings/${report.listingId}/hide`, { reason })
      } else if (pending.kind === 'restore') {
        await post(`/admin/marketplace/listings/${report.listingId}/restore`, { reason })
      } else if (pending.kind === 'remove') {
        await request(`/admin/marketplace/listings/${report.listingId}`, { method: 'DELETE', body: { reason } })
      } else {
        await post(`/admin/marketplace/reports/${report.id}/resolve`, { outcome: pending.kind, reason })
      }
      setPending(null)
      setReason('')
      await load()
    } catch (err) {
      console.error('ModerationQueue.confirmAction', err instanceof ApiError ? err.problem : err)
    } finally {
      setBusy(false)
    }
  }

  const columns: DataColumn<Report & { id: string }>[] = [
    { key: 'listingTitle', header: t.marketplaceModeration.listing },
    {
      key: 'listingState',
      header: t.marketplaceModeration.listingState,
      render: (r) => <StatusPill tone={LISTING_TONE[r.listingState] ?? 'neutral'}>{r.listingState}</StatusPill>,
    },
    { key: 'reason', header: t.marketplaceModeration.reason },
    {
      key: 'state',
      header: t.marketplaceModeration.reportState,
      render: (r) => <StatusPill tone={REPORT_TONE[r.state]}>{r.state}</StatusPill>,
    },
    { key: 'createdAt', header: t.marketplaceModeration.reported, render: (r) => formatDateTime(r.createdAt, locale) },
    {
      key: 'actions',
      header: t.marketplaceModeration.actions,
      render: (r) => (
        <div className="flex flex-wrap gap-2">
          {/* Absent, not disabled, without the flag (RequireGrant.tsx's rule):
              a member holding only `read` sees a queue with no controls at all. */}
          {canStatus && r.listingState === 'active' && (
            <Button variant="secondary" onClick={() => startAction(r.id, 'hide')}>{t.marketplaceModeration.hide}</Button>
          )}
          {canStatus && r.listingState === 'hidden' && (
            <Button variant="secondary" onClick={() => startAction(r.id, 'restore')}>{t.marketplaceModeration.restore}</Button>
          )}
          {canDelete && (
            <Button variant="secondary" onClick={() => startAction(r.id, 'remove')}>{t.marketplaceModeration.remove}</Button>
          )}
          {canStatus && r.state === 'open' && (
            <>
              <Button variant="secondary" onClick={() => startAction(r.id, 'upheld')}>{t.marketplaceModeration.upheld}</Button>
              <Button variant="quiet" onClick={() => startAction(r.id, 'dismissed')}>{t.marketplaceModeration.dismissed}</Button>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <Card title={t.marketplaceModeration.queue}>
        {reports === null
          ? <PageLoader size="md" className="min-h-0 py-6" />
          : <DataTable columns={columns} rows={reports} empty={t.marketplaceModeration.empty} />}
      </Card>

      {pending && (
        <Card title={t.marketplaceModeration.confirmTitle}>
          {/* The confirmation FR-020 requires: nothing above sends anything on
              its own click, only on this second, explicit step — and the
              reason typed here is the same one the server refuses to act
              without. */}
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              {t.marketplaceModeration.reasonLabel}
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text"
              />
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" loading={busy} disabled={reason.trim().length < 3} onClick={confirmAction}>
                {t.marketplaceModeration.confirm}
              </Button>
              <Button variant="quiet" disabled={busy} onClick={cancelAction}>{t.marketplaceModeration.cancel}</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

function MarketplaceTabs() {
  const t = useTranslations()
  const [tab, setTab] = useState<'reports' | 'listings'>('reports')
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.marketplaceModeration.title} subtitle={t.marketplaceModeration.subtitle} />
      <div className="flex gap-2" role="group">
        <Button variant={tab === 'reports' ? 'secondary' : 'quiet'} aria-pressed={tab === 'reports'} onClick={() => setTab('reports')}>
          {t.marketplaceModeration.tabReports}
        </Button>
        <Button variant={tab === 'listings' ? 'secondary' : 'quiet'} aria-pressed={tab === 'listings'} onClick={() => setTab('listings')}>
          {t.marketplaceModeration.tabListings}
        </Button>
      </div>
      {tab === 'reports' ? <ModerationQueue /> : <MarketplaceListings />}
    </div>
  )
}

export function Marketplace() {
  const t = useTranslations()
  return (
    <RequireGrant
      module="marketplace_moderation"
      flag="read"
      // Named explicitly rather than the default `null`: a staff member who
      // reaches this URL without the grant (the sidebar would not have shown
      // it) should see the same "not available" statement SC-001 asks the
      // sidebar for, not a blank page that reads as broken.
      fallback={
        <Callout variant="neutral" title={t.console.notAvailable}>
          {t.console.notAvailableHint}
        </Callout>
      }
    >
      <MarketplaceTabs />
    </RequireGrant>
  )
}

export default Marketplace

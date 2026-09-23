import { useEffect, useState, useCallback } from 'react'
import { get, post, request, ApiError } from '../../lib/api'
import { describeProblem } from '../../lib/problems'
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

/**
 * Staff moderation of the marketplace (US4, contracts/moderation-api.md).
 *
 * Reached from the report queue, deliberately — there is no separate listing
 * browser here. §8 frames moderation as a response to a complaint, not a
 * general editing surface, and the endpoints back that: `write`/`edit` do not
 * exist on this module (server/src/modules/marketplace/staff-routes.ts), so
 * there is nothing for a browser-and-edit screen to call.
 *
 * Every hide, restore, remove and resolve asks for a reason before sending —
 * FR-020's confirmation, and the same field the server refuses to act
 * without. There is no `danger` button variant in this system (Button.tsx);
 * a destructive action here is a secondary button behind that reason field,
 * never a red button inviting the click it warns about.
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const body = (await get('/admin/marketplace/reports', { signal })) as { items: Report[] }
      setReports(body.items)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? describeProblem(err.problem, locale).title : String(err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const startAction = (reportId: string, kind: PendingAction['kind']) => {
    setPending({ reportId, kind })
    setReason('')
    setActionError(null)
  }

  const cancelAction = () => {
    setPending(null)
    setReason('')
    setActionError(null)
  }

  const confirmAction = async () => {
    if (!pending) return
    const report = reports?.find((r) => r.id === pending.reportId)
    if (!report) return

    setBusy(true)
    setActionError(null)
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
      setActionError(err instanceof ApiError ? describeProblem(err.problem, locale).title : String(err))
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
      <PageHeader title={t.marketplaceModeration.title} subtitle={t.marketplaceModeration.subtitle} />

      {loadError && <Callout variant="neutral" title={loadError} />}

      <Card title={t.marketplaceModeration.queue}>
        <DataTable columns={columns} rows={reports ?? []} empty={t.marketplaceModeration.empty} />
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
            {actionError && <Callout variant="neutral" title={actionError} />}
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy || reason.trim().length < 3} onClick={confirmAction}>
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
      <ModerationQueue />
    </RequireGrant>
  )
}

export default Marketplace

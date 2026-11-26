import { useCallback, useEffect, useRef, useState } from 'react'
import { get, post, ApiError } from '../../lib/api'
import { MARKETPLACE_CATEGORIES, MARKETPLACE_STATES } from '@gwc/contracts/marketplace'
import type { StaffListingPage, StaffListingRow } from '@gwc/contracts/marketplace'
import { useCanEdit } from '../RequireGrant'
import Card from '../../components/ui/Card'
import DataTable from '../../components/ui/DataTable'
import type { DataColumn } from '../../components/ui/DataTable'
import StatusPill from '../../components/ui/StatusPill'
import Button from '../../components/ui/Button'
import Field from '../../components/ui/Field'
import Callout from '../../components/ui/Callout'
import PageLoader from '../../components/ui/PageLoader'
import { useLocale, useTranslations } from '../../i18n/index'
import { formatDateTime } from '../../lib/format'

/**
 * Every member listing in every state, for staff (feature 037, US3).
 *
 * The report queue answers a complaint; this answers "show me everything", so a
 * bad record can be found and stopped without waiting for someone to report it.
 * It is read-only plus two actions — Disable and Enable, which are the existing
 * hide and restore with a reason. Nothing here can change what a member wrote:
 * `write` and `edit` stay unused on this module, and there is no endpoint for
 * it to call.
 *
 * Disable is offered only for a published or draft listing, and Enable only for
 * a disabled one. That is display (Principle I): the server refuses any other
 * state, and refuses everyone without the `status` flag.
 */

const STATE_TONE: Record<string, 'success' | 'pending' | 'danger' | 'neutral'> = {
  active: 'success', draft: 'pending', hidden: 'danger',
  sold: 'neutral', filled: 'neutral', withdrawn: 'neutral', expired: 'neutral',
}

type Row = StaffListingRow & { id: string }
type Pending = { id: string; kind: 'hide' | 'restore' }

export function MarketplaceListings() {
  const t = useTranslations()
  const { locale } = useLocale()
  const canStatus = useCanEdit('marketplace_moderation', 'status')

  const [state, setState] = useState('')
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  // The search box applies on submit, not per keystroke: each apply is a request.
  const [applied, setApplied] = useState({ state: '', category: '', q: '' })

  const [rows, setRows] = useState<Row[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  // Stops the loader and says why; the refusal itself goes to the console.
  const [failed, setFailed] = useState(false)

  const [pending, setPending] = useState<Pending | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)

  const query = useCallback((cursor?: string | null) => {
    const params = new URLSearchParams()
    if (applied.state) params.set('state', applied.state)
    if (applied.category) params.set('category', applied.category)
    if (applied.q.trim()) params.set('q', applied.q.trim())
    if (cursor) params.set('cursor', cursor)
    const qs = params.toString()
    return `/admin/marketplace/listings${qs ? `?${qs}` : ''}`
  }, [applied])

  const load = useCallback(async () => {
    const mine = ++generation.current
    setRows(null)
    setFailed(false)
    try {
      const page = (await get(query())) as StaffListingPage
      // A newer filter started while this one was in flight: its answer wins.
      if (mine !== generation.current) return
      setRows(page.items.map((r) => ({ ...r, id: r.id })))
      setNextCursor(page.nextCursor)
    } catch (err) {
      if (mine !== generation.current) return
      console.error('MarketplaceListings.load', err instanceof ApiError ? err.problem : err)
      setFailed(true)
    }
  }, [query])

  useEffect(() => { void load() }, [load])

  const loadMore = async () => {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = (await get(query(nextCursor))) as StaffListingPage
      setRows((all) => [...(all ?? []), ...page.items.map((r) => ({ ...r, id: r.id }))])
      setNextCursor(page.nextCursor)
    } catch (err) {
      console.error('MarketplaceListings.loadMore', err instanceof ApiError ? err.problem : err)
    } finally {
      setLoadingMore(false)
    }
  }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      await post(`/admin/marketplace/listings/${pending.id}/${pending.kind}`, { reason })
      setPending(null)
      setReason('')
      await load()
    } catch (err) {
      console.error('MarketplaceListings.confirm', err instanceof ApiError ? err.problem : err)
    } finally {
      setBusy(false)
    }
  }

  const columns: DataColumn<Row>[] = [
    { key: 'title', header: t.marketplaceModeration.listing },
    {
      key: 'state',
      header: t.marketplaceModeration.listingState,
      render: (r) => (
        <div className="flex flex-col gap-1">
          <StatusPill tone={STATE_TONE[r.state] ?? 'neutral'}>{t.marketplaceModeration.states[r.state] ?? r.state}</StatusPill>
          {r.state === 'hidden' && r.hiddenFromState && (
            <span className="text-[11px] text-text-muted">
              {r.hiddenFromState === 'draft' ? t.marketplaceModeration.disabledFromDraft : t.marketplaceModeration.disabledFromActive}
            </span>
          )}
        </div>
      ),
    },
    { key: 'owner', header: t.marketplaceModeration.owner, render: (r) => r.owner.displayName ?? '—' },
    { key: 'createdAt', header: t.marketplaceModeration.created, render: (r) => formatDateTime(r.createdAt, locale) },
    { key: 'openReports', header: t.marketplaceModeration.openReports },
    {
      key: 'actions',
      header: t.marketplaceModeration.actions,
      render: (r) => (
        <div className="flex flex-wrap gap-2">
          {/* Absent, not disabled, without the flag (RequireGrant.tsx's rule). */}
          {canStatus && (r.state === 'active' || r.state === 'draft') && (
            <Button variant="secondary" onClick={() => { setPending({ id: r.id, kind: 'hide' }); setReason('') }}>
              {t.marketplaceModeration.disable}
            </Button>
          )}
          {canStatus && r.state === 'hidden' && (
            <Button variant="secondary" onClick={() => { setPending({ id: r.id, kind: 'restore' }); setReason('') }}>
              {t.marketplaceModeration.enable}
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <Card title={t.marketplaceModeration.listingsTitle}>
        <p className="mb-4 text-[13px] text-text-muted">{t.marketplaceModeration.listingsSubtitle}</p>
        <form
          className="mb-4 grid gap-4 sm:grid-cols-4"
          onSubmit={(e) => { e.preventDefault(); setApplied({ state, category, q }) }}
        >
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.marketplaceModeration.filterState}
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text"
            >
              <option value="">{t.marketplaceModeration.allStates}</option>
              {MARKETPLACE_STATES.map((s) => <option key={s} value={s}>{t.marketplaceModeration.states[s]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.marketplaceModeration.filterCategory}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text"
            >
              <option value="">{t.marketplaceModeration.allCategories}</option>
              {MARKETPLACE_CATEGORIES.map((c) => <option key={c} value={c}>{t.memberMarketplace.categories[c]}</option>)}
            </select>
          </label>
          <Field
            label={t.marketplaceModeration.search}
            placeholder={t.marketplaceModeration.searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="flex items-end">
            <Button type="submit" variant="secondary">{t.marketplaceModeration.search}</Button>
          </div>
        </form>

        {failed ? <Callout variant="neutral" title={t.marketplaceModeration.loadFailed} />
          : rows === null ? <PageLoader size="md" className="min-h-0 py-6" />
          : <DataTable columns={columns} rows={rows} empty={t.marketplaceModeration.emptyListings} />}

        {nextCursor && rows !== null && (
          <div className="mt-4">
            <Button variant="secondary" loading={loadingMore} onClick={loadMore}>{t.marketplaceModeration.loadMore}</Button>
          </div>
        )}
      </Card>

      {pending && (
        <Card title={pending.kind === 'hide' ? t.marketplaceModeration.disableTitle : t.marketplaceModeration.enableTitle}>
          {/* Nothing above sends anything on its own click, only this second,
              explicit step — and the reason typed here is the one the server
              refuses to act without and writes to the audit log. */}
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
              <Button variant="secondary" loading={busy} disabled={reason.trim().length < 3} onClick={confirm}>
                {t.marketplaceModeration.confirm}
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => { setPending(null); setReason('') }}>
                {t.marketplaceModeration.cancel}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

export default MarketplaceListings

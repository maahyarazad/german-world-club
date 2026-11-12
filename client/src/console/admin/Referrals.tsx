import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { hasGrant } from '@gwc/contracts/capabilities'
import { formatReferralCode, REFERRAL_OWNER_KINDS, XP_RATE_MAX, XP_RATE_MIN } from '@gwc/contracts/referrals'
import type { ReferralOwnerKind, StaffReferralOwner, XpEntry, XpRate } from '@gwc/contracts/referrals'
import RequireGrant from '../RequireGrant'
import { get, post, put, ApiError } from '../../lib/api'
import { useCapabilities } from '../../lib/capabilities'
import { fill, formatDate, formatNumber } from '../../lib/format'
import { useLocale, useTranslations } from '../../i18n/index'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Field from '../../components/ui/Field'
import PageHeader from '../../components/ui/PageHeader'
import StatusPill from '../../components/ui/StatusPill'
import { Modal } from '../../member/threads/Modal'
import { ReferralList, XpHistory } from '../../member/Referrals'

/**
 * Staff oversight of referrals and XP (feature 018, US4).
 *
 * Disable and Reverse show only with `referrals.status`, and Change rate only
 * with `referrals.edit` — absent, not disabled, as RequireGrant.tsx states for
 * every staff screen. Both are also absent on the viewer's OWN record: staff
 * earn XP too, and deciding about one's own is refused by the server anyway.
 * Every action asks for a reason, which the server writes to the audit log.
 */

type Owner = StaffReferralOwner
type Page<T> = { items: T[]; nextCursor: string | null }

const LINK_TONE = { active: 'success', retired: 'neutral', disabled: 'danger' } as const

export function AdminReferrals() {
  return (
    <RequireGrant module="referrals" flag="read">
      <ReferralsOversight />
    </RequireGrant>
  )
}

function ReferralsOversight() {
  const t = useTranslations()
  const [selected, setSelected] = useState<Owner | null>(null)
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title={t.adminReferrals.title} subtitle={t.adminReferrals.subtitle} />
      {selected ? (
        <OwnerDetail owner={selected} onBack={() => setSelected(null)} />
      ) : (
        <>
          <Owners onOpen={setSelected} />
          <Rate />
        </>
      )}
    </div>
  )
}

function Owners({ onOpen }: { onOpen: (owner: Owner) => void }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [kind, setKind] = useState<ReferralOwnerKind | ''>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState<Page<Owner> | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (filters: { kind: string; q: string }) => {
    setFailed(false)
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v))
    try {
      setPage((await get(`/admin/referrals/owners${params.size ? `?${params}` : ''}`)) as Page<Owner>)
    } catch (error) {
      console.error('AdminReferrals.owners', error instanceof ApiError ? error.problem : error)
      setFailed(true)
    }
  }, [])

  useEffect(() => { void load({ kind: '', q: '' }) }, [load])

  const search = (event: FormEvent) => {
    event.preventDefault()
    void load({ kind, q })
  }

  return (
    <Card>
      <form onSubmit={search} className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <Field label={t.adminReferrals.search} name="q" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
          {t.adminReferrals.kind}
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ReferralOwnerKind | '')}
            className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[14px] normal-case tracking-normal text-text"
          >
            <option value="">{t.adminReferrals.allKinds}</option>
            {REFERRAL_OWNER_KINDS.map((k) => <option key={k} value={k}>{t.adminReferrals.kinds[k]}</option>)}
          </select>
        </label>
        <Button type="submit" variant="secondary">{t.adminReferrals.find}</Button>
      </form>

      {failed && <p className="text-[14px] text-text-muted">{t.adminReferrals.loadFailed}</p>}
      {page && page.items.length === 0 && <p className="text-[14px] text-text-muted">{t.adminReferrals.empty}</p>}
      {page && page.items.length > 0 && (
        <table className="w-full text-left text-[14px]">
          <thead className="text-[12px] uppercase tracking-[0.04em] text-text-muted">
            <tr>
              <th className="py-2">{t.adminReferrals.name}</th>
              <th>{t.adminReferrals.kind}</th>
              <th>{t.adminReferrals.link}</th>
              <th className="text-right">{t.adminReferrals.referrals}</th>
              <th className="text-right">{t.adminReferrals.xp}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {page.items.map((o) => (
              <tr key={`${o.ownerKind}:${o.ownerId}`}>
                <td className="py-2.5">{o.name ?? '—'}</td>
                <td>{t.adminReferrals.kinds[o.ownerKind]}</td>
                <td>
                  {o.link
                    ? <StatusPill tone={LINK_TONE[o.link.state]}>{t.adminReferrals.linkStates[o.link.state]}</StatusPill>
                    : t.adminReferrals.noLink}
                </td>
                <td className="text-right tabular-nums">
                  {formatNumber(Object.values(o.counts).reduce((a, b) => a + b, 0), locale)}
                </td>
                <td className="text-right tabular-nums">{formatNumber(o.xpBalance, locale)}</td>
                <td className="text-right">
                  <Button variant="quiet" onClick={() => onOpen(o)}>{t.adminReferrals.open}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

/** A dialog that refuses to submit without a reason — the server would refuse it too. */
function ReasonDialog({ title, hint, open, onClose, onConfirm }: {
  title: string; hint: string; open: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void>
}) {
  const t = useTranslations()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!reason.trim()) return
    setBusy(true)
    try { await onConfirm(reason.trim()); setReason('') } finally { setBusy(false) }
  }
  return (
    <Modal title={title} open={open} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-[14px] text-text-muted">{hint}</p>
        <Field label={t.adminReferrals.reason} name="reason" maxLength={500} required
          value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t.adminReferrals.cancel}</Button>
          <Button type="submit" disabled={busy || !reason.trim()}>{t.adminReferrals.confirm}</Button>
        </div>
      </form>
    </Modal>
  )
}

function OwnerDetail({ owner: initial, onBack }: { owner: Owner; onBack: () => void }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const { snapshot } = useCapabilities()
  const [owner, setOwner] = useState(initial)
  const [refresh, setRefresh] = useState(0)
  const [disabling, setDisabling] = useState(false)
  const [reversing, setReversing] = useState<XpEntry | null>(null)

  const base = `/admin/referrals/owners/${owner.ownerKind}/${owner.ownerId}`
  const own = owner.ownerKind === 'admin' && snapshot?.kind === 'staff' && snapshot.id === owner.ownerId
  const canChange = hasGrant(snapshot, 'referrals', 'status') && !own

  const reload = async () => {
    try {
      setOwner((await get(base)) as Owner)
      setRefresh((n) => n + 1)
    } catch (error) {
      console.error('AdminReferrals.reload', error instanceof ApiError ? error.problem : error)
    }
  }

  const disable = async (reason: string) => {
    if (!owner.link) return
    try {
      await post(`/admin/referrals/links/${owner.link.id}/disable`, { reason })
      setDisabling(false)
      await reload()
    } catch (error) {
      console.error('AdminReferrals.disable', error instanceof ApiError ? error.problem : error)
    }
  }

  const reverse = async (reason: string) => {
    if (!reversing) return
    try {
      await post(`/admin/referrals/xp/${reversing.id}/reverse`, { reason })
      setReversing(null)
      await reload()
    } catch (error) {
      console.error('AdminReferrals.reverse', error instanceof ApiError ? error.problem : error)
    }
  }

  return (
    <>
      <div><Button variant="quiet" onClick={onBack}>{t.adminReferrals.back}</Button></div>
      <Card
        title={`${owner.name ?? '—'} · ${t.adminReferrals.kinds[owner.ownerKind]}`}
        actions={canChange && owner.link?.state === 'active'
          ? <Button variant="secondary" onClick={() => setDisabling(true)}>{t.adminReferrals.disableLink}</Button>
          : undefined}
      >
        <div className="flex flex-wrap items-center gap-4 text-[14px]">
          {owner.link && (
            <>
              <code className="font-mono tracking-[0.12em]">{formatReferralCode(owner.link.code)}</code>
              <StatusPill tone={LINK_TONE[owner.link.state]}>{t.adminReferrals.linkStates[owner.link.state]}</StatusPill>
            </>
          )}
          <span className="font-semibold">{fill(t.referrals.xpUnit, { n: formatNumber(owner.xpBalance, locale) })}</span>
        </div>
        {own && <p className="mt-3 text-[13px] text-text-muted">{t.adminReferrals.ownRecord}</p>}
      </Card>

      <ReferralList key={`r${refresh}`} url={`${base}/referrals`} />
      <XpHistory
        url={`${base}/xp`}
        refreshKey={refresh}
        action={(entry) => (canChange && entry.kind === 'award' && !entry.reversed
          ? <Button variant="quiet" onClick={() => setReversing(entry)}>{t.adminReferrals.reverse}</Button>
          : null)}
      />

      <ReasonDialog title={t.adminReferrals.disableTitle} hint={t.adminReferrals.disableHint}
        open={disabling} onClose={() => setDisabling(false)} onConfirm={disable} />
      <ReasonDialog title={t.adminReferrals.reverseTitle} hint={t.adminReferrals.reverseHint}
        open={reversing !== null} onClose={() => setReversing(null)} onConfirm={reverse} />
    </>
  )
}

function Rate() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { snapshot } = useCapabilities()
  const canEdit = hasGrant(snapshot, 'referrals', 'edit')
  const [rate, setRate] = useState<{ current: XpRate; history: XpRate[] } | null>(null)
  const [changing, setChanging] = useState(false)
  const [xp, setXp] = useState('')

  const load = useCallback(async () => {
    try {
      setRate((await get('/admin/referrals/xp-rate')) as { current: XpRate; history: XpRate[] })
    } catch (error) {
      console.error('AdminReferrals.rate', error instanceof ApiError ? error.problem : error)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const amount = Number(xp)
  const valid = Number.isInteger(amount) && amount >= XP_RATE_MIN && amount <= XP_RATE_MAX

  const change = async (reason: string) => {
    if (!valid) return
    try {
      await put('/admin/referrals/xp-rate', { xp: amount, reason })
      setChanging(false)
      setXp('')
      await load()
    } catch (error) {
      console.error('AdminReferrals.setRate', error instanceof ApiError ? error.problem : error)
    }
  }

  if (!rate) return null
  return (
    <Card
      title={t.adminReferrals.rateTitle}
      actions={canEdit ? <Button variant="secondary" onClick={() => setChanging(true)}>{t.adminReferrals.rateChange}</Button> : undefined}
    >
      <p className="text-[15px] font-semibold">{fill(t.adminReferrals.rateCurrent, { n: formatNumber(rate.current.xp, locale) })}</p>
      <h3 className="mt-4 text-[12px] font-semibold uppercase tracking-[0.04em] text-text-muted">{t.adminReferrals.rateHistory}</h3>
      <ul className="flex flex-col divide-y divide-hairline text-[14px]">
        {rate.history.map((r) => (
          <li key={r.effectiveFrom} className="flex flex-wrap justify-between gap-2 py-2">
            <span>{fill(t.referrals.xpUnit, { n: formatNumber(r.xp, locale) })} — {r.setBy ? r.reason : t.adminReferrals.rateInitial}</span>
            <span className="text-text-muted">{r.setBy ?? ''} {formatDate(r.effectiveFrom, locale)}</span>
          </li>
        ))}
      </ul>
      <Modal title={t.adminReferrals.rateChange} open={changing} onClose={() => setChanging(false)}>
        <Field label={t.adminReferrals.rateNew} type="number" name="xp" min={XP_RATE_MIN} max={XP_RATE_MAX}
          value={xp} onChange={(e) => setXp(e.target.value)} hint={t.adminReferrals.rateHint} />
        {valid && (
          <ReasonInline onConfirm={change} onCancel={() => setChanging(false)} />
        )}
      </Modal>
    </Card>
  )
}

/** The reason half of the rate dialog, shown once a valid amount is typed. */
function ReasonInline({ onConfirm, onCancel }: { onConfirm: (reason: string) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations()
  const [reason, setReason] = useState('')
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (reason.trim()) void onConfirm(reason.trim()) }}
      className="flex flex-col gap-4"
    >
      <Field label={t.adminReferrals.reason} name="reason" maxLength={500} required
        value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t.adminReferrals.cancel}</Button>
        <Button type="submit" disabled={!reason.trim()}>{t.adminReferrals.confirm}</Button>
      </div>
    </form>
  )
}

export default AdminReferrals

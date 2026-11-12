import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { formatReferralCode } from '@gwc/contracts/referrals'
import type { Referral, ReferralSummary, StageCounts, XpEntry } from '@gwc/contracts/referrals'
import { get, post, ApiError } from '../lib/api'
import { fill, formatDate, formatNumber } from '../lib/format'
import { useLocale, useTranslations } from '../i18n/index'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import StatusPill from '../components/ui/StatusPill'
import { KpiRow, KpiTile } from '../components/ui/KpiTile'
import { Modal } from './threads/Modal'

/**
 * Refer & earn (feature 018, contracts/ui-contract.md).
 *
 * One page for every web face — member, merchant, partner and staff — told
 * apart only by `basePath`, the mount the server serves that principal's own
 * referrals at. The page never says whose referrals it shows: the server knows
 * from the session, and there is no id here anybody could change.
 *
 * XP is shown as a number and the word XP, never with a currency sign
 * (FR-016): it is not money yet, and a "€" next to it would promise that it is.
 */

const STAGE_TONE = { registered: 'info', approved: 'pending', joined: 'success', did_not_join: 'neutral' } as const

const COPIED_FOR_MS = 2000

export function Referrals({ basePath }: { basePath: string }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [summary, setSummary] = useState<ReferralSummary | null>(null)
  // Only whether loading failed — never what the server said (CLAUDE.md).
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [replacing, setReplacing] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setSummary((await get(basePath)) as ReferralSummary)
    } catch (error) {
      console.error('Referrals.load', error instanceof ApiError ? error.problem : error)
      setFailed(true)
    }
  }, [basePath])

  useEffect(() => { void load() }, [load])

  const replace = async () => {
    setReplacing(true)
    try {
      setSummary((await post(`${basePath}/link/replace`)) as ReferralSummary)
      setConfirming(false)
    } catch (error) {
      console.error('Referrals.replace', error instanceof ApiError ? error.problem : error)
    } finally {
      setReplacing(false)
    }
  }

  if (failed) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <PageHeader title={t.referrals.title} />
        <Card>
          <p className="text-[14px] text-text-muted">{t.referrals.loadFailed}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void load()}>{t.referrals.retry}</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={t.referrals.title} subtitle={t.referrals.subtitle} />

      {summary && (
        <>
          <Card title={t.referrals.yourLink}>
            <div className="flex flex-col gap-4">
              <CopyRow label={t.referrals.yourLink} value={summary.link.url} buttonLabel={t.referrals.copyLink} />
              <CopyRow
                label={t.referrals.yourCode}
                value={formatReferralCode(summary.link.code)}
                buttonLabel={t.referrals.copyCode}
                mono
              />
              <div>
                <Button variant="quiet" onClick={() => setConfirming(true)}>{t.referrals.replace}</Button>
              </div>
            </div>
          </Card>

          <KpiRow>
            <KpiTile
              value={fill(t.referrals.xpUnit, { n: formatNumber(summary.xpBalance, locale) })}
              caption={t.referrals.xpBalance}
            />
            {(Object.keys(t.referrals.stages) as (keyof StageCounts)[]).map((stage) => (
              <KpiTile key={stage} value={formatNumber(summary.counts[stage], locale)} caption={t.referrals.stages[stage]} />
            ))}
          </KpiRow>
        </>
      )}

      <ReferralList url={`${basePath}/referrals`} />
      <XpHistory url={`${basePath}/xp`} />

      <Modal title={t.referrals.replaceTitle} open={confirming} onClose={() => setConfirming(false)}>
        <p className="text-[14px] text-text-muted">{t.referrals.replaceConfirm}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)}>{t.referrals.cancel}</Button>
          <Button disabled={replacing} onClick={() => void replace()}>{t.referrals.replaceAction}</Button>
        </div>
      </Modal>
    </div>
  )
}

function CopyRow({ label, value, buttonLabel, mono = false }: { label: string; value: string; buttonLabel: string; mono?: boolean }) {
  const t = useTranslations()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS)
    } catch (error) {
      // A browser that refuses clipboard access: the value is on screen and selectable.
      console.error('Referrals.copy', error)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <code className={`min-w-0 flex-1 break-all rounded-card bg-ground px-3 py-2 text-[14px] ${mono ? 'font-mono tracking-[0.12em]' : ''}`}>
          {value}
        </code>
        <Button variant="secondary" onClick={() => void copy()} aria-live="polite">
          {copied ? t.referrals.copied : buttonLabel}
        </Button>
      </div>
    </div>
  )
}

/**
 * A keyset-paged list read from `url`. Shared with the staff console, which
 * passes its own owner-scoped URL and an `action` column.
 */
function usePagedList<T>(url: string) {
  const [items, setItems] = useState<T[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const fetchPage = useCallback(async (cursor: string | null) => {
    setFailed(false)
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      const page = (await get(`${url}${query}`)) as { items: T[]; nextCursor: string | null }
      setItems((current) => (cursor ? [...current, ...page.items] : page.items))
      setNext(page.nextCursor)
    } catch (error) {
      console.error('Referrals.page', error instanceof ApiError ? error.problem : error)
      setFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [url])

  useEffect(() => { void fetchPage(null) }, [fetchPage])
  return { items, next, loaded, failed, more: () => next && fetchPage(next), reload: () => fetchPage(null) }
}

export function ReferralList({ url }: { url: string }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const list = usePagedList<Referral>(url)
  return (
    <Card title={t.referrals.yourReferrals}>
      {list.loaded && !list.failed && list.items.length === 0 && (
        <p className="text-[14px] text-text-muted">{t.referrals.emptyReferrals}</p>
      )}
      {list.failed && <p className="text-[14px] text-text-muted">{t.referrals.loadFailed}</p>}
      <ul className="flex flex-col divide-y divide-hairline">
        {list.items.map((r) => {
          const at = r.endedAt ?? r.joinedAt ?? r.approvedAt ?? r.registeredAt
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="text-[14px] font-medium">{r.refereeName}</span>
              <span className="flex items-center gap-3 text-[13px] text-text-muted">
                <StatusPill tone={STAGE_TONE[r.stage]}>{t.referrals.stages[r.stage]}</StatusPill>
                <time dateTime={at}>{formatDate(at, locale)}</time>
              </span>
            </li>
          )
        })}
      </ul>
      {list.next && <Button variant="quiet" onClick={() => void list.more()}>{t.referrals.loadMore}</Button>}
    </Card>
  )
}

export function XpHistory({ url, action, refreshKey = 0 }: {
  url: string
  /** Staff only: what to render at the end of an award row (Reverse). */
  action?: (entry: XpEntry) => ReactNode
  /** Bump to reload after a staff action. */
  refreshKey?: number
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const list = usePagedList<XpEntry>(url)
  const { reload } = list
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    void reload()
  }, [refreshKey, reload])

  return (
    <Card title={t.referrals.xpHistory}>
      {list.loaded && !list.failed && list.items.length === 0 && (
        <p className="text-[14px] text-text-muted">{t.referrals.emptyXp}</p>
      )}
      {list.failed && <p className="text-[14px] text-text-muted">{t.referrals.loadFailed}</p>}
      <ul className="flex flex-col divide-y divide-hairline">
        {list.items.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span className="text-[14px]">
              {e.kind === 'award'
                ? fill(t.referrals.xpReferral, { name: e.refereeName })
                : fill(t.referrals.xpReversed, { reason: e.reason })}
            </span>
            <span className="flex items-center gap-3 text-[13px] text-text-muted">
              <span className={`font-semibold tabular-nums ${e.amount < 0 ? 'text-text-muted' : 'text-text'}`}>
                {e.amount > 0 ? '+' : '−'}{fill(t.referrals.xpUnit, { n: formatNumber(Math.abs(e.amount), locale) })}
              </span>
              <time dateTime={e.createdAt}>{formatDate(e.createdAt, locale)}</time>
              {action?.(e)}
            </span>
          </li>
        ))}
      </ul>
      {list.next && <Button variant="quiet" onClick={() => void list.more()}>{t.referrals.loadMore}</Button>}
    </Card>
  )
}

export default Referrals

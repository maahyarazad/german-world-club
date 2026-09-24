import { useCallback, useEffect, useRef, useState } from 'react'
import { PROBLEMS } from '@gwc/contracts/errors'
import { hasGrant } from '@gwc/contracts/capabilities'
import {
  BODY_MAX, DESTINATION_TYPES, FINAL_NOTIFICATION_STATUSES, TITLE_MAX,
} from '@gwc/contracts/push'
import type { DestinationType, Notification, PushAudience, TestRecipientList } from '@gwc/contracts/push'
import { ApiError, pushApi } from '../../lib/api'
import { describeProblem } from '../../lib/problems'
import { fill, formatDateTime, formatNumber } from '../../lib/format'
import { useCapabilities } from '../../lib/capabilities'
import PageHeader from '../../components/ui/PageHeader'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import Field, { FormMessage } from '../../components/ui/Field'
import StatusPill from '../../components/ui/StatusPill'
import type { StatusTone } from '../../components/ui/StatusPill'
import RequireGrant from '../RequireGrant'
import { useLocale, useTranslations } from '../../i18n/index'

/**
 * The console's Push section (feature 011, US3, research R14), on the
 * `mass_messages` module.
 *
 *  - **Test users** — who receives rehearsals, added by handle.
 *  - **Compose** — German and English, both required, rehearse first, then
 *    broadcast behind a confirm that shows who it will reach. The number comes
 *    from `GET /push/audience`, which uses the same rule as the send.
 *  - **History** — what was queued and what became of it, polled while
 *    anything is still sending.
 *
 * A send only queues: the request answers 202 and the job delivers. Every send
 * carries a `clientRef` made when the form opens and again after each accepted
 * send, so a retry after a network error is recognised as the same message and
 * never sent twice (research R2).
 */

type Tab = 'test' | 'compose' | 'history'

const newRef = () => globalThis.crypto.randomUUID()

/** Destination types staff may choose. `article` stays in the contract for history only. */
const CHOOSABLE: readonly DestinationType[] = DESTINATION_TYPES.filter((d) => d !== 'article')

const STATUS_TONE: Record<Notification['status'], StatusTone> = {
  queued: 'pending',
  sending: 'info',
  done: 'success',
  partial: 'pending',
  failed: 'danger',
  cancelled: 'neutral',
}

function useProblemText() {
  const t = useTranslations()
  const { locale } = useLocale()
  return useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      const described = describeProblem(err.problem, locale)
      return described.body ? `${described.title}: ${described.body}` : described.title
    }
    return t.pushAdmin.networkError
  }, [locale, t])
}

// ---------------------------------------------------------------------------
// Test users
// ---------------------------------------------------------------------------

function TestUsers({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations()
  const problemText = useProblemText()
  const [recipients, setRecipients] = useState<TestRecipientList['recipients'] | null>(null)
  const [handle, setHandle] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRecipients((await pushApi.testRecipients()).recipients)
    } catch (err) {
      setError(problemText(err))
    }
  }, [problemText])

  useEffect(() => { void load() }, [load])

  const add = async () => {
    setError(null)
    try {
      await pushApi.addTestRecipient({ handle: handle.trim() })
      setHandle('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? t.pushAdmin.handleNotFound : problemText(err))
    }
  }

  const remove = async (memberId: string) => {
    setError(null)
    try {
      await pushApi.removeTestRecipient(memberId)
      await load()
    } catch (err) {
      setError(problemText(err))
    }
  }

  return (
    <Card title={t.pushAdmin.testUsers}>
      <p className="text-[13px] text-text-muted">{t.pushAdmin.testUsersHint}</p>
      {canEdit && (
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <Field label={t.pushAdmin.handle} value={handle} onChange={(e) => setHandle(e.target.value)} />
          <Button type="submit" disabled={!handle.trim()}>{t.pushAdmin.add}</Button>
        </form>
      )}
      {error && <FormMessage>{error}</FormMessage>}
      {recipients === null ? null : recipients.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t.pushAdmin.noTestUsers}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recipients.map((r) => (
            <li key={r.memberId} className="flex items-center justify-between gap-2 text-[13px] text-text">
              <span>
                {r.displayName ?? t.pushAdmin.unnamed}
                {r.handle && <span className="text-text-muted"> @{r.handle}</span>}
                {' · '}
                {fill(r.deviceCount === 1 ? t.pushAdmin.oneDevice : t.pushAdmin.devices, { count: r.deviceCount })}
              </span>
              {canEdit && <Button variant="quiet" onClick={() => void remove(r.memberId)}>{t.pushAdmin.remove}</Button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

type Draft = {
  deTitle: string; deBody: string; enTitle: string; enBody: string
  destinationType: DestinationType; destinationId: string; destinationLabel: string
}

const EMPTY: Draft = {
  deTitle: '', deBody: '', enTitle: '', enBody: '',
  destinationType: 'none', destinationId: '', destinationLabel: '',
}

const within = (text: string, max: number) => text.trim().length > 0 && text.trim().length <= max

function Compose({ onQueued }: { onQueued: () => void }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const problemText = useProblemText()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  // Made when the form opens and again after every accepted send. Kept across
  // a network error, so resending the same message is deduplicated.
  const clientRef = useRef(newRef())
  // A ref, not only state: two clicks in the same tick both see the state
  // from before either re-render, and would both send.
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<PushAudience | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const set = (key: keyof Draft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }))

  const valid = within(draft.deTitle, TITLE_MAX) && within(draft.deBody, BODY_MAX)
    && within(draft.enTitle, TITLE_MAX) && within(draft.enBody, BODY_MAX)
    && (draft.destinationType === 'none' || draft.destinationId.trim().length > 0)

  const send = async (kind: 'rehearsal' | 'broadcast') => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const body = {
        clientRef: clientRef.current,
        de: { title: draft.deTitle, body: draft.deBody },
        en: { title: draft.enTitle, body: draft.enBody },
        ...(draft.destinationType === 'none' ? {} : {
          destination: {
            type: draft.destinationType,
            id: draft.destinationId.trim(),
            ...(draft.destinationLabel.trim() ? { label: draft.destinationLabel.trim() } : {}),
          },
        }),
      }
      await (kind === 'rehearsal' ? pushApi.rehearse(body) : pushApi.broadcast(body))
      // Accepted (202, or 200 for a repeat): the next message is a new one.
      clientRef.current = newRef()
      setConfirm(null)
      setNotice(kind === 'rehearsal' ? t.pushAdmin.rehearsalQueued : t.pushAdmin.broadcastQueued)
      onQueued()
    } catch (err) {
      if (err instanceof ApiError && err.problem.type === PROBLEMS.PUSH_IDEMPOTENCY_CONFLICT.type) {
        // The ref belongs to a message already sent; this one gets its own.
        clientRef.current = newRef()
      }
      setError(problemText(err))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const askBroadcast = async () => {
    if (inFlight.current) return
    setError(null)
    try {
      setConfirm(await pushApi.audience('broadcast'))
    } catch (err) {
      setError(problemText(err))
    }
  }

  const counter = (text: string, max: number) => (
    <span className={text.trim().length > max ? 'text-tint-danger-fg' : ''}>{fill(t.pushAdmin.counter, { count: text.trim().length, max })}</span>
  )

  return (
    <Card title={t.pushAdmin.compose}>
      <div className="grid gap-4 md:grid-cols-2">
        {(['de', 'en'] as const).map((lang) => {
          const title = lang === 'de' ? 'deTitle' : 'enTitle'
          const body = lang === 'de' ? 'deBody' : 'enBody'
          return (
            <fieldset key={lang} className="flex flex-col gap-2">
              <legend className="text-[12px] font-semibold uppercase text-text-muted">
                {lang === 'de' ? t.pushAdmin.german : t.pushAdmin.english}
              </legend>
              <Field label={t.pushAdmin.title} value={draft[title]} onChange={set(title)} />
              <p className="text-[12px] text-text-muted">{counter(draft[title], TITLE_MAX)}</p>
              <label className="flex flex-col gap-1 text-[13px] text-text">
                {t.pushAdmin.body}
                <textarea
                  className="min-h-24 rounded-md border border-hairline bg-surface p-2 text-[14px]"
                  value={draft[body]}
                  onChange={set(body)}
                />
              </label>
              <p className="text-[12px] text-text-muted">{counter(draft[body], BODY_MAX)}</p>
            </fieldset>
          )
        })}
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-[13px] text-text">
          {t.pushAdmin.destination}
          <select
            className="rounded-md border border-hairline bg-surface p-2 text-[14px]"
            value={draft.destinationType}
            onChange={set('destinationType')}
          >
            {CHOOSABLE.map((d) => <option key={d} value={d}>{t.pushAdmin.destinations[d as keyof typeof t.pushAdmin.destinations]}</option>)}
          </select>
        </label>
        {draft.destinationType !== 'none' && (
          <>
            <Field label={draft.destinationType === 'partner' ? t.pushAdmin.destinationSlug : t.pushAdmin.destinationId}
              value={draft.destinationId} onChange={set('destinationId')} />
            <Field label={t.pushAdmin.destinationLabel} value={draft.destinationLabel} onChange={set('destinationLabel')} />
          </>
        )}
      </div>

      {error && <FormMessage>{error}</FormMessage>}
      {notice && <Callout variant="neutral" title={notice}>{t.pushAdmin.queuedHint}</Callout>}

      {confirm ? (
        <div role="alertdialog" aria-label={t.pushAdmin.confirmTitle} className="flex flex-col gap-2 rounded-md border border-hairline p-3">
          <p className="text-[14px] font-semibold text-text">{t.pushAdmin.confirmTitle}</p>
          <p className="text-[13px] text-text">
            {fill(t.pushAdmin.confirmBody, {
              members: formatNumber(confirm.members, locale),
              devices: formatNumber(confirm.devices, locale),
            })}
          </p>
          <div className="flex gap-2">
            <Button variant="accent" disabled={busy} onClick={() => void send('broadcast')}>{t.pushAdmin.confirmSend}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>{t.pushAdmin.cancel}</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!valid || busy} onClick={() => void send('rehearsal')}>{t.pushAdmin.sendRehearsal}</Button>
          <Button disabled={!valid || busy} onClick={() => void askBroadcast()}>{t.pushAdmin.broadcast}</Button>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const POLL_MS = 5000

function History({ refreshKey }: { refreshKey: number }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const problemText = useProblemText()
  const [items, setItems] = useState<Notification[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems((await pushApi.history()).notifications)
      setError(null)
    } catch (err) {
      setError(problemText(err))
    }
  }, [problemText])

  useEffect(() => { void load() }, [load, refreshKey])

  // Poll only while something is still on its way; a finished history is
  // final and costs nothing to leave alone.
  const live = items?.some((n) => !(FINAL_NOTIFICATION_STATUSES as readonly string[]).includes(n.status)) ?? false
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(timer)
  }, [live, load])

  return (
    <Card title={t.pushAdmin.history}>
      {error && <FormMessage>{error}</FormMessage>}
      {items === null ? null : items.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t.pushAdmin.noHistory}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((n) => {
            const text = locale === 'en' ? n.en : n.de
            return (
              <li key={n.id} className="flex flex-col gap-1 border-b border-hairline pb-2 text-[13px] text-text">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="neutral">{t.pushAdmin.kinds[n.kind]}</StatusPill>
                  <StatusPill tone={STATUS_TONE[n.status]}>{t.pushAdmin.statuses[n.status]}</StatusPill>
                  <span className="text-text-muted">{formatDateTime(n.createdAt, locale)}</span>
                  {n.sentBy?.displayName && <span className="text-text-muted">· {n.sentBy.displayName}</span>}
                </div>
                <span className="font-semibold">{text?.title ?? t.pushAdmin.notRendered}</span>
                {text && <span className="text-text-muted">{text.body}</span>}
                <span className="text-[12px] text-text-muted">
                  {fill(t.pushAdmin.totals, {
                    sent: formatNumber(n.totals.sent + n.totals.delivered, locale),
                    delivered: formatNumber(n.totals.delivered, locale),
                    failed: formatNumber(n.totals.failed, locale),
                    skipped: formatNumber(n.totals.skipped, locale),
                    pending: formatNumber(n.totals.pending, locale),
                  })}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------

function PushConsole() {
  const t = useTranslations()
  const { snapshot } = useCapabilities()
  const canWrite = hasGrant(snapshot, 'mass_messages', 'write')
  const canEdit = hasGrant(snapshot, 'mass_messages', 'edit')
  const [tab, setTab] = useState<Tab>(canWrite ? 'compose' : 'history')
  const [refreshKey, setRefreshKey] = useState(0)

  // Absent, not disabled, without the flag (RequireGrant.tsx's rule).
  const tabs: { id: Tab; label: string }[] = [
    ...(canWrite ? [{ id: 'compose' as const, label: t.pushAdmin.compose }] : []),
    { id: 'test', label: t.pushAdmin.testUsers },
    { id: 'history', label: t.pushAdmin.history },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.pushAdmin.pageTitle} subtitle={t.pushAdmin.subtitle} />
      <div role="tablist" className="flex gap-2">
        {tabs.map((item) => (
          <Button key={item.id} role="tab" aria-selected={tab === item.id}
            variant={tab === item.id ? 'primary' : 'secondary'} onClick={() => setTab(item.id)}>
            {item.label}
          </Button>
        ))}
      </div>
      {tab === 'compose' && canWrite && (
        <Compose onQueued={() => setRefreshKey((k) => k + 1)} />
      )}
      {tab === 'test' && <TestUsers canEdit={canEdit} />}
      {tab === 'history' && <History refreshKey={refreshKey} />}
    </div>
  )
}

export function Push() {
  const t = useTranslations()
  return (
    <RequireGrant
      module="mass_messages"
      flag="read"
      fallback={<Callout variant="neutral" title={t.console.notAvailable}>{t.console.notAvailableHint}</Callout>}
    >
      <PushConsole />
    </RequireGrant>
  )
}

export default Push

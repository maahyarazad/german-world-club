import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { isRequestId, isClientRequestId } from '@gwc/contracts/request-id'
import type { ServerFault, ServerFaultListQuery, ServerFaultSummary } from '@gwc/contracts/server-faults'
import { ApiError, serverFaultsApi } from '../../lib/api'
import { fill, formatDateTime, formatNumber } from '../../lib/format'
import PageHeader from '../../components/ui/PageHeader'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import Field from '../../components/ui/Field'
import RequireGrant from '../RequireGrant'
import { useLocale, useTranslations } from '../../i18n/index'

/**
 * The Fehlerprotokoll (feature 012, US3, contracts/server-faults-api.md), on
 * the `server_faults` module.
 *
 *  - **Lookup** — the id a member read off an error page finds its fault. A
 *    value that is not a server ULID but has the client-id shape is searched
 *    as the client's own correlation id instead, through the list filter.
 *  - **List** — newest first, "load older" by cursor, filter to one fault's
 *    fingerprint.
 *
 * Read-only by design: the server offers no way to edit or delete a record.
 * `message` and `stack` are server English and are shown exactly as recorded,
 * in either language — the same rule as a problem's `detail`.
 */

type Filter = Pick<ServerFaultListQuery, 'fingerprint' | 'clientRequestId'>

const short = (fingerprint: string) => fingerprint.slice(0, 8)

export function ServerFaults() {
  const t = useTranslations()
  return (
    <RequireGrant
      module="server_faults"
      flag="read"
      fallback={<Callout variant="neutral" title={t.console.notAvailable}>{t.console.notAvailableHint}</Callout>}
    >
      <ServerFaultsPage />
    </RequireGrant>
  )
}

function ServerFaultsPage() {
  const t = useTranslations()
  const { locale } = useLocale()
  const [filter, setFilter] = useState<Filter>({})
  const [items, setItems] = useState<ServerFaultSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [suppressed, setSuppressed] = useState(0)
  const [lookup, setLookup] = useState('')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ServerFault | null>(null)

  const load = useCallback(async (query: ServerFaultListQuery, append: boolean) => {
    try {
      const page = await serverFaultsApi.list(query)
      setItems((current) => (append ? [...current, ...page.items] : page.items))
      setCursor(page.nextCursor)
      setSuppressed(page.suppressedLast24h)
    } catch (err) {
      console.error('ServerFaultsPage.load', err instanceof ApiError ? err.problem : err)
    }
  }, [])

  useEffect(() => { void load(filter, false) }, [filter, load])

  const open = useCallback(async (requestId: string) => {
    setLookupError(null)
    try {
      setDetail((await serverFaultsApi.byRequest(requestId)).item)
    } catch (err) {
      setDetail(null)
      console.error('ServerFaultsPage.open', err instanceof ApiError ? err.problem : err)
    }
  }, [])

  const onLookup = (event: FormEvent) => {
    event.preventDefault()
    const value = lookup.trim()
    setLookupError(null)
    if (isRequestId(value)) void open(value)
    else if (isClientRequestId(value)) { setDetail(null); setFilter({ clientRequestId: value }) }
    else setLookupError(t.serverFaults.invalidId)
  }

  const filtered = filter.fingerprint
    ? fill(t.serverFaults.filteredByFault, { fingerprint: short(filter.fingerprint) })
    : filter.clientRequestId ? fill(t.serverFaults.filteredByClient, { id: filter.clientRequestId }) : null

  return (
    <div className="space-y-6">
      <PageHeader title={t.serverFaults.pageTitle} subtitle={t.serverFaults.subtitle} />

      <Card>
        <form onSubmit={onLookup} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Field
              label={t.serverFaults.lookupLabel}
              hint={t.serverFaults.lookupHint}
              error={lookupError ?? undefined}
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={!lookup.trim()}>{t.serverFaults.lookupButton}</Button>
        </form>
      </Card>

      {detail && <FaultDetail fault={detail} onClose={() => setDetail(null)} />}

      {suppressed > 0 && (
        <Callout variant="gold" title={t.serverFaults.suppressedTitle}>
          {fill(t.serverFaults.suppressedBody, { count: formatNumber(suppressed, locale) })}
        </Callout>
      )}

      {filtered && (
        <div className="flex items-center gap-3 text-sm">
          <span>{filtered}</span>
          <Button variant="quiet" onClick={() => setFilter({})}>{t.serverFaults.clearFilter}</Button>
        </div>
      )}

      <Card>
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">{t.serverFaults.empty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col">{t.serverFaults.columns.occurredAt}</th>
                <th scope="col">{t.serverFaults.columns.request}</th>
                <th scope="col">{t.serverFaults.columns.status}</th>
                <th scope="col">{t.serverFaults.columns.error}</th>
                <th scope="col">{t.serverFaults.columns.requestId}</th>
                <th scope="col"><span className="sr-only">{t.serverFaults.fields.fingerprint}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((fault) => (
                <tr key={fault.id} className="align-top">
                  <td className="whitespace-nowrap">{formatDateTime(fault.occurredAt, locale)}</td>
                  <td><code>{fault.method} {fault.route ?? '—'}</code></td>
                  <td>{fault.status}</td>
                  <td>
                    <div className="font-medium">{fault.errorName}</div>
                    <div className="text-text-muted">{fault.message}</div>
                  </td>
                  <td>
                    <Button variant="quiet" onClick={() => void open(fault.requestId)}>
                      <code>{fault.requestId}</code>
                    </Button>
                  </td>
                  <td>
                    <Button
                      variant="quiet"
                      aria-label={t.serverFaults.filterByFault}
                      title={t.serverFaults.filterByFault}
                      onClick={() => setFilter({ fingerprint: fault.fingerprint })}
                    >
                      <code>{short(fault.fingerprint)}</code>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cursor && (
          <div className="mt-4">
            <Button variant="secondary" onClick={() => void load({ ...filter, before: cursor }, true)}>
              {t.serverFaults.loadOlder}
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}

function FaultDetail({ fault, onClose }: { fault: ServerFault; onClose: () => void }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const rows: Array<[string, string]> = [
    [t.serverFaults.columns.occurredAt, formatDateTime(fault.occurredAt, locale)],
    [t.serverFaults.columns.requestId, fault.requestId],
    [t.serverFaults.fields.clientRequestId, fault.clientRequestId ?? '—'],
    [t.serverFaults.columns.request, `${fault.method} ${fault.route ?? '—'}`],
    [t.serverFaults.columns.status, String(fault.status)],
    [t.serverFaults.columns.error, fault.errorCode ? `${fault.errorName} (${fault.errorCode})` : fault.errorName],
    [t.serverFaults.fields.principal, fault.principalKind ? `${fault.principalKind} ${fault.principalId}` : t.serverFaults.anonymous],
    [t.serverFaults.fields.fingerprint, fault.fingerprint],
  ]
  return (
    <section aria-label={t.serverFaults.detailTitle}>
      <Card title={t.serverFaults.detailTitle} actions={<Button variant="quiet" onClick={onClose}>{t.serverFaults.closeDetail}</Button>}>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text-muted">{label}</dt>
              <dd><code className="break-all">{value}</code></dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-4 text-sm font-medium">{t.serverFaults.fields.message}</h3>
        {/* Verbatim and untranslated, by design. */}
        <pre className="mt-1 whitespace-pre-wrap text-sm">{fault.message}</pre>
        {fault.stack && (
          <>
            <h3 className="mt-4 text-sm font-medium">{t.serverFaults.fields.stack}</h3>
            <pre className="mt-1 overflow-x-auto text-xs">{fault.stack}</pre>
          </>
        )}
      </Card>
    </section>
  )
}

export default ServerFaults

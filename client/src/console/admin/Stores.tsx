import { useEffect, useState } from 'react'
import type { AdminStore } from '@gwc/contracts/stores'
import { hasGrant } from '@gwc/contracts/capabilities'
import { get, put, ApiError } from '../../lib/api'
import { useCapabilities } from '../../lib/capabilities'
import { fill } from '../../lib/format'
import { useTranslations } from '../../i18n/index'
import RequireGrant from '../RequireGrant'
import PageHeader from '../../components/ui/PageHeader'
import PageLoader from '../../components/ui/PageLoader'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import StatusPill from '../../components/ui/StatusPill'
import { FormMessage } from '../../components/ui/Field'
import { Modal } from '../../member/threads/Modal'
import { useAction } from '../../lib/useAction'

/**
 * Staff control of merchant stores (feature 035, US4). Deactivate and
 * Reactivate show only with `merchant_offers.status` — absent, not disabled, as
 * RequireGrant.tsx states for every staff screen — and deactivating asks for a
 * reason, which the server records. The page shows what the server says and
 * decides nothing.
 */
export function Stores() {
  return (
    <RequireGrant module="merchant_offers" flag="read">
      <StoresList />
    </RequireGrant>
  )
}

function StoresList() {
  const t = useTranslations()
  const { snapshot } = useCapabilities()
  const canSwitch = hasGrant(snapshot, 'merchant_offers', 'status')
  const [stores, setStores] = useState<AdminStore[] | null>(null)
  const [target, setTarget] = useState<AdminStore | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void (get('/admin/stores') as Promise<{ items: AdminStore[] }>).then((r) => setStores(r.items))
      .catch((err) => console.error('Stores.load', err instanceof ApiError ? err.problem : err))
  }, [])

  const replace = (next: AdminStore) => setStores((current) => current?.map((s) => (s.id === next.id ? next : s)) ?? null)

  const [deactivate, deactivating] = useAction('Stores.deactivate', async () => {
    if (!target) return
    replace((await put(`/admin/stores/${target.id}/active`, { active: false, reason: reason.trim() })) as AdminStore)
    setTarget(null); setReason(''); setMessage(null)
  })
  const [reactivate, reactivating] = useAction('Stores.reactivate', async (store: AdminStore) => {
    replace((await put(`/admin/stores/${store.id}/active`, { active: true })) as AdminStore)
  })

  if (!stores) return <PageLoader />

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.adminStores.title} subtitle={t.adminStores.subtitle} />
      {message && <FormMessage tone="danger">{message}</FormMessage>}
      {stores.length === 0 ? (
        <Card><p className="text-[14px] text-text-muted">{t.adminStores.empty}</p></Card>
      ) : (
        <Card>
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-[0.06em] text-text-muted">
              <tr>
                <th className="py-2 pr-3 font-semibold">{t.adminStores.merchant}</th>
                <th className="py-2 pr-3 font-semibold">{t.adminStores.state}</th>
                <th className="py-2 pr-3 font-semibold">{t.adminStores.offers}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id} className="border-t border-hairline">
                  <td className="py-2 pr-3">{s.displayName ?? s.slug}</td>
                  <td className="py-2 pr-3"><StatusPill tone={s.active ? 'success' : 'danger'}>{s.active ? t.adminStores.active : t.adminStores.inactive}</StatusPill></td>
                  <td className="py-2 pr-3">{s.offerCount}</td>
                  <td className="py-2 text-right">
                    {canSwitch && (s.active
                      ? <Button variant="secondary" onClick={() => { setTarget(s); setReason('') }}>{t.adminStores.deactivate}</Button>
                      : <Button variant="secondary" loading={reactivating} onClick={() => void reactivate(s)}>{t.adminStores.reactivate}</Button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {target && (
        <Modal title={t.adminStores.deactivate} open onClose={() => setTarget(null)}>
          <p className="mb-3 text-[14px] text-text">{fill(t.adminStores.confirmDeactivate, { name: target.displayName ?? target.slug })}</p>
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.adminStores.reason}
            <textarea value={reason} rows={3} maxLength={2000} onChange={(e) => setReason(e.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text" />
            <span className="text-[11px] font-normal normal-case tracking-normal">{t.adminStores.reasonHint}</span>
          </label>
          <div className="mt-4 flex gap-2">
            <Button loading={deactivating} disabled={reason.trim().length < 3} onClick={() => void deactivate()}>{t.adminStores.deactivate}</Button>
            <Button variant="quiet" onClick={() => setTarget(null)}>{t.adminStores.cancel}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default Stores

import { useState } from 'react'
import type { Designation } from '@gwc/contracts/profile'
import { get, post, request, ApiError } from '../../lib/api'
import { fill, formatDate } from '../../lib/format'
import PageHeader from '../../components/ui/PageHeader'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Field from '../../components/ui/Field'
import StatusPill from '../../components/ui/StatusPill'
import { useCapabilities } from '../../lib/capabilities'
import { hasGrant } from '@gwc/contracts/capabilities'
import { useLocale, useTranslations } from '../../i18n/index'

type Found = { id: string; displayName: string | null; handle: string; status: string }

/**
 * The influencer designation (US6, FR-017), on the `members` module.
 *
 * Staff find a member by handle, see the designation's history, and grant or
 * revoke it — always with a reason, which the server writes to the audit log.
 * The grant button shows only with `members.write`; the server checks again.
 */
export function Influencers() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { snapshot } = useCapabilities()
  const canWrite = hasGrant(snapshot, 'members', 'write')
  const [query, setQuery] = useState('')
  const [member, setMember] = useState<Found | null>(null)
  const [history, setHistory] = useState<Designation[]>([])
  const [reason, setReason] = useState('')
  const failed = (where: string, err: unknown) =>
    console.error(`Influencers.${where}`, err instanceof ApiError ? err.problem : err)


  const find = async () => {
    setMember(null); setHistory([])
    try {
      const found = (await get(`/admin/members/by-handle/${encodeURIComponent(query.trim().replace(/^@/, ''))}`)) as Found
      setMember(found)
      setHistory(((await get(`/admin/members/${found.id}/designations`)) as { items: Designation[] }).items)
    } catch (err) {
      failed('find', err)
    }
  }

  const change = async (grant: boolean) => {
    if (!member) return
    const url = `/admin/members/${member.id}/designations/influencer`
    try {
      const body = (grant ? await post(url, { reason: reason.trim() }) : await request(url, { method: 'DELETE', body: { reason: reason.trim() } })) as { items: Designation[] }
      setHistory(body.items)
      setReason('')
    } catch (err) { failed('change', err) }
  }

  const active = history.some((d) => d.revokedAt === null)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.influencerAdmin.title} subtitle={t.influencerAdmin.subtitle} />
      <Card>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void find() }}>
          <Field label={t.influencerAdmin.search} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" disabled={!query.trim()}>{t.influencerAdmin.find}</Button>
        </form>
      </Card>
      {member && (
        <Card title={`${member.displayName ?? ''} @${member.handle}`}>
          <h3 className="text-[12px] font-semibold uppercase text-text-muted">{t.influencerAdmin.history}</h3>
          {history.length === 0 ? <p className="text-[13px] text-text-muted">{t.influencerAdmin.noHistory}</p> : (
            <ul className="flex flex-col gap-2">
              {history.map((d) => (
                <li key={d.id} className="text-[13px] text-text">
                  <StatusPill tone={d.revokedAt ? 'neutral' : 'success'}>{d.revokedAt ? t.influencerAdmin.revoked : t.influencerAdmin.active}</StatusPill>{' '}
                  {fill(t.influencerAdmin.grantedOn, { date: formatDate(d.grantedAt, locale) })} — {d.grantReason}
                  {d.revokedAt && <> · {fill(t.influencerAdmin.revokedOn, { date: formatDate(d.revokedAt, locale) })} — {d.revokeReason}</>}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <div className="flex flex-col gap-2">
              <Field label={t.influencerAdmin.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button disabled={reason.trim().length < 3} onClick={() => void change(!active)}>
                {active ? t.influencerAdmin.revoke : t.influencerAdmin.grant}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

export default Influencers

import { useCallback, useEffect, useState } from 'react'
import { hasGrant } from '@gwc/contracts/capabilities'
import { countryByCode } from '@gwc/contracts/countries'
import { APPLICATION_STATES } from '@gwc/contracts/onboarding'
import type { Application, ApplicationState } from '@gwc/contracts/onboarding'
import { get, post, ApiError } from '../../lib/api'
import { fill, formatDate, formatDateTime } from '../../lib/format'
import { useCapabilities } from '../../lib/capabilities'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Field from '../../components/ui/Field'
import StatusPill from '../../components/ui/StatusPill'
import type { StatusTone } from '../../components/ui/StatusPill'
import { useLocale, useTranslations } from '../../i18n/index'

/**
 * Membership applications (feature 009), on the `members` module.
 *
 * An applicant who finished registration waits here until staff decide.
 * Viewing needs `members.read`; approving or denying needs `members.status`,
 * so the buttons show only with it — and the server checks again either way.
 * A denial needs a reason: the applicant sees it on their status screen.
 * Approving an app application also approves the device it was made on.
 */

const TONE: Record<ApplicationState, StatusTone> = { pending: 'pending', approved: 'success', denied: 'danger' }

export function Applications() {
  const t = useTranslations()
  const copy = t.applicationsAdmin
  const { locale } = useLocale()
  const { snapshot } = useCapabilities()
  const canDecide = hasGrant(snapshot, 'members', 'status')

  const [state, setState] = useState<ApplicationState>('pending')
  const [items, setItems] = useState<Application[]>([])
  const [denying, setDenying] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const body = (await get(`/admin/onboarding/applications?state=${state}`)) as { items: Application[] }
      setItems(body.items)
    } catch (err) {
      console.error('Applications.load', err instanceof ApiError ? err.problem : err)
    }
  }, [state])

  useEffect(() => { void load() }, [load])

  const decide = async (memberId: string, decision: 'approve' | 'deny') => {
    setBusy(memberId)
    try {
      await post(`/admin/onboarding/applications/${memberId}/${decision}`, decision === 'deny' ? { reason: reason.trim() } : undefined)
      setDenying(null)
      setReason('')
    } catch (err) {
      // A 409 means it was already decided — by a colleague, or a double
      // click. Reloading shows the decision that stands.
      console.error(`Applications.${decision}`, err instanceof ApiError ? err.problem : err)
    } finally {
      setBusy(null)
      await load()
    }
  }

  const gender = (value: string | null) =>
    value ? (t.onboarding.genders as Record<string, string>)[value] ?? value : '—'
  const country = (code: string | null) => {
    const found = countryByCode(code)
    return found ? found[locale] : code ?? '—'
  }

  return (
    <Card title={copy.title}>
      <div role="tablist" className="flex flex-wrap gap-2">
        {APPLICATION_STATES.map((s) => (
          <Button
            key={s}
            role="tab"
            aria-selected={s === state}
            variant={s === state ? 'primary' : 'secondary'}
            onClick={() => setState(s)}
          >
            {copy.states[s]}
          </Button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-[13px] text-text-muted">{copy.empty}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {items.map((a) => (
            <li key={a.memberId} className="rounded-card border border-hairline p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px] font-semibold text-text">{a.fullName ?? a.email}</p>
                <StatusPill tone={TONE[a.state]}>{copy.states[a.state]}</StatusPill>
              </div>
              <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
                <dt className="text-text-muted">{copy.email}</dt><dd className="break-all">{a.email}</dd>
                <dt className="text-text-muted">{copy.mobile}</dt><dd>{a.mobile ?? '—'}</dd>
                <dt className="text-text-muted">{copy.birthday}</dt><dd>{a.birthday ? formatDate(a.birthday, locale) : '—'}</dd>
                <dt className="text-text-muted">{copy.gender}</dt><dd>{gender(a.gender)}</dd>
                <dt className="text-text-muted">{copy.country}</dt><dd>{country(a.countryOfResidence)}</dd>
                <dt className="text-text-muted">{copy.face}</dt><dd>{a.deviceId ? copy.faceApp : copy.faceWeb}</dd>
                {a.denialReason && <><dt className="text-text-muted">{copy.denialReason}</dt><dd>{a.denialReason}</dd></>}
              </dl>
              <p className="mt-2 text-[12px] text-text-muted">
                {a.submittedAt && fill(copy.submittedOn, { date: formatDateTime(a.submittedAt, locale) })}
                {a.reviewedAt && <> · {fill(copy.reviewedOn, { date: formatDateTime(a.reviewedAt, locale) })}</>}
              </p>

              {canDecide && a.state === 'pending' && (
                denying === a.memberId ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <Field label={copy.denyReason} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                    <div className="flex gap-2">
                      <Button disabled={reason.trim().length < 3 || busy === a.memberId} onClick={() => void decide(a.memberId, 'deny')}>
                        {copy.confirmDeny}
                      </Button>
                      <Button variant="quiet" onClick={() => { setDenying(null); setReason('') }}>{copy.cancel}</Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <Button disabled={busy === a.memberId} onClick={() => void decide(a.memberId, 'approve')}>{copy.approve}</Button>
                    <Button variant="secondary" disabled={busy === a.memberId} onClick={() => { setDenying(a.memberId); setReason('') }}>{copy.deny}</Button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default Applications

import { useEffect, useRef, useState } from 'react'
import type { OrganisationProfile } from '@gwc/contracts/profile'
import { get, patch, post, ApiError } from '../lib/api'
import { describeProblem } from '../lib/problems'
import { fill } from '../lib/format'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Field, { FormMessage } from '../components/ui/Field'
import Callout from '../components/ui/Callout'
import { useLocale, useTranslations } from '../i18n/index'
import { OrganisationCard } from '../member/profile/OrganisationView'

/**
 * A merchant's or partner's profile (US3, FR-014): the signed-in person, and
 * the organisation's public face — what members see.
 *
 * `canEdit` (owner or manager) decides whether the form is SHOWN. The server
 * decides whether it is allowed, and answers a `staff`-role edit with 404,
 * which lands here as "not permitted" rather than as a missing page.
 */
export function OrganisationProfilePage({ kind }: { kind: 'merchant' | 'partner' }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [profile, setProfile] = useState<OrganisationProfile | null>(null)
  const [form, setForm] = useState({ displayName: '', about: '', website: '', city: '' })
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null)

  const adopt = (p: OrganisationProfile) => {
    setProfile(p)
    setForm({
      displayName: p.publicProfile?.displayName ?? '',
      about: p.publicProfile?.about ?? '',
      website: p.publicProfile?.website ?? '',
      city: p.publicProfile?.city ?? '',
    })
  }
  useEffect(() => { void get(`/profile/${kind}`).then((p) => adopt(p as OrganisationProfile)) }, [kind])

  const save = async (changes: Record<string, unknown>) => {
    setBusy(true)
    setMessage(null)
    try {
      adopt((await patch(`/profile/${kind}/public`, changes)) as OrganisationProfile)
      setMessage({ tone: 'success', text: t.organisationProfile.saved })
    } catch (err) {
      const text = err instanceof ApiError && err.status === 404
        ? t.organisationProfile.notPermitted
        : err instanceof ApiError ? describeProblem(err.problem, locale).title : t.memberThreads.loadFailed
      setMessage({ tone: 'danger', text })
    } finally {
      setBusy(false)
    }
  }

  const uploadLogo = async (file: File | undefined) => {
    if (!file || !profile) return
    const form = new FormData()
    form.append('alt', fill(t.organisationProfile.logoAlt, { name: profile.publicProfile?.displayName ?? profile.organisation.name }))
    form.append('file', file)
    try {
      const asset = (await post(`/media/${kind}`, form)) as { id: string }
      await save({ logoAssetId: asset.id })
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof ApiError ? describeProblem(err.problem, locale).title : t.memberThreads.mediaFailed })
    }
  }

  if (!profile) return null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.organisationProfile.title} subtitle={t.organisationProfile.intro} />
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}

      <Card title={t.organisationProfile.account}>
        <p className="text-[14px] text-text">{profile.displayName ?? profile.email}</p>
        <p className="text-[13px] text-text-muted">
          {profile.organisation.name} · {t.organisationPortal.roles[profile.role as 'owner' | 'manager' | 'staff'] ?? profile.role}
        </p>
      </Card>

      {profile.publicProfile ? <OrganisationCard org={profile.publicProfile} /> : <p className="text-[13px] text-text-muted">{t.organisationProfile.empty}</p>}

      {profile.canEdit ? (
        <Card title={t.organisationProfile.title}>
          <Field label={t.organisationProfile.displayName} value={form.displayName} maxLength={120}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.organisationProfile.about}
            <textarea value={form.about} maxLength={1000} rows={4} onChange={(e) => setForm({ ...form, about: e.target.value })}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text" />
          </label>
          <Field label={t.organisationProfile.website} type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          <Field label={t.organisationProfile.city} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !form.displayName.trim()} onClick={() => save({
              displayName: form.displayName.trim(),
              about: form.about.trim() || null,
              website: form.website.trim() || null,
              city: form.city.trim() || null,
            })}>{t.organisationProfile.save}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => logoInput.current?.click()}>{t.organisationProfile.logoChange}</Button>
            <input ref={logoInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" tabIndex={-1}
              aria-label={t.organisationProfile.logoChange} onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        </Card>
      ) : (
        <Callout variant="neutral" title={t.organisationProfile.readOnly}>{null}</Callout>
      )}
    </div>
  )
}

export default OrganisationProfilePage

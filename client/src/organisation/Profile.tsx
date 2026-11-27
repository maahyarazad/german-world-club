import { useEffect, useRef, useState } from 'react'
import type { OrganisationProfile } from '@gwc/contracts/profile'
import { get, patch, ApiError } from '../lib/api'
import { useMediaUpload } from '../lib/use-media-upload'
import { checkMerchantFile } from '../lib/media-limits'
import { fill } from '../lib/format'
import { useReveal } from '../lib/useReveal'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Field, { FormMessage } from '../components/ui/Field'
import Callout from '../components/ui/Callout'
import { useTranslations } from '../i18n/index'
import { OrganisationCard } from '../member/profile/OrganisationView'
import PageLoader from '../components/ui/PageLoader'
import UploadProgress from '../components/ui/UploadProgress'

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
  const [profile, setProfile] = useState<OrganisationProfile | null>(null)
  const [form, setForm] = useState({ displayName: '', about: '', website: '', city: '' })
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  // A save is pressed far below this message: bring it into view (feature 041). Above the
  // loader's early return, like every hook.
  const messageRef = useReveal<HTMLDivElement>(message)
  const [busy, setBusy] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null)
  // Feature 035: the logo shows progress while it goes up and while the server works.
  const logoUpload = useMediaUpload(kind)

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
      console.error('OrganisationProfile.save', err instanceof ApiError ? err.problem : err)
    } finally {
      setBusy(false)
    }
  }

  const uploadLogo = async (file: File | undefined) => {
    if (!file || !profile) return
    // A merchant's uploads are held to the smaller limits (under 1 MB for a
    // photo); a partner's keep the platform's. Said before sending, not after.
    if (kind === 'merchant') {
      const check = checkMerchantFile(file)
      if (check !== 'ok') {
        setMessage({ tone: 'danger', text: check === 'unsupported' ? t.merchantStore.limits.unsupported : t.merchantStore.limits.imageTooLarge })
        return
      }
    }
    setMessage(null)
    // The saved logo is touched only once the new one is ready: a failed or
    // cancelled upload leaves the previous one exactly as it was.
    const asset = await logoUpload.start(file, fill(t.organisationProfile.logoAlt, { name: profile.publicProfile?.displayName ?? profile.organisation.name }))
    if (asset) await save({ logoAssetId: asset.id })
  }

  if (!profile) return <PageLoader />

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.organisationProfile.title} subtitle={t.organisationProfile.intro} />
      {message && <FormMessage ref={messageRef} tone={message.tone}>{message.text}</FormMessage>}

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
            <Button loading={busy} disabled={!form.displayName.trim()} onClick={() => save({
              displayName: form.displayName.trim(),
              about: form.about.trim() || null,
              website: form.website.trim() || null,
              city: form.city.trim() || null,
            })}>{t.organisationProfile.save}</Button>
            <Button variant="secondary" disabled={busy || logoUpload.state.phase === 'uploading' || logoUpload.state.phase === 'processing'} onClick={() => logoInput.current?.click()}>{t.organisationProfile.logoChange}</Button>
            <input ref={logoInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" tabIndex={-1}
              aria-label={t.organisationProfile.logoChange} onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          <UploadProgress state={logoUpload.state} label={t.organisationProfile.logo} onCancel={logoUpload.cancel} />
        </Card>
      ) : (
        <Callout variant="neutral" title={t.organisationProfile.readOnly}>{null}</Callout>
      )}
    </div>
  )
}

export default OrganisationProfilePage

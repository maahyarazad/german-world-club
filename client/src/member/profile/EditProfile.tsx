import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { PROFILE_BIO_MAX, PROFILE_LINKS_MAX } from '@gwc/contracts/profile'
import type { MemberProfile, ProfileLink } from '@gwc/contracts/profile'
import { MEDIA_MAX_BYTES } from '@gwc/contracts/media'
import { get, patch, put, upload, ApiError } from '../../lib/api'
import type { UploadProgress } from '../../lib/api'
import { fill, formatDate, formatPercent } from '../../lib/format'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Field, { FormMessage } from '../../components/ui/Field'
import Card from '../../components/ui/Card'
import { useLocale, useTranslations } from '../../i18n/index'
import Avatar from '../threads/Avatar'
import HandleDialog from './HandleDialog'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']

/**
 * Editing your own profile (US3): bio, city, avatar, links and handle.
 *
 * Not the name — §3.2 routes a name change through a request staff approve —
 * and not the verified email or mobile. Each part saves on its own, because
 * each is its own server call with its own refusal.
 */
export function EditProfile() {
  const t = useTranslations()
  const { locale } = useLocale()
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [bio, setBio] = useState('')
  const [city, setCity] = useState('')
  const [links, setLinks] = useState<ProfileLink[]>([])
  const [handleOpen, setHandleOpen] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // Where a profile picture upload has got to; null when none is running
  // (feature 021, Story 6).
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const avatarInput = useRef<HTMLInputElement>(null)

  const adopt = (p: MemberProfile) => {
    setProfile(p); setBio(p.bio ?? ''); setCity(p.city ?? ''); setLinks(p.links)
  }
  useEffect(() => { void get('/profile/me').then((p) => adopt(p as MemberProfile)) }, [])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setMessage(null)
    try {
      adopt((await fn()) as MemberProfile)
      setMessage({ tone: 'success', text: t.memberProfile.saved })
    } catch (err) {
      console.error('EditProfile.run', err instanceof ApiError ? err.problem : err)
    } finally {
      setBusy(false)
    }
  }

  const uploadAvatar = (file: File | undefined) => {
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type) || file.size > MEDIA_MAX_BYTES) {
      setMessage({ tone: 'danger', text: t.memberThreads.mediaUnsupported })
      return
    }
    void (async () => {
      setBusy(true)
      setMessage(null)
      setProgress({ phase: 'uploading', fraction: 0 })
      try {
        const form = new FormData()
        // `alt` before `file`: the server reads the fields that precede the file part.
        form.append('alt', fill(t.memberProfile.avatarAlt, { name: profile?.displayName ?? '' }))
        form.append('file', file)
        // upload(), not post(): it reports the share the server has received,
        // then that the server is processing the picture.
        const asset = (await upload('/media', form, { onProgress: setProgress })) as { id: string }
        adopt((await put('/profile/me/avatar', { assetId: asset.id })) as MemberProfile)
        setMessage({ tone: 'success', text: t.memberProfile.saved })
      } catch (err) {
        console.error('EditProfile.uploadAvatar', err instanceof ApiError ? err.problem : err)
      } finally {
        setProgress(null)
        setBusy(false)
      }
    })()
  }

  const uploadingFraction = progress?.phase === 'uploading' ? progress.fraction : null

  if (!profile) return null

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader title={t.memberProfile.editTitle} actions={<Link to="/konsole/mitglied/profil" className="text-[13px] text-navy">← {t.memberThreads.back}</Link>} />
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}

      <Card title={t.memberProfile.avatar}>
        <div className="flex items-center gap-4">
          <Avatar author={profile} size={72} alt={fill(t.memberProfile.avatarAlt, { name: profile.displayName ?? '' })} />
          <Button variant="secondary" disabled={busy} onClick={() => avatarInput.current?.click()}>{t.memberProfile.avatarChange}</Button>
          {profile.avatar && <Button variant="quiet" disabled={busy} onClick={() => run(() => put('/profile/me/avatar', { assetId: null }))}>{t.memberProfile.avatarRemove}</Button>}
          <input ref={avatarInput} type="file" accept={IMAGE_TYPES.join(',')} className="sr-only" tabIndex={-1}
            aria-label={t.memberProfile.avatarChange} onChange={(e) => { uploadAvatar(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        {/* A native <progress>: accessible by itself, and no inline width
            style for the CSP to refuse. With a value while the share is
            known, without one (indeterminate) while the server processes. */}
        <div aria-live="polite" className="mt-3">
          {progress && (
            <div className="flex flex-col gap-1.5">
              <progress
                max={1}
                {...(uploadingFraction !== null ? { value: uploadingFraction } : {})}
                aria-label={t.memberProfile.avatar}
                className="h-2 w-full accent-navy"
              />
              <span className="text-[12px] text-text-muted">
                {progress.phase === 'processing'
                  ? t.memberProfile.avatarProcessing
                  : fill(t.memberProfile.avatarUploading, { percent: formatPercent(uploadingFraction ?? 0, locale) })}
              </span>
            </div>
          )}
        </div>
      </Card>

      <Card title={t.memberProfile.handle}>
        <p className="text-[14px] text-text">{profile.handle ? `@${profile.handle}` : t.memberProfile.noHandle}</p>
        {profile.handleChangeableAt && (
          <p className="text-[12px] text-text-muted">{fill(t.memberProfile.handleNextChange, { date: formatDate(profile.handleChangeableAt, locale) })}</p>
        )}
        <Button className="mt-2" variant="secondary" disabled={busy || Boolean(profile.handleChangeableAt)} onClick={() => setHandleOpen(true)}>
          {t.memberProfile.handleChange}
        </Button>
      </Card>

      <Card title={t.memberProfile.title}>
        <p className="text-[12px] text-text-muted">{t.memberProfile.displayNameHint}</p>
        <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
          {t.memberProfile.bio}
          <textarea value={bio} maxLength={PROFILE_BIO_MAX} rows={3} onChange={(e) => setBio(e.target.value)}
            className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text" />
        </label>
        <Field label={t.memberProfile.city} value={city} maxLength={120} onChange={(e) => setCity(e.target.value)} />
        <Button disabled={busy} onClick={() => run(() => patch('/profile/me', { bio: bio.trim() || null, city: city.trim() || null }))}>
          {t.memberProfile.save}
        </Button>
      </Card>

      <Card title={t.memberProfile.links}>
        {links.map((link, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <Field label={t.memberProfile.linkUrl} value={link.url} type="url"
              onChange={(e) => setLinks(links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))} />
            <Field label={t.memberProfile.linkLabel} value={link.label ?? ''}
              onChange={(e) => setLinks(links.map((l, j) => (j === i ? { ...l, label: e.target.value || null } : l)))} />
            <Button variant="quiet" onClick={() => setLinks(links.filter((_, j) => j !== i))}>{t.memberProfile.removeLink}</Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button variant="secondary" disabled={links.length >= PROFILE_LINKS_MAX} onClick={() => setLinks([...links, { url: 'https://', label: null }])}>
            {t.memberProfile.addLink}
          </Button>
          <Button disabled={busy} onClick={() => run(() => put('/profile/me/links', { links }))}>{t.memberProfile.save}</Button>
        </div>
      </Card>

      <HandleDialog open={handleOpen} current={profile.handle} onClose={() => setHandleOpen(false)}
        onSaved={(p) => { setHandleOpen(false); adopt(p) }} />
    </div>
  )
}

export default EditProfile

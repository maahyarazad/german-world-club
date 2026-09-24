import { useEffect, useState } from 'react'
import { HANDLE_PATTERN, RESERVED_HANDLES, normaliseHandle } from '@gwc/contracts/profile'
import type { MemberProfile } from '@gwc/contracts/profile'
import { get, put, ApiError } from '../../lib/api'
import { describeProblem } from '../../lib/problems'
import Button from '../../components/ui/Button'
import Field from '../../components/ui/Field'
import Modal from '../threads/Modal'
import { useLocale, useTranslations } from '../../i18n/index'

/**
 * Choosing or changing the @handle (US1/US3, FR-011).
 *
 * The pattern and the reserved list are imported from the shared contract for
 * the inline hint only; availability is the server's answer, and so is the
 * save — which may still refuse a handle this form thought free, because two
 * members can race for it and the unique constraint decides.
 */
export function HandleDialog({ open, current, onClose, onSaved }: {
  open: boolean
  current: string | null
  onClose: () => void
  onSaved: (profile: MemberProfile) => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [value, setValue] = useState(current ?? '')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handle = normaliseHandle(value)
  const wellFormed = HANDLE_PATTERN.test(handle) && !(RESERVED_HANDLES as readonly string[]).includes(handle)

  useEffect(() => {
    setAvailable(null)
    if (!wellFormed || handle === current) return
    // Debounced: one request per pause in typing, not one per key.
    const timer = setTimeout(() => {
      void get(`/profile/handles/${encodeURIComponent(handle)}/available`)
        .then((body) => setAvailable(Boolean((body as { available: boolean }).available)))
        .catch(() => setAvailable(null))
    }, 350)
    return () => clearTimeout(timer)
  }, [handle, wellFormed, current])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      onSaved((await put('/profile/me/handle', { handle })) as MemberProfile)
    } catch (err) {
      setError(err instanceof ApiError ? describeProblem(err.problem, locale).title : t.memberThreads.loadFailed)
    } finally {
      setBusy(false)
    }
  }

  const hint = !value ? t.memberProfile.handleHint
    : !wellFormed ? t.memberProfile.handleHint
      : available === false ? t.memberProfile.handleTaken
        : available ? t.memberProfile.handleAvailable : undefined

  return (
    <Modal title={t.memberProfile.handleTitle} open={open} onClose={onClose}>
      <p className="text-[13px] text-text-muted">{t.memberProfile.handleIntro}</p>
      <Field
        label={t.memberProfile.handle}
        value={value}
        autoFocus
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        hint={hint}
        error={error ?? undefined}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t.memberThreads.cancel}</Button>
        <Button disabled={busy || !wellFormed || available === false} onClick={save}>{t.memberProfile.handleSave}</Button>
      </div>
    </Modal>
  )
}

export default HandleDialog

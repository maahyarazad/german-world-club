import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import type { ResendOtpResponse } from '@gwc/contracts/auth'

import { post, ApiError } from '../lib/api'
import { useCapabilities } from '../lib/capabilities'
import { fill } from '../lib/format'
import AuthCard from '../auth/AuthCard'
import Button from '../components/ui/Button'
import Field, { FormMessage } from '../components/ui/Field'
import { useTranslations } from '../i18n/index'

/**
 * Onboarding step 3 (§6.1): prove the mobile number.
 *
 * Success opens a session — as httpOnly cookies, because this request carries
 * no `deviceId` — and from then on the application screen takes over. The
 * page never sees a token.
 */
export function VerifyMobile() {
  const copy = useTranslations().onboarding
  const navigate = useNavigate()
  const { refresh } = useCapabilities()
  const location = useLocation()
  const initial = (location.state ?? null) as { challengeId?: string; sentTo?: string } | null

  // A resend mints a new challenge; the code that arrives next belongs to it.
  const [challengeId, setChallengeId] = useState(initial?.challengeId ?? null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * Router state does not survive a reload, and the challenge id is kept out
   * of the URL on purpose. The way back is registering again: with the same
   * email and password, the server resumes the application rather than
   * refusing the address.
   */
  if (!challengeId) {
    return (
      <AuthCard title={copy.missingChallengeTitle}>
        <p className="mt-2 text-[13px] text-text-muted">{copy.missingChallengeBody}</p>
        <Button className="mt-6 w-full" onClick={() => navigate('/konsole/registrieren', { replace: true })}>
          {copy.restart}
        </Button>
      </AuthCard>
    )
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!/^\d{4}$/.test(code)) {
      setCodeError(fill(copy.errors.code, { length: 4 }))
      return
    }
    setBusy(true)
    setCodeError(null)
    try {
      await post('/onboarding/verify-mobile', { challengeId, code })
      // The cookie session exists now. The capability layer reports the
      // applicant, and the application screen shows the next step.
      await refresh()
      navigate('/konsole/bewerbung', { replace: true })
    } catch (error) {
      console.error('VerifyMobile.submit', error instanceof ApiError ? error.problem : error)
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setNotice(null)
    try {
      const resent = (await post('/auth/otp/resend', { challengeId })) as ResendOtpResponse
      setChallengeId(resent.challengeId)
      setNotice(copy.resent)
    } catch (error) {
      console.error('VerifyMobile.resend', error instanceof ApiError ? error.problem : error)
    }
  }


  return (
    <AuthCard title={copy.mobileTitle} subtitle={fill(copy.stepOf, { step: 3 })}>
      <p className="mt-2 text-[13px] text-text-muted">{fill(copy.mobileSubtitle, { target: initial?.sentTo ?? '' })}</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field
          label={copy.code}
          name="one-time-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={4}
          value={code}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
          error={codeError}
          autoFocus
        />
        {notice && <FormMessage tone="info">{notice}</FormMessage>}
        <Button type="submit" disabled={busy}>{busy ? copy.verifying : copy.verify}</Button>
        <Button variant="quiet" onClick={resend}>{copy.resend}</Button>
      </form>
    </AuthCard>
  )
}

export default VerifyMobile

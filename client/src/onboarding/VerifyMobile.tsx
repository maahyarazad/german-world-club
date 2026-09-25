import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { PROBLEMS } from '@gwc/contracts/errors'
import type { ResendOtpResponse } from '@gwc/contracts/auth'
import { registerRequestSchema } from '@gwc/contracts/onboarding'
import type { RegisterResponse } from '@gwc/contracts/onboarding'

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
 *
 * A mistyped email or number is corrected here, not by starting over:
 * `POST /onboarding/contact` changes the same application and texts a new
 * code. A value another member already has is shown on its field — the one
 * refusal this screen displays, because the applicant must choose another.
 */
const fields = registerRequestSchema.shape
export function VerifyMobile() {
  const copy = useTranslations().onboarding
  const navigate = useNavigate()
  const { refresh } = useCapabilities()
  const location = useLocation()
  const initial = (location.state ?? null) as
    { challengeId?: string; sentTo?: string; email?: string; mobile?: string } | null

  // A resend mints a new challenge; the code that arrives next belongs to it.
  const [challengeId, setChallengeId] = useState(initial?.challengeId ?? null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState(initial?.sentTo ?? '')
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState(initial?.email ?? '')
  const [mobile, setMobile] = useState(initial?.mobile ?? '')
  const [contactErrors, setContactErrors] = useState<{ email?: string; mobile?: string }>({})

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


  const changeContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextEmail = email.trim().toLowerCase()
    const nextMobile = mobile.replace(/[\s\-()]/g, '')
    const found: { email?: string; mobile?: string } = {}
    if (!fields.email.safeParse(nextEmail).success) found.email = copy.errors.email
    if (!fields.mobile.safeParse(nextMobile).success) found.mobile = copy.errors.mobile
    setContactErrors(found)
    if (Object.keys(found).length > 0) return

    setBusy(true)
    setNotice(null)
    try {
      const sent = (await post('/onboarding/contact', {
        challengeId,
        ...(nextEmail !== initial?.email ? { email: nextEmail } : {}),
        ...(nextMobile !== initial?.mobile ? { mobile: nextMobile } : {}),
      })) as RegisterResponse
      // The old code is spent; the next one belongs to the new challenge.
      setChallengeId(sent.challengeId)
      setSentTo(sent.sentTo)
      setCode('')
      setEditing(false)
      setNotice(fill(copy.detailsChanged, { target: sent.sentTo }))
    } catch (error) {
      console.error('VerifyMobile.changeContact', error instanceof ApiError ? error.problem : error)
      const type = error instanceof ApiError ? error.problem?.type : null
      if (type === PROBLEMS.EMAIL_IN_USE.type) setContactErrors({ email: copy.emailInUse })
      if (type === PROBLEMS.MOBILE_IN_USE.type) setContactErrors({ mobile: copy.mobileInUse })
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <AuthCard title={copy.mobileTitle} subtitle={fill(copy.stepOf, { step: 3 })}>
        <form onSubmit={changeContact} className="mt-6 flex flex-col gap-4" noValidate>
          <Field
            label={copy.email}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
            error={contactErrors.email}
          />
          <Field
            label={copy.mobile}
            type="tel"
            autoComplete="tel"
            hint={copy.mobileHint}
            value={mobile}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setMobile(event.target.value)}
            error={contactErrors.mobile}
          />
          <Button type="submit" disabled={busy}>{copy.changeDetailsSave}</Button>
          <Button variant="quiet" onClick={() => { setEditing(false); setContactErrors({}) }}>{copy.changeDetailsCancel}</Button>
        </form>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={copy.mobileTitle} subtitle={fill(copy.stepOf, { step: 3 })}>
      <p className="mt-2 text-[13px] text-text-muted">{fill(copy.mobileSubtitle, { target: sentTo })}</p>
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
        <Button variant="quiet" onClick={() => setEditing(true)}>{copy.changeDetails}</Button>
      </form>
    </AuthCard>
  )
}

export default VerifyMobile

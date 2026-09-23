import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router'

import { EMAIL_CODE_LENGTH } from '@gwc/contracts/onboarding'
import type { EmailCodeSent, OnboardingStatus } from '@gwc/contracts/onboarding'
import type { ProblemResponse } from '@gwc/contracts/errors'

import { get, post, ApiError } from '../lib/api'
import { useCapabilities, homeFor } from '../lib/capabilities'
import { describeProblem } from '../lib/problems'
import { fill } from '../lib/format'
import AuthCard from '../auth/AuthCard'
import Button from '../components/ui/Button'
import Field, { FormMessage } from '../components/ui/Field'
import { useLocale, useTranslations } from '../i18n/index'

/**
 * An applicant with a session: steps 4 and 5 of §6.1.
 *
 * Which step shows is the server's answer from /onboarding/status, read on
 * arrival and after every action — never inferred from which refusal brought
 * the applicant here. Approval moves them into the console; denial shows the
 * reason staff gave.
 */
export function Application() {
  const t = useTranslations()
  const copy = t.onboarding
  const { locale } = useLocale()
  const navigate = useNavigate()
  const { refresh, clear } = useCapabilities()
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [problem, setProblem] = useState<ProblemResponse | null>(null)
  const [busy, setBusy] = useState(false)

  /** Approved: fetch the real capability snapshot and go where it says. */
  const enter = useCallback(async () => {
    const snapshot = await refresh()
    navigate(homeFor(snapshot?.kind), { replace: true })
  }, [refresh, navigate])

  const load = useCallback(async () => {
    setProblem(null)
    try {
      const next = (await get('/onboarding/status')) as OnboardingStatus
      setStatus(next)
      if (next.step === 'approved') await enter()
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.needsSignIn) {
        clear()
        navigate('/konsole/anmelden', { replace: true })
        return
      }
      setProblem(error.problem)
    }
  }, [enter, clear, navigate])

  useEffect(() => { void load() }, [load])

  const signOut = async () => {
    try {
      await post('/auth/sign-out')
    } finally {
      // Whatever the server said: nothing of this session stays in memory.
      clear()
      navigate('/konsole/anmelden', { replace: true })
    }
  }

  const check = async () => {
    setBusy(true)
    await load()
    setBusy(false)
  }

  const described = problem ? describeProblem(problem, locale) : null
  const signOutButton = <Button variant="quiet" onClick={signOut}>{copy.signOut}</Button>

  if (!status) {
    return (
      <AuthCard title={copy.waitingTitle}>
        {described
          ? <div className="mt-4"><FormMessage title={described.title}>{described.body}</FormMessage></div>
          : <p className="mt-2 text-[13px] text-text-muted">{t.console.loading}</p>}
      </AuthCard>
    )
  }

  if (status.step === 'verify_email') {
    return <VerifyEmail onVerified={setStatus} signOutButton={signOutButton} />
  }

  if (status.step === 'denied') {
    return (
      <AuthCard title={copy.deniedTitle}>
        <p className="mt-2 text-[13px] text-text-muted">{copy.deniedBody}</p>
        {status.denialReason && (
          <div className="mt-4">
            <FormMessage tone="gold" title={copy.reason}>
              {/* Staff wrote this for the applicant; it is shown as written. */}
              {status.denialReason}
            </FormMessage>
          </div>
        )}
        <div className="mt-6 flex flex-col gap-2">{signOutButton}</div>
      </AuthCard>
    )
  }

  // awaiting_approval — and verify_mobile, which a session cannot be in (the
  // session is issued by verifying the mobile number) but is not worth a
  // screen of its own if the server ever says so.
  return (
    <AuthCard title={copy.waitingTitle}>
      <p className="mt-2 text-[13px] text-text-muted">{copy.waitingBody}</p>
      {described && <div className="mt-4"><FormMessage title={described.title}>{described.body}</FormMessage></div>}
      {/* No polling: approval is a human decision that takes hours, and the
          applicant is emailed when it happens. */}
      <div className="mt-6 flex flex-col gap-2">
        <Button onClick={check} disabled={busy}>{copy.check}</Button>
        {signOutButton}
      </div>
    </AuthCard>
  )
}

/** Step 4: the six-digit code mailed to the address given at registration. */
function VerifyEmail({
  onVerified, signOutButton,
}: { onVerified: (status: OnboardingStatus) => void; signOutButton: ReactNode }) {
  const copy = useTranslations().onboarding
  const { locale } = useLocale()
  const [sent, setSent] = useState<EmailCodeSent | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [problem, setProblem] = useState<ProblemResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const sentOnce = useRef(false)

  const send = useCallback(async () => {
    setProblem(null)
    try {
      setSent((await post('/onboarding/email/send')) as EmailCodeSent)
    } catch (error) {
      if (error instanceof ApiError) setProblem(error.problem)
      else throw error
    }
  }, [])

  // Once on arrival, not on every render (StrictMode mounts effects twice in
  // development). Each send is rate-limited and a fresh set of guesses, so it
  // should happen when asked for — here, and on the resend button.
  useEffect(() => {
    if (sentOnce.current) return
    sentOnce.current = true
    void send()
  }, [send])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!sent) return
    if (code.length !== EMAIL_CODE_LENGTH) {
      setCodeError(fill(copy.errors.code, { length: EMAIL_CODE_LENGTH }))
      return
    }
    setBusy(true)
    setCodeError(null)
    setProblem(null)
    try {
      onVerified((await post('/onboarding/email/verify', { challengeId: sent.challengeId, code })) as OnboardingStatus)
    } catch (error) {
      if (error instanceof ApiError) setProblem(error.problem)
      else throw error
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const described = problem ? describeProblem(problem, locale) : null

  return (
    <AuthCard title={copy.emailTitle} subtitle={fill(copy.stepOf, { step: 4 })}>
      <p className="mt-2 text-[13px] text-text-muted">
        {sent ? fill(copy.emailSubtitle, { target: sent.sentTo }) : copy.emailSending}
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field
          label={copy.code}
          name="one-time-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={EMAIL_CODE_LENGTH}
          value={code}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setCode(event.target.value.replace(/\D/g, '').slice(0, EMAIL_CODE_LENGTH))}
          error={codeError}
          autoFocus
        />
        {described && <FormMessage title={described.title}>{described.body}</FormMessage>}
        <Button type="submit" disabled={busy || !sent}>{busy ? copy.verifying : copy.verify}</Button>
        <Button variant="quiet" onClick={send}>{copy.resend}</Button>
        {signOutButton}
      </form>
    </AuthCard>
  )
}

export default Application

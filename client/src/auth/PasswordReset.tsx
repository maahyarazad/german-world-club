import type { ChangeEvent, FormEvent } from 'react'
import type { ProblemResponse } from '@gwc/contracts/errors'
import { useState } from 'react'
import { post, ApiError } from '../lib/api'
import { describeProblem } from '../lib/problems'
import Button from '../components/ui/Button'
import Field, { FormMessage } from '../components/ui/Field'
import AuthCard from './AuthCard'
import { useLocale, useTranslations } from '../i18n/index'

/** The server's floor, restated. It refuses anything shorter regardless. */
const MIN_PASSWORD_LENGTH = 8

/**
 * Password reset — request and confirm, and nothing else.
 *
 * Two screens in one component because they are two steps of one journey and
 * the second is only reachable by following a link from the first.
 *
 * ── The rule that shapes the request step ───────────────────────────────────
 * The server answers 202 whether or not an account exists, and the response
 * body is byte-identical either way. That is not a quirk to be smoothed over:
 * for an invite-only club, whether an address is a member is not a public fact.
 * So the console reports "falls ein Konto zu dieser Adresse gehört" and never
 * narrows it into an answer — no "we've sent you an email", no different
 * wording for an address that happens to be known.
 *
 * ── And the confirm step ────────────────────────────────────────────────────
 * A completed reset revokes every session on the account. That is the point of
 * one: the likely reason for a reset is that the old credential is compromised.
 * The screen says so, because a user who is silently signed out everywhere
 * otherwise reads it as a fault.
 *
 * This is emphatically not an account-creation path. A reset link for an
 * address with no account does nothing.
 */
export type PasswordResetProps = {
  token?: string | null
  /**
   * Distinguishes "no token in the link" from "not on the confirm step".
   * A truncated link (`?token=` with nothing after) must not silently render
   * the request form again.
   */
  hasTokenParam?: boolean
  onRequestNewLink?: () => void
}

export function PasswordReset({ token = null, hasTokenParam = false, onRequestNewLink }: PasswordResetProps) {
  const confirming = Boolean(token) || hasTokenParam

  return confirming ? (
    <ConfirmReset token={token} onRequestNewLink={onRequestNewLink} />
  ) : (
    <RequestReset />
  )
}

/** Step one: ask for a link. */
function RequestReset() {
  const t = useTranslations()
  const { locale } = useLocale()
  const [email, setEmail] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [problem, setProblem] = useState<ProblemResponse | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim()) {
      setFieldError(t.passwordReset.emailRequired)
      return
    }
    setFieldError(null)
    setBusy(true)
    setProblem(null)
    try {
      await post('/auth/password-reset/request', { email: email.trim() })
      setDone(true)
    } catch (error) {
      // A rate limit is the one refusal this step can produce. Everything else
      // — including an address with no account — is a 202.
      if (error instanceof ApiError) setProblem(error.problem)
      else throw error
    } finally {
      setBusy(false)
    }
  }

  const described = problem ? describeProblem(problem, locale) : null

  return (
    <AuthCard
      title={t.passwordReset.requestTitle}
      subtitle={done ? null : t.passwordReset.requestSubtitle}
      footer={
        <a href="/konsole/anmelden" className="text-navy underline underline-offset-2">
          {t.passwordReset.backToSignIn}
        </a>
      }
    >
      {done ? (
        <div className="mt-6">
          <FormMessage tone="success" title={t.passwordReset.requestDone}>
            {t.passwordReset.requestDoneHint}
          </FormMessage>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
          <Field
            label={t.signIn.email}
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
            error={fieldError}
          />

          {described && <FormMessage title={described.title}>{described.body}</FormMessage>}

          <Button type="submit" disabled={busy}>
            {t.passwordReset.requestSubmit}
          </Button>
        </form>
      )}
    </AuthCard>
  )
}

/** Step two: set the new password against the token from the link. */
type ConfirmResetProps = { token: string | null; onRequestNewLink?: () => void }

function ConfirmReset({ token, onRequestNewLink }: ConfirmResetProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; repeat?: string }>({})
  const [problem, setProblem] = useState<ProblemResponse | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  /**
   * The link arrived without a token.
   *
   * Handled explicitly rather than letting the form submit and the server
   * refuse: the user's problem is a truncated link, and "das Passwort konnte
   * nicht gespeichert werden" would send them looking for the wrong fault.
   */
  if (!token) {
    return (
      <AuthCard title={t.passwordReset.missingTokenTitle}>
        <div className="mt-6 flex flex-col gap-4">
          <FormMessage tone="info">{t.passwordReset.missingTokenBody}</FormMessage>
          <Button
            onClick={() =>
              onRequestNewLink ? onRequestNewLink() : (window.location.href = '/konsole/passwort')
            }
          >
            {t.passwordReset.requestNewLink}
          </Button>
        </div>
      </AuthCard>
    )
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const errors: { password?: string; repeat?: string } = {}
    if (password.length < MIN_PASSWORD_LENGTH) errors.password = t.passwordReset.tooShort
    else if (password !== repeat) errors.repeat = t.passwordReset.mismatch
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setBusy(true)
    setProblem(null)
    try {
      await post('/auth/password-reset/confirm', { token, password })
      setDone(true)
    } catch (error) {
      if (error instanceof ApiError) setProblem(error.problem)
      else throw error
    } finally {
      setBusy(false)
    }
  }

  const described = problem ? describeProblem(problem) : null

  return (
    <AuthCard
      title={t.passwordReset.confirmTitle}
      subtitle={done ? null : t.passwordReset.confirmSubtitle}
      footer={
        <a href="/konsole/anmelden" className="text-navy underline underline-offset-2">
          {t.passwordReset.backToSignIn}
        </a>
      }
    >
      {done ? (
        <div className="mt-6">
          <FormMessage tone="success" title={t.passwordReset.confirmDone}>
            {t.passwordReset.confirmDoneHint}
          </FormMessage>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
          <Field
            label={t.passwordReset.newPassword}
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
            error={fieldErrors.password}
            hint={t.passwordReset.tooShort}
          />

          <Field
            label={t.passwordReset.repeatPassword}
            type="password"
            name="repeat-password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setRepeat(event.target.value)}
            error={fieldErrors.repeat}
          />

          {/* An expired, consumed or unknown token lands here. The server
              cannot distinguish the three without telling an attacker which
              tokens have existed, so neither does this. */}
          {described && <FormMessage title={described.title}>{described.body}</FormMessage>}

          <Button type="submit" disabled={busy}>
            {t.passwordReset.confirmSubmit}
          </Button>
        </form>
      )}
    </AuthCard>
  )
}

export default PasswordReset

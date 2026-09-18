import type { ChangeEvent, FormEvent } from 'react'
import type { ProblemResponse } from '@gwc/contracts/errors'
import type { Snapshot } from '../lib/capabilities'
import { useState } from 'react'
import { post, ApiError } from '../lib/api'
import { useCapabilities } from '../lib/capabilities'
import { describeProblem } from '../lib/problems'
import Button from '../components/ui/Button'
import Field, { FormMessage } from '../components/ui/Field'
import AuthCard from './AuthCard'
import { useLocale, useTranslations } from '../i18n/index'

/**
 * One sign-in screen for all four principal kinds.
 *
 * The user is never asked which portal they belong to. Asking would leak which
 * kinds of account exist for a given address — the same non-enumeration rule
 * that makes an unknown address and a wrong password indistinguishable here.
 * The server answers with the principal kind and the console routes on it.
 *
 * ── The thing this screen exists to get right ───────────────────────────────
 * `POST /auth/sign-in` does not answer yes or no. It answers with one of five
 * outcomes, and FOUR of them are a 200 that carries no session:
 *
 *   authenticated            → a session exists; go to the console
 *   password_reset_required  → legacy or unusable credential; reset is the only way in
 *   profile_incomplete       → email unconfirmed; setup happens in the app
 *   approval_pending         → device awaiting staff approval
 *   otp_required             → second factor needed
 *
 * A client that treated 200 as success would, for the second of those, send the
 * user to a console that can never load — on every attempt, forever. So the
 * outcome is switched on explicitly and each one gets its own next step.
 *
 * The last two are unreachable from a browser: the server only takes those
 * branches when the request carries a `deviceId`, which is what makes it the
 * mobile face, and this screen never sends one. They are handled anyway rather
 * than falling through to a generic error — see
 * server/tests/auth/console-sign-in.test.js, which pins that behaviour so this
 * comment cannot quietly become untrue.
 *
 * There is deliberately no account-creation link. Registration is unfinished
 * and out of scope (FR-002); tests/no-registration.test.jsx is the standing
 * check that one does not reappear.
 */
export type SignInProps = {
  onSignedIn?: (snapshot: Snapshot | null) => void
  onResetPassword?: () => void
}

export function SignIn({ onSignedIn, onResetPassword }: SignInProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const { refresh } = useCapabilities()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [problem, setProblem] = useState<ProblemResponse | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    // Local checks are a courtesy, not a control: the server validates the same
    // things and refuses regardless of what happens here.
    const errors: { email?: string; password?: string } = {}
    if (!email.trim()) errors.email = t.signIn.emailRequired
    if (!password) errors.password = t.signIn.passwordRequired
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setBusy(true)
    setProblem(null)
    setOutcome(null)

    try {
      // No `deviceId`: that field is what marks a request as the mobile face,
      // and sending one would opt the browser into the device-approval and OTP
      // branches it has no way to complete.
      const result = (await post('/auth/sign-in', { email: email.trim(), password })) as
        | { outcome?: string }
        | null

      if (result?.outcome === 'authenticated') {
        // The session is already a cookie by this point. Re-fetching
        // capabilities is what turns it into a rendered console.
        const snapshot = await refresh()
        onSignedIn?.(snapshot)
        return
      }

      setOutcome(result?.outcome ?? 'unknown')
    } catch (error) {
      if (error instanceof ApiError) setProblem(error.problem)
      else throw error
    } finally {
      setBusy(false)
    }
  }

  const described = problem ? describeProblem(problem, locale) : null

  return (
    <AuthCard
      title={t.signIn.title}
      subtitle={t.signIn.subtitle}
      footer={
        <a href="/konsole/passwort" className="text-navy underline underline-offset-2">
          {t.signIn.forgotPassword}
        </a>
      }
    >
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field
          label={t.signIn.email}
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />

        <Field
          label={t.signIn.password}
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
          error={fieldErrors.password}
        />

        {/* A refusal: wrong credentials, a locked account, a rate limit. The
            server states the remedy and the console shows it rather than
            inventing one. */}
        {described && (
          <FormMessage title={described.title}>{described.body}</FormMessage>
        )}

        {outcome && <OutcomeMessage outcome={outcome} onResetPassword={onResetPassword} />}

        <Button type="submit" disabled={busy}>
          {busy ? t.signIn.submitting : t.signIn.submit}
        </Button>
      </form>
    </AuthCard>
  )
}

/**
 * A 200 that is not a session.
 *
 * Each outcome names what happened and, where one exists, the single next step
 * that can actually resolve it. `password_reset_required` is the important one:
 * it is the only outcome with a remedy inside this console, and offering it as
 * a button is the difference between a dead end and a path.
 */
type OutcomeMessageProps = { outcome: string | null; onResetPassword?: () => void }

function OutcomeMessage({ outcome, onResetPassword }: OutcomeMessageProps) {
  const copy = useTranslations().signIn.outcomes

  if (outcome === 'password_reset_required') {
    return (
      <FormMessage
        tone="gold"
        title={copy.passwordResetRequiredTitle}
        actions={
          <Button
            variant="secondary"
            onClick={() => (onResetPassword ? onResetPassword() : (window.location.href = '/konsole/passwort'))}
          >
            {copy.passwordResetRequiredAction}
          </Button>
        }
      >
        {copy.passwordResetRequiredBody}
      </FormMessage>
    )
  }

  const messages: Record<string, readonly [string, string]> = {
    profile_incomplete: [copy.profileIncompleteTitle, copy.profileIncompleteBody],
    approval_pending: [copy.approvalPendingTitle, copy.approvalPendingBody],
    otp_required: [copy.otpRequiredTitle, copy.otpRequiredBody],
  }

  const [title, body] = (outcome ? messages[outcome] : undefined) ?? [copy.unknownTitle, copy.unknownBody]
  return (
    <FormMessage tone="info" title={title}>
      {body}
    </FormMessage>
  )
}

export default SignIn

import { useState } from 'react'
import { post, ApiError } from '../lib/api.js'
import { useCapabilities } from '../lib/capabilities.jsx'
import { describeProblem } from '../lib/problems.js'
import { t } from '../i18n/de.js'
import Button from '../components/ui/Button.jsx'

/**
 * One sign-in screen for all four principal kinds.
 *
 * The user is never asked which portal they belong to. Asking would leak which
 * kinds of account exist for a given address — the same non-enumeration rule
 * that makes an unknown address and a wrong password indistinguishable here.
 * The server answers with the principal kind and the console routes on it.
 *
 * There is deliberately no "Konto erstellen" link. Registration is unfinished
 * and out of scope (FR-002); tests/no-registration.test.jsx is the standing
 * check that one does not reappear.
 */
export function SignIn({ onSignedIn }) {
  const { refresh } = useCapabilities()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await post('/auth/sign-in', { email, password })
      const snapshot = await refresh()
      onSignedIn?.(snapshot)
    } catch (error) {
      if (error instanceof ApiError) setProblem(error.problem)
      else throw error
    } finally {
      setBusy(false)
    }
  }

  const described = problem ? describeProblem(problem) : null

  return (
    <main className="flex min-h-svh items-center justify-center bg-ground px-4 font-sans">
      <div className="w-full max-w-sm rounded-card border border-hairline bg-surface p-6">
        <img
          src="/gwc-logo.png"
          alt={t.brand.logoAlt}
          width="844"
          height="578"
          className="mb-5 h-10 w-auto"
        />
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-text">
          {t.signIn.title}
        </h1>
        <p className="mt-1 text-[13px] text-text-muted">{t.signIn.subtitle}</p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              {t.signIn.email}
            </span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              {t.signIn.password}
            </span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            />
          </label>

          {described && (
            <div role="alert" className="rounded-card bg-tint-danger px-3 py-2.5 text-[13px] text-tint-danger-fg">
              <strong className="font-semibold">{described.title}</strong>
              {described.body && <span className="block">{described.body}</span>}
            </div>
          )}

          <Button type="submit" disabled={busy}>
            {busy ? t.signIn.submitting : t.signIn.submit}
          </Button>
        </form>

        <a
          href="/konsole/passwort"
          className="mt-4 inline-block text-[13px] text-navy underline underline-offset-2"
        >
          {t.signIn.forgotPassword}
        </a>
      </div>
    </main>
  )
}

export default SignIn

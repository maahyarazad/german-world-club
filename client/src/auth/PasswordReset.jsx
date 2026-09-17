import { useState } from 'react'
import { post, ApiError } from '../lib/api.js'
import { describeProblem } from '../lib/problems.js'
import { t } from '../i18n/de.js'
import Button from '../components/ui/Button.jsx'

/**
 * Password reset — request and confirm, and nothing else.
 *
 * The request step reports the same thing whether or not an account exists.
 * The server answers 202 unconditionally for that reason, and the console must
 * not narrow it into an answer: "falls ein Konto zu dieser Adresse gehört" is
 * the whole message, and it is not a hedge.
 *
 * This is emphatically not an account-creation path. A reset link for an
 * address with no account does nothing.
 */
export function PasswordReset({ token = null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const [problem, setProblem] = useState(null)
  const [busy, setBusy] = useState(false)

  const confirming = Boolean(token)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      if (confirming) await post('/auth/password-reset/confirm', { token, password })
      else await post('/auth/password-reset/request', { email })
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
    <main className="flex min-h-svh items-center justify-center bg-ground px-4 font-sans">
      <div className="w-full max-w-sm rounded-card border border-hairline bg-surface p-6">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-text">
          {confirming ? t.passwordReset.confirmTitle : t.passwordReset.requestTitle}
        </h1>

        {done ? (
          <p className="mt-4 text-[13px] text-text-muted">
            {confirming ? t.passwordReset.confirmDone : t.passwordReset.requestDone}
          </p>
        ) : (
          <>
            {!confirming && (
              <p className="mt-1 text-[13px] text-text-muted">{t.passwordReset.requestSubtitle}</p>
            )}
            <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                  {confirming ? t.passwordReset.newPassword : t.signIn.email}
                </span>
                <input
                  type={confirming ? 'password' : 'email'}
                  autoComplete={confirming ? 'new-password' : 'username'}
                  required
                  value={confirming ? password : email}
                  onChange={(event) =>
                    confirming ? setPassword(event.target.value) : setEmail(event.target.value)
                  }
                  className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                />
              </label>

              {described && (
                <div role="alert" className="rounded-card bg-tint-danger px-3 py-2.5 text-[13px] text-tint-danger-fg">
                  <strong className="font-semibold">{described.title}</strong>
                </div>
              )}

              <Button type="submit" disabled={busy}>
                {confirming ? t.passwordReset.confirmSubmit : t.passwordReset.requestSubmit}
              </Button>
            </form>
          </>
        )}

        <a
          href="/konsole/anmelden"
          className="mt-4 inline-block text-[13px] text-navy underline underline-offset-2"
        >
          {t.passwordReset.backToSignIn}
        </a>
      </div>
    </main>
  )
}

export default PasswordReset

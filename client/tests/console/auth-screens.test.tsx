import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { PROBLEMS } from '@gwc/contracts/errors'
import SignIn from '../../src/auth/SignIn'
import PasswordReset from '../../src/auth/PasswordReset'
import { de } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'

/**
 * The sign-in and password-reset screens.
 *
 * The property most of this file exists to pin: `POST /auth/sign-in` answers
 * with one of five outcomes, and four of them are a **200 carrying no session**.
 * A screen that read 200 as success would, for `password_reset_required`, send
 * the user to a console that can never load — on every attempt, forever. Each
 * outcome therefore gets its own test, and each asserts that the console did
 * NOT treat it as a session.
 */

afterEach(() => vi.unstubAllGlobals())

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  })

/**
 * Stub sign-in with a given reply, and count capability fetches.
 *
 * Whether capabilities are fetched AFTER the submit is the observable
 * difference between "the console believed it had a session" and "it did not".
 * Note the provider also fetches once on mount, so every assertion below
 * compares against a baseline taken at submit time rather than against zero —
 * an absolute count would be measuring the mount, not the sign-in.
 */
function mockSignIn(reply) {
  const calls = { signIn: 0, session: 0 }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = String(url)
      if (path === '/auth/csrf') return json({ csrfToken: 'test-csrf-token' })
      if (path === '/auth/sign-in') {
        calls.signIn += 1
        return typeof reply === 'function' ? reply() : reply
      }
      if (path === '/auth/me' || path === '/auth/session') {
        calls.session += 1
        return json(staffSnapshot({ grants: { seo: { read: true } } }))
      }
      return new Response(null, { status: 204 })
    }),
  )
  return calls
}

const fillAndSubmit = async ({ email = 'jemand@test.invalid', password = 'passwort-lang-genug' } = {}) => {
  fireEvent.change(screen.getByLabelText(de.signIn.email), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(de.signIn.password), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: de.signIn.submit }))
}

describe('sign-in handles every outcome the server can return', () => {
  it('follows through to the console on `authenticated`', async () => {
    const calls = mockSignIn(json({ outcome: 'authenticated', expiresIn: 600 }))
    const onSignedIn = vi.fn()
    renderConsole(<SignIn onSignedIn={onSignedIn} />, { route: '/konsole/anmelden' })

    await waitFor(() => expect(calls.session).toBeGreaterThan(0))
    const sessionsBefore = calls.session

    await fillAndSubmit()
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled())
    // Capabilities were re-fetched after the submit: that is what turns a
    // cookie into a rendered console.
    expect(calls.session).toBeGreaterThan(sessionsBefore)
  })

  /**
   * The outcome this screen was rewritten for. It is a 200, it carries no
   * session, and it has a remedy the console can actually offer.
   */
  it('explains `password_reset_required` and offers the reset, without claiming a session', async () => {
    const calls = mockSignIn(json({ outcome: 'password_reset_required' }))
    const onSignedIn = vi.fn()
    const onResetPassword = vi.fn()
    renderConsole(<SignIn onSignedIn={onSignedIn} onResetPassword={onResetPassword} />, {
      route: '/konsole/anmelden',
    })

    await waitFor(() => expect(calls.signIn + calls.session).toBeGreaterThan(0))
    const sessionsBefore = calls.session

    await fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByText(de.signIn.outcomes.passwordResetRequiredTitle)).toBeInTheDocument(),
    )

    // Counter-assertion, and the whole point: the console did NOT treat the
    // 200 as success. It never navigated and never re-fetched capabilities.
    expect(onSignedIn).not.toHaveBeenCalled()
    expect(calls.session).toBe(sessionsBefore)

    // And the remedy is one click away rather than a dead end.
    fireEvent.click(screen.getByRole('button', { name: de.signIn.outcomes.passwordResetRequiredAction }))
    expect(onResetPassword).toHaveBeenCalled()
  })

  it.each([
    ['profile_incomplete', de.signIn.outcomes.profileIncompleteTitle],
    ['approval_pending', de.signIn.outcomes.approvalPendingTitle],
    ['otp_required', de.signIn.outcomes.otpRequiredTitle],
  ])('explains `%s` without claiming a session', async (outcome, title) => {
    const calls = mockSignIn(json({ outcome }))
    const onSignedIn = vi.fn()
    renderConsole(<SignIn onSignedIn={onSignedIn} />, { route: '/konsole/anmelden' })

    await waitFor(() => expect(calls.session).toBeGreaterThan(0))
    const sessionsBefore = calls.session

    await fillAndSubmit()
    await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument())
    expect(onSignedIn).not.toHaveBeenCalled()
    expect(calls.session).toBe(sessionsBefore)
  })

  /**
   * The server may add a sixth outcome. A console that fell through to a blank
   * screen would break on a deploy it had nothing to do with.
   */
  it('says something sensible for an outcome it does not recognise', async () => {
    mockSignIn(json({ outcome: 'something_new_entirely' }))
    renderConsole(<SignIn />, { route: '/konsole/anmelden' })

    await fillAndSubmit()
    await waitFor(() => expect(screen.getByText(de.signIn.outcomes.unknownTitle)).toBeInTheDocument())
  })
})

describe('sign-in surfaces refusals as refusals', () => {
  it('shows invalid credentials without saying which field was wrong', async () => {
    mockSignIn(json(PROBLEMS.INVALID_CREDENTIALS, 401))
    renderConsole(<SignIn />, { route: '/konsole/anmelden' })

    await fillAndSubmit()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    const alert = screen.getByRole('alert').textContent
    // Non-enumeration: the server does not distinguish an unknown address from
    // a wrong password, so the console must not either.
    expect(alert).not.toMatch(/E-Mail-Adresse.*unbekannt|Konto.*existiert/i)
  })

  it('shows the server remedy for a locked account and invents none', async () => {
    mockSignIn(json(PROBLEMS.ACCOUNT_LOCKED, 403))
    renderConsole(<SignIn />, { route: '/konsole/anmelden' })

    await fillAndSubmit()
    await waitFor(() => expect(screen.getByText(/Support/)).toBeInTheDocument())
  })

  it('keeps what the user typed when the attempt is refused', async () => {
    mockSignIn(json(PROBLEMS.INVALID_CREDENTIALS, 401))
    renderConsole(<SignIn />, { route: '/konsole/anmelden' })

    await fillAndSubmit({ email: 'jemand@test.invalid' })
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByLabelText(de.signIn.email)).toHaveValue('jemand@test.invalid')
  })

  it('never sends a deviceId — that field is what makes it the mobile face', async () => {
    mockSignIn(json({ outcome: 'authenticated' }))
    renderConsole(<SignIn />, { route: '/konsole/anmelden' })

    await fillAndSubmit()
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    const body = JSON.parse(fetch.mock.calls.find(([url]) => url === '/auth/sign-in')[1].body)
    // Sending one would opt the browser into the device-approval and OTP
    // branches it has no way to complete.
    expect(body).not.toHaveProperty('deviceId')
    expect(body.email).toBe('jemand@test.invalid')
  })

  it('refuses to submit an empty form and says which field is missing', async () => {
    const calls = mockSignIn(json({ outcome: 'authenticated' }))
    renderConsole(<SignIn />, { route: '/konsole/anmelden' })

    fireEvent.click(screen.getByRole('button', { name: de.signIn.submit }))
    await waitFor(() => expect(screen.getByText(de.signIn.emailRequired)).toBeInTheDocument())
    expect(screen.getByText(de.signIn.passwordRequired)).toBeInTheDocument()
    expect(calls.signIn).toBe(0)
  })
})

describe('password reset — requesting a link', () => {
  const stub = (reply) => {
    const calls = { request: 0, confirm: 0, body: null }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        const path = String(url)
        if (path === '/auth/csrf') return json({ csrfToken: 'test-csrf-token' })
        if (path === '/auth/password-reset/request') {
          calls.request += 1
          calls.body = JSON.parse(options.body)
          return reply ?? json({ requested: true }, 202)
        }
        return new Response(null, { status: 204 })
      }),
    )
    return calls
  }

  it('reports the same thing whether or not the address has an account', async () => {
    stub()
    mockCapabilityFetch(null)
    renderConsole(<PasswordReset />, { route: '/konsole/passwort' })

    fireEvent.change(screen.getByLabelText(de.signIn.email), {
      target: { value: 'jemand@test.invalid' },
    })
    fireEvent.click(screen.getByRole('button', { name: de.passwordReset.requestSubmit }))

    await waitFor(() => expect(screen.getByText(de.passwordReset.requestDone)).toBeInTheDocument())

    // The wording is conditional by design. The server answers 202 either way,
    // and a console that said "wir haben Ihnen eine E-Mail geschickt" would
    // turn a non-answer into an account-existence oracle.
    expect(de.passwordReset.requestDone).toMatch(/falls/i)
  })

  it('does not submit an empty address', async () => {
    const calls = stub()
    renderConsole(<PasswordReset />, { route: '/konsole/passwort' })

    fireEvent.click(screen.getByRole('button', { name: de.passwordReset.requestSubmit }))
    await waitFor(() => expect(screen.getByText(de.passwordReset.emailRequired)).toBeInTheDocument())
    expect(calls.request).toBe(0)
  })

  it('surfaces a rate limit as retryable', async () => {
    stub(json(PROBLEMS.RATE_LIMITED, 429))
    renderConsole(<PasswordReset />, { route: '/konsole/passwort' })

    fireEvent.change(screen.getByLabelText(de.signIn.email), { target: { value: 'a@test.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: de.passwordReset.requestSubmit }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert').textContent).toMatch(/warten/i)
  })
})

describe('password reset — setting the new password', () => {
  const stub = (reply) => {
    const calls = { confirm: 0, body: null }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        if (String(url) === '/auth/csrf') return json({ csrfToken: 'test-csrf-token' })
        if (String(url) === '/auth/password-reset/confirm') {
          calls.confirm += 1
          calls.body = JSON.parse(options.body)
          return reply ?? json({ reset: true })
        }
        return new Response(null, { status: 204 })
      }),
    )
    return calls
  }

  const TOKEN = 'a'.repeat(64)

  const fill = (password, repeat = password) => {
    fireEvent.change(screen.getByLabelText(de.passwordReset.newPassword), {
      target: { value: password },
    })
    fireEvent.change(screen.getByLabelText(de.passwordReset.repeatPassword), {
      target: { value: repeat },
    })
    fireEvent.click(screen.getByRole('button', { name: de.passwordReset.confirmSubmit }))
  }

  it('sets the password and says every session was ended', async () => {
    const calls = stub()
    renderConsole(<PasswordReset token={TOKEN} />, { route: '/konsole/passwort' })

    fill('mein-neues-passwort')
    await waitFor(() => expect(screen.getByText(de.passwordReset.confirmDone)).toBeInTheDocument())

    // Saying so matters: a reset revokes every session, and a user silently
    // signed out everywhere otherwise reads it as a fault.
    expect(screen.getByText(de.passwordReset.confirmDoneHint)).toBeInTheDocument()
    expect(calls.body).toEqual({ token: TOKEN, password: 'mein-neues-passwort' })
  })

  it('refuses a password below the server minimum without asking the server', async () => {
    const calls = stub()
    renderConsole(<PasswordReset token={TOKEN} />, { route: '/konsole/passwort' })

    fill('kurz')
    await waitFor(() => expect(screen.getAllByText(de.passwordReset.tooShort).length).toBeGreaterThan(0))
    expect(calls.confirm).toBe(0)
  })

  it('refuses two passwords that do not match', async () => {
    const calls = stub()
    renderConsole(<PasswordReset token={TOKEN} />, { route: '/konsole/passwort' })

    fill('erstes-passwort', 'zweites-passwort')
    await waitFor(() => expect(screen.getByText(de.passwordReset.mismatch)).toBeInTheDocument())
    expect(calls.confirm).toBe(0)
  })

  it('shows a refusal for a token that is expired, used or unknown', async () => {
    stub(json(PROBLEMS.INVALID_RESET_TOKEN, 401))
    renderConsole(<PasswordReset token={TOKEN} />, { route: '/konsole/passwort' })

    fill('mein-neues-passwort')
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    // The server cannot distinguish the three without telling an attacker which
    // tokens have existed, so the console does not either.
    const alert = screen.getByRole('alert').textContent
    expect(alert).not.toMatch(/abgelaufen|bereits verwendet|unbekannt/i)

    // And it must NOT send the user to sign-in. INVALID_RESET_TOKEN exists as a
    // type separate from INVALID_REFRESH_TOKEN precisely because the remedy
    // differs: a new link, not a sign-in that cannot help someone who has
    // forgotten their password.
    expect(alert).toMatch(/neuen? an/i)
  })

  /**
   * A truncated link — `?token=` with nothing after it. Without this branch the
   * request form would render again and the user would keep asking for links
   * that keep arriving broken.
   */
  it('names the real problem when the link carries no token', async () => {
    stub()
    const onRequestNewLink = vi.fn()
    renderConsole(<PasswordReset hasTokenParam onRequestNewLink={onRequestNewLink} />, {
      route: '/konsole/passwort',
    })

    await waitFor(() =>
      expect(screen.getByText(de.passwordReset.missingTokenTitle)).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: de.passwordReset.requestNewLink }))
    expect(onRequestNewLink).toHaveBeenCalled()
  })

  it('shows the request form when there is no token param at all', async () => {
    // Counter-assertion for the test above: "no token in the link" and "not on
    // the confirm step" are different states and must render differently.
    stub()
    renderConsole(<PasswordReset />, { route: '/konsole/passwort' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: de.passwordReset.requestSubmit })).toBeInTheDocument(),
    )
    expect(screen.queryByText(de.passwordReset.missingTokenTitle)).not.toBeInTheDocument()
  })
})

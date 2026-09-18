import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import SignIn from '../src/auth/SignIn'
import PasswordReset from '../src/auth/PasswordReset'
import { de } from '../src/i18n/de'
import { renderConsole, mockCapabilityFetch } from './helpers/console'

/**
 * SC-004 — registration is out of scope and must stay out.
 *
 * The instruction was explicit: the registration process is unfinished, so the
 * console must not render it. That is easy to honour on day one and easy to
 * lose on day forty, when someone adds a "Konto erstellen" link to the sign-in
 * screen because it looks incomplete without one.
 *
 * This suite is the standing check. It works two ways: over the rendered
 * screens, and over the source itself — because a route can be added without
 * any test rendering it, and the source scan catches that.
 */

afterEach(() => vi.unstubAllGlobals())

const SRC = join(process.cwd(), 'src')

/**
 * The HTML entries are scanned too.
 *
 * The landing pages are the single most likely place for a "become a member"
 * button to be added by someone who has not read FR-002 — it is exactly what a
 * marketing page normally ends with. Both languages are scanned: an English
 * page is no less tempting, and English sign-up vocabulary is the likelier
 * slip of the two.
 */
const ENTRY_HTML = ['index.html', 'en.html', 'konsole.html'].map((f) => join(process.cwd(), f))

/** German and English, because a stray English label is the likelier slip. */
const REGISTRATION_WORDS = [
  /konto\s+erstellen/i,
  /registrier/i, // registrieren, Registrierung
  /\bsign[\s-]?up\b/i,
  /\bregister\b/i,
  /jetzt\s+mitglied\s+werden/i,
  /bewerbung\s+einreichen/i,
  /warte[tn]?\s+auf\s+freigabe/i,
  /waiting\s+for\s+approval/i,
]

/** Server paths that would create or apply for an account. */
const REGISTRATION_ROUTES = [
  '/auth/register',
  '/auth/sign-up',
  '/auth/signup',
  '/auth/apply',
  '/auth/application',
  '/konsole/registrieren',
  '/konsole/bewerben',
]

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (/\.(jsx?|html)$/.test(entry)) yield full
  }
}

describe('no console screen offers a way to create an account', () => {
  it('the sign-in screen has no sign-up affordance', async () => {
    mockCapabilityFetch(null)
    renderConsole(<SignIn />, { route: '/konsole/anmelden' })

    await waitFor(() => expect(screen.getByRole('button', { name: de.signIn.submit })).toBeInTheDocument())

    // Password reset is in scope and must be reachable — a counter-assertion
    // that this suite is not simply failing to find any links at all.
    expect(screen.getByRole('link', { name: de.signIn.forgotPassword })).toBeInTheDocument()

    const links = screen.getAllByRole('link').map((link) => link.textContent ?? '')
    for (const pattern of REGISTRATION_WORDS) {
      expect(links.join(' ')).not.toMatch(pattern)
    }
  })

  it('the password-reset screen creates nothing', async () => {
    mockCapabilityFetch(null)
    renderConsole(<PasswordReset />, { route: '/konsole/passwort' })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: de.passwordReset.requestSubmit })).toBeInTheDocument(),
    )
    const text = document.body.textContent ?? ''
    for (const pattern of REGISTRATION_WORDS) {
      expect(text).not.toMatch(pattern)
    }
  })

  /**
   * The request step answers the same thing whether or not the account exists,
   * because the server returns 202 unconditionally. A console that said "wir
   * haben Ihnen eine E-Mail geschickt" would turn a non-answer into an answer
   * and hand an attacker an account-existence oracle.
   */
  it('the reset confirmation does not confirm the account exists', () => {
    expect(de.passwordReset.requestDone).toMatch(/falls/i)
  })
})

describe('no source file references a registration route or screen', () => {
  it('names no account-creation endpoint', () => {
    const offenders = []
    for (const file of [...sourceFiles(SRC), ...ENTRY_HTML]) {
      const source = readFileSync(file, 'utf8')
      for (const route of REGISTRATION_ROUTES) {
        if (source.includes(route)) offenders.push(`${file}: ${route}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the German copy module defines no registration string', () => {
    // Copy lands before the screen that uses it, so this catches the change one
    // commit earlier than the render test would.
    const copy = JSON.stringify(de)
    for (const pattern of REGISTRATION_WORDS) {
      expect(copy).not.toMatch(pattern)
    }
  })

  it.each([['index.html'], ['en.html']])('%s offers no account-creation affordance', (file) => {
    const html = readFileSync(join(process.cwd(), file), 'utf8')
    for (const pattern of REGISTRATION_WORDS) {
      expect(html, `${file} matches ${pattern}`).not.toMatch(pattern)
    }
    // Counter-assertion: it DOES offer the sign-in, so this is not passing
    // because the page is empty or the scan is looking at the wrong file.
    expect(html).toContain('/konsole/anmelden')
  })

  it('STILL finds a string that IS present — the scan is not vacuous', () => {
    // Counter-assertion. Without this, a typo in every pattern above would
    // leave a suite that passes by finding nothing, ever.
    const copy = JSON.stringify(de)
    expect(copy).toMatch(/anmelden/i)
    expect(copy).toMatch(/passwort/i)
  })
})

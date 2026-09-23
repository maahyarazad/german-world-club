import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import PasswordReset from '../src/auth/PasswordReset'
import { de } from '../src/i18n/de'
import { renderConsole, mockCapabilityFetch } from './helpers/console'

/**
 * Where an account can be created — and where it cannot.
 *
 * This file replaces `no-registration.test.tsx`, which held the line that the
 * console offers no registration at all (003's FR-002). Feature 009 moved that
 * line on purpose: registration is open, and staff approval is the gate
 * (specs/009-expo-client/spec.md). What the old suite protected is still worth
 * protecting, in its new shape:
 *
 *   - there is exactly ONE way to create an account, `POST /onboarding/register`,
 *     and one console screen that calls it;
 *   - the password-reset flow still creates nothing, and still does not
 *     confirm that an account exists.
 *
 * The flow itself — steps, routing, what is sent — is
 * tests/onboarding/web-onboarding.test.tsx.
 */

afterEach(() => vi.unstubAllGlobals())

const SRC = join(process.cwd(), 'src')

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (/\.tsx?$/.test(entry)) yield full
  }
}

/** Server paths that would create or apply for an account by some other road. */
const OTHER_ACCOUNT_ROUTES = ['/auth/register', '/auth/sign-up', '/auth/signup', '/auth/apply', '/auth/application']

describe('one way to create an account', () => {
  it('only the registration screen calls the registration endpoint', () => {
    const callers = [...sourceFiles(SRC)]
      .filter((file) => readFileSync(file, 'utf8').includes("'/onboarding/register'"))
      .map((file) => file.replace(`${SRC}/`, ''))
    expect(callers).toEqual(['onboarding/Register.tsx'])
  })

  it('names no other account-creation endpoint', () => {
    const offenders = []
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      for (const route of OTHER_ACCOUNT_ROUTES) {
        if (source.includes(route)) offenders.push(`${file}: ${route}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never sends a deviceId from the browser — that field marks the mobile face', () => {
    const offenders = [...sourceFiles(SRC)]
      .filter((file) => /\bdeviceId\s*:/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(`${SRC}/`, ''))
    expect(offenders).toEqual([])
  })
})

describe('password reset creates nothing', () => {
  const ACCOUNT_CREATION = [/konto\s+erstellen/i, /registrier/i, /mitglied\s+werden/i, /warten\s+auf\s+freigabe/i]

  it('the password-reset screen offers no way to create an account', async () => {
    mockCapabilityFetch(null)
    renderConsole(<PasswordReset />, { route: '/konsole/passwort' })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: de.passwordReset.requestSubmit })).toBeInTheDocument(),
    )
    const text = document.body.textContent ?? ''
    for (const pattern of ACCOUNT_CREATION) expect(text).not.toMatch(pattern)
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

  it('STILL finds a pattern that IS present — the scan is not vacuous', () => {
    // Counter-assertion: the registration copy exists, so a typo in the
    // patterns above cannot leave a suite that passes by finding nothing.
    const copy = JSON.stringify(de.onboarding) + JSON.stringify(de.signIn)
    expect(copy).toMatch(/mitglied\s+werden/i)
    expect(copy).toMatch(/warten\s+auf\s+freigabe/i)
  })
})

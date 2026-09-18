import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import LanguageSwitch from '../../src/components/ui/LanguageSwitch.jsx'
import SignIn from '../../src/auth/SignIn.jsx'
import { Sidebar } from '../../src/console/Sidebar.jsx'
import { ADMIN_ITEMS } from '../../src/console/admin/AdminLayout.jsx'
import { de } from '../../src/i18n/de.js'
import { en } from '../../src/i18n/en.js'
import { STORAGE_KEY } from '../../src/i18n/index.jsx'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console.jsx'

/**
 * The console's language switch.
 *
 * Every assertion is a pair: German shows German, English shows English. A
 * suite that only checked the default would pass against a console with no
 * English in it at all, which is the one failure this feature must not ship.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  try { globalThis.localStorage?.removeItem(STORAGE_KEY) } catch { /* blocked storage */ }
})

describe('the control itself', () => {
  it('offers both languages, each named in its own language', () => {
    mockCapabilityFetch(null)
    renderConsole(<LanguageSwitch />)

    // "Englisch" would not help an English speaker find their way out.
    expect(screen.getByRole('button', { name: 'Deutsch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument()
  })

  it('announces the current language rather than only showing it', () => {
    mockCapabilityFetch(null)
    renderConsole(<LanguageSwitch />, { locale: 'de' })

    expect(screen.getByRole('button', { name: 'Deutsch' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks the other one when English is active', () => {
    mockCapabilityFetch(null)
    renderConsole(<LanguageSwitch />, { locale: 'en' })

    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Deutsch' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('declares the language of each option so a screen reader pronounces it', () => {
    mockCapabilityFetch(null)
    renderConsole(<LanguageSwitch />)
    expect(screen.getByRole('button', { name: 'Deutsch' })).toHaveAttribute('lang', 'de')
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('lang', 'en')
  })

  it('uses no flag — a flag names a country, not a language', () => {
    mockCapabilityFetch(null)
    const { container } = renderConsole(<LanguageSwitch />)
    const group = container.querySelector('[role="group"]')
    expect(group.querySelectorAll('img, svg')).toHaveLength(0)
    expect(group.textContent).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u)
  })

  it('is operable by keyboard', async () => {
    mockCapabilityFetch(null)
    renderConsole(<LanguageSwitch />, { locale: 'de' })

    const english = screen.getByRole('button', { name: 'English' })
    english.focus()
    expect(english).toHaveFocus()
    // Real <button>s, so Enter and Space activate them natively — which is
    // exactly why this is a button and not a styled div.
    expect(english.tagName).toBe('BUTTON')

    fireEvent.click(english)
    await waitFor(() => expect(english).toHaveAttribute('aria-pressed', 'true'))
  })
})

describe('switching changes every string', () => {
  it('re-renders the sign-in screen in the other language, in place', async () => {
    mockCapabilityFetch(null)
    renderConsole(<SignIn />, { route: '/konsole/anmelden', locale: 'de' })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: de.signIn.submit })).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: en.signIn.submit })).toBeInTheDocument(),
    )
    // Counter-assertion: the German label is GONE, not merely joined by an
    // English one somewhere else on the page.
    expect(screen.queryByRole('button', { name: de.signIn.submit })).not.toBeInTheDocument()
    expect(screen.getByText(en.signIn.subtitle)).toBeInTheDocument()
  })

  it('preserves unsaved input across the switch', async () => {
    mockCapabilityFetch(null)
    renderConsole(<SignIn />, { route: '/konsole/anmelden', locale: 'de' })

    const email = await screen.findByLabelText(de.signIn.email)
    fireEvent.change(email, { target: { value: 'jemand@test.invalid' } })

    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    // Re-render in place, not a reload: a half-typed form must survive.
    await waitFor(() => expect(screen.getByLabelText(en.signIn.email)).toBeInTheDocument())
    expect(screen.getByLabelText(en.signIn.email)).toHaveValue('jemand@test.invalid')
  })

  it('translates the sidebar module labels', async () => {
    mockCapabilityFetch(staffSnapshot({ grants: { members: { read: true }, seo: { read: true } } }))
    renderConsole(<Sidebar items={ADMIN_ITEMS} title="Admin" />, { locale: 'en' })

    await waitFor(() => expect(screen.getByRole('link', { name: en.modules.members })).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: de.modules.members })).not.toBeInTheDocument()
  })

  it('updates the document language (FR-020)', async () => {
    mockCapabilityFetch(null)
    renderConsole(<LanguageSwitch />, { locale: 'de' })
    await waitFor(() => expect(document.documentElement.lang).toBe('de'))

    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
  })

  it('remembers the choice for the next visit', async () => {
    mockCapabilityFetch(null)
    renderConsole(<LanguageSwitch />, { locale: 'de' })

    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('en'))
  })
})

describe('the two catalogues really differ', () => {
  it('translates the strings a user actually reads', () => {
    // The counter-assertion for this whole file: a `en.js` copied verbatim from
    // `de.js` would satisfy the key-parity check and every render test that
    // only looked for "a string".
    for (const key of ['signIn.title', 'signIn.submit', 'console.signOut', 'modules.members']) {
      const read = (cat) => key.split('.').reduce((o, k) => o[k], cat)
      expect(read(en), `${key} was not translated`).not.toBe(read(de))
    }
  })

  it('leaves the product nouns identical in both', () => {
    // The design document fixes these; translating them would be the error.
    expect(en.portals.merchant).toBe(de.portals.merchant)
    expect(en.portals.partner).toBe(de.portals.partner)
    expect(en.brand.name).toBe(de.brand.name)
  })
})

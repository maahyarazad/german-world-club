import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, within } from '@testing-library/react'
import { PROBLEMS } from '@gwc/contracts/errors'
import ConsoleRoutes from '../../src/console/routes'
import { de } from '../../src/i18n/de'
import { en } from '../../src/i18n/en'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Onboarding on the web (feature 009) — the same five steps as the app.
 *
 * Driven through the real route table, so what is asserted includes where the
 * console sends somebody, not only what a screen renders once it is there.
 */

afterEach(() => vi.unstubAllGlobals())

const t = de.onboarding
const json = (body: unknown, status = 200) => ({ body: JSON.stringify(body), status })
const refusal = (problem: { type: string; title: string; status: number }) => ({
  body: JSON.stringify(problem),
  status: problem.status,
  headers: { 'content-type': 'application/problem+json' },
})

/** An applicant's session: every member route refuses with APPROVAL_PENDING. */
const applicantMe: RouteHandler = () => refusal(PROBLEMS.APPROVAL_PENDING)

const status = (step: string, denialReason: string | null = null) => () =>
  json({ step, denialReason, submittedAt: step === 'verify_email' ? null : '2026-09-23T10:00:00.000Z', reviewedAt: null })

/** The body a stubbed route received, parsed. */
const bodyOf = (fetchMock: ReturnType<typeof mockCapabilityFetch>, path: string) => {
  const call = fetchMock.mock.calls.find(([url]) => String(url) === path)
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined
}

async function fillDetails(copy: typeof t = t) {
  fireEvent.change(await screen.findByLabelText(copy.fullName), { target: { value: 'Anna Applicant' } })
  fireEvent.change(screen.getByLabelText(copy.email), { target: { value: 'Anna@Example.com' } })
  fireEvent.change(screen.getByLabelText(copy.password), { target: { value: 'correct-horse-battery' } })
  fireEvent.change(screen.getByLabelText(copy.mobile), { target: { value: '+49 151 1234 5678' } })
  fireEvent.change(screen.getByLabelText(copy.birthday), { target: { value: '1990-04-12' } })
  fireEvent.click(screen.getByLabelText(copy.genders.female))
}

describe('the way in', () => {
  it('the sign-in screen links to registration, next to the password reset', async () => {
    mockCapabilityFetch(null)
    renderConsole(<ConsoleRoutes />, { route: '/konsole/anmelden' })
    const link = await screen.findByRole('link', { name: de.signIn.becomeMember })
    expect(link.getAttribute('href')).toBe('/konsole/registrieren')
    expect(screen.getByRole('link', { name: de.signIn.forgotPassword })).toBeInTheDocument()
  })
})

describe('steps 1 and 2: details, then country', () => {
  it('refuses what the server would refuse, field by field', async () => {
    mockCapabilityFetch(null)
    renderConsole(<ConsoleRoutes />, { route: '/konsole/registrieren' })
    fireEvent.click(await screen.findByRole('button', { name: t.continue }))

    for (const message of [t.errors.fullName, t.errors.email, t.errors.password, t.errors.mobile, t.errors.birthday, t.errors.gender]) {
      expect(screen.getByText(message)).toBeInTheDocument()
    }
    // Still on step 1: nothing was sent.
    expect(screen.queryByLabelText(t.country)).not.toBeInTheDocument()
  })

  it('submits one registration, without a deviceId, and moves to the SMS step', async () => {
    const fetchMock = mockCapabilityFetch(null, {
      extraRoutes: {
        '/onboarding/register': () => json({ challengeId: '11111111-1111-4111-8111-111111111111', expiresIn: 300, sentTo: '•••• 5678' }, 202),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/registrieren' })
    await fillDetails()
    fireEvent.click(screen.getByRole('button', { name: t.continue }))

    fireEvent.change(await screen.findByLabelText(t.country), { target: { value: 'DE' } })
    fireEvent.click(screen.getByRole('button', { name: t.submit }))

    expect(await screen.findByRole('heading', { name: t.mobileTitle })).toBeInTheDocument()
    expect(screen.getByText(/•••• 5678/)).toBeInTheDocument()

    const sent = bodyOf(fetchMock, '/onboarding/register')
    expect(sent).toMatchObject({
      fullName: 'Anna Applicant', email: 'anna@example.com', mobile: '+4915112345678',
      birthday: '1990-04-12', gender: 'female', countryOfResidence: 'DE',
    })
    // The web face: a deviceId would bind approval to a device a browser does not have.
    expect(sent).not.toHaveProperty('deviceId')
  })

  it('shows Germany first and names countries in the interface language', async () => {
    mockCapabilityFetch(null)
    renderConsole(<ConsoleRoutes />, { route: '/konsole/registrieren', locale: 'en' })
    // English labels throughout: the form follows the locale, not just the list.
    await fillDetails(en.onboarding)
    fireEvent.click(screen.getByRole('button', { name: en.onboarding.continue }))

    const select = await screen.findByLabelText(en.onboarding.country)
    const pinned = within(select).getByRole('group', { name: en.onboarding.countryPinned })
    expect(within(pinned).getAllByRole('option')[0]?.textContent).toBe('Germany')
  })
})

describe('step 3: the SMS code', () => {
  /** Registers through the real screens and lands on step 3, like an applicant would. */
  async function reachStepThree(contact: RouteHandler) {
    const fetchMock = mockCapabilityFetch(null, {
      extraRoutes: {
        '/onboarding/register': () => json({ challengeId: '11111111-1111-4111-8111-111111111111', expiresIn: 300, sentTo: '•••• 5678' }, 202),
        '/onboarding/contact': contact,
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/registrieren' })
    await fillDetails()
    fireEvent.click(screen.getByRole('button', { name: t.continue }))
    fireEvent.change(await screen.findByLabelText(t.country), { target: { value: 'DE' } })
    fireEvent.click(screen.getByRole('button', { name: t.submit }))
    await screen.findByRole('heading', { name: t.mobileTitle })
    fireEvent.click(screen.getByRole('button', { name: t.changeDetails }))
    return fetchMock
  }

  it('corrects a mistyped number without starting over, and texts the new one', async () => {
    const fetchMock = await reachStepThree(() =>
      json({ challengeId: '22222222-2222-4222-8222-222222222222', expiresIn: 300, sentTo: '•••• 9999' }, 202))

    // Pre-filled with what was registered, so only the wrong part is retyped.
    expect(screen.getByLabelText(t.email)).toHaveValue('anna@example.com')
    fireEvent.change(screen.getByLabelText(t.mobile), { target: { value: '+49 176 1234 9999' } })
    fireEvent.click(screen.getByRole('button', { name: t.changeDetailsSave }))

    // In the subtitle and in the confirmation notice.
    expect(await screen.findAllByText(/•••• 9999/)).toHaveLength(2)
    // Only what changed is sent, against the pending challenge.
    expect(bodyOf(fetchMock, '/onboarding/contact')).toEqual({
      challengeId: '11111111-1111-4111-8111-111111111111', mobile: '+4917612349999',
    })
  })

  it('says so when the new number already belongs to someone', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await reachStepThree(() => refusal(PROBLEMS.MOBILE_IN_USE))
    fireEvent.change(screen.getByLabelText(t.mobile), { target: { value: '+49 176 1234 9999' } })
    fireEvent.click(screen.getByRole('button', { name: t.changeDetailsSave }))

    expect(await screen.findByText(t.mobileInUse)).toBeInTheDocument()
    // Still on the form, so another number can be entered.
    expect(screen.getByRole('button', { name: t.changeDetailsSave })).toBeInTheDocument()
    error.mockRestore()
  })

  it('after a reload, sends the applicant back to registration rather than to a dead form', async () => {
    mockCapabilityFetch(null)
    renderConsole(<ConsoleRoutes />, { route: '/konsole/registrieren/mobil' })
    expect(await screen.findByRole('heading', { name: t.missingChallengeTitle })).toBeInTheDocument()
  })
})

describe('an applicant with a session', () => {
  it('is sent to the application, never to the console or its error screen', async () => {
    mockCapabilityFetch(null, { extraRoutes: { '/auth/me': applicantMe, '/onboarding/status': status('awaiting_approval') } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    expect(await screen.findByRole('heading', { name: t.waitingTitle })).toBeInTheDocument()
    expect(screen.queryByText(de.console.capabilitiesFailedTitle)).not.toBeInTheDocument()
  })

  it('verifies the email: sends the code once, then submits it', async () => {
    const fetchMock = mockCapabilityFetch(null, {
      extraRoutes: {
        '/auth/me': applicantMe,
        '/onboarding/status': status('verify_email'),
        '/onboarding/email/send': () => json({ challengeId: '22222222-2222-4222-8222-222222222222', expiresIn: 1800, sentTo: 'a•••@example.com' }, 202),
        '/onboarding/email/verify': status('awaiting_approval'),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/bewerbung' })

    expect(await screen.findByText(/a•••@example.com/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(t.code), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: t.verify }))

    expect(await screen.findByRole('heading', { name: t.waitingTitle })).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/onboarding/email/send')).toHaveLength(1)
    expect(bodyOf(fetchMock, '/onboarding/email/verify')).toEqual({
      challengeId: '22222222-2222-4222-8222-222222222222', code: '123456',
    })
  })

  it('shows the reason staff gave for a denial', async () => {
    mockCapabilityFetch(null, {
      extraRoutes: { '/auth/me': () => refusal(PROBLEMS.APPLICATION_DENIED), '/onboarding/status': status('denied', 'Details could not be verified.') },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/bewerbung' })
    expect(await screen.findByRole('heading', { name: t.deniedTitle })).toBeInTheDocument()
    expect(screen.getByText('Details could not be verified.')).toBeInTheDocument()
  })

  it('an approved member who lands on the application goes to the member area instead', async () => {
    mockCapabilityFetch(memberSnapshot())
    renderConsole(<ConsoleRoutes />, { route: '/konsole/bewerbung' })
    expect((await screen.findAllByText(de.portals.member)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: t.waitingTitle })).not.toBeInTheDocument()
  })
})

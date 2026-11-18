import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { PROBLEMS } from '@gwc/contracts/errors'
import ConsoleRoutes from '../../src/console/routes'
import { de } from '../../src/i18n/de'
import { en } from '../../src/i18n/en'
import { renderConsole, mockCapabilityFetch } from '../helpers/console'

/**
 * Register, the mobile number (feature 031).
 *
 * `971585831595` — a UAE number typed with its country code but no `+` — became
 * `+49971585831595` with Germany picked: right shape, not a number. The SMS provider
 * refused it and the server answered 503. Now the field reads it as the number it is,
 * says how it read it, and anything that is not a number is reported under the field
 * and sent nowhere. Each case has its counter-assertion.
 */
afterEach(() => vi.unstubAllGlobals())

const t = de.onboarding
const json = (body: unknown, status = 200) => ({ body: JSON.stringify(body), status })
const problemResponse = (problem: { type: string; title: string; status: number }) => ({
  body: JSON.stringify(problem), status: problem.status, headers: { 'content-type': 'application/problem+json' },
})

const bodyOf = (fetchMock: ReturnType<typeof mockCapabilityFetch>, path: string) => {
  const call = fetchMock.mock.calls.find(([url]) => String(url) === path)
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined
}
const called = (fetchMock: ReturnType<typeof mockCapabilityFetch>, path: string) =>
  fetchMock.mock.calls.some(([url]) => String(url) === path)

async function fillDetails(mobile: string, copy: typeof t = t) {
  fireEvent.change(await screen.findByLabelText(copy.fullName), { target: { value: 'Anna Applicant' } })
  fireEvent.change(screen.getByLabelText(copy.email), { target: { value: 'anna@example.com' } })
  fireEvent.change(screen.getByLabelText(copy.password), { target: { value: 'correct-horse-battery' } })
  fireEvent.change(screen.getByLabelText(copy.mobile), { target: { value: mobile } })
  fireEvent.change(screen.getByLabelText(copy.birthday), { target: { value: '1990-04-12' } })
  fireEvent.click(screen.getByLabelText(copy.genders.female))
  fireEvent.click(screen.getByLabelText(copy.primaryLanguages.german))
  fireEvent.click(screen.getByLabelText(copy.ageConfirm))
}

const registered = { challengeId: '11111111-1111-4111-8111-111111111111', expiresIn: 300, sentTo: '•••• 1595' }

describe('the mobile number field on Register', () => {
  it('reads the reported number as +971 58 583 1595, says so, and sends that number', async () => {
    const fetchMock = mockCapabilityFetch(null, { extraRoutes: { '/onboarding/register': () => json(registered, 202) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/registrieren' })
    await fillDetails('971585831595')

    // Germany is the default picker; the number named its own country, so the picker follows.
    expect((screen.getByLabelText(t.mobileCountry) as HTMLSelectElement).value).toBe('AE')
    expect(await screen.findByText(t.mobileCorrected.replace('{number}', '+971 58 583 1595'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t.continue }))
    fireEvent.click(await screen.findByLabelText('Deutschland'))
    fireEvent.click(screen.getByRole('button', { name: t.submit }))
    await screen.findByRole('heading', { name: t.mobileTitle })
    expect(bodyOf(fetchMock, '/onboarding/register')).toMatchObject({ mobile: '+971585831595' })
  })

  it('says nothing about a valid number typed the ordinary way (counter-assertion)', async () => {
    mockCapabilityFetch(null)
    renderConsole(<ConsoleRoutes />, { route: '/konsole/registrieren' })
    await fillDetails('0151 1234 5678')
    expect((screen.getByLabelText(t.mobileCountry) as HTMLSelectElement).value).toBe('DE')
    expect(screen.queryByText(/Gelesen als/)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reports a number that is too short once the field is left, and sends nothing', async () => {
    const fetchMock = mockCapabilityFetch(null)
    renderConsole(<ConsoleRoutes />, { route: '/konsole/registrieren' })
    await fillDetails('12345')
    // Not while the person is still typing...
    expect(screen.queryByText(t.errors.mobileTooShort)).not.toBeInTheDocument()
    fireEvent.blur(screen.getByLabelText(t.mobile))
    // ...but as soon as they leave the field.
    expect(await screen.findByText(t.errors.mobileTooShort)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t.continue }))
    // The form checks the full +49… number, so its wording is the general one; what matters is
    // that the number is refused with a message and the person stays on this step.
    expect(screen.getByText(t.errors.mobileInvalid)).toBeInTheDocument()
    expect(screen.queryByLabelText('Deutschland')).not.toBeInTheDocument() // still on step 1
    expect(called(fetchMock, '/onboarding/register')).toBe(false)
  })

  it('refuses a number of the right shape that does not exist, instead of sending it', async () => {
    const fetchMock = mockCapabilityFetch(null)
    renderConsole(<ConsoleRoutes />, { route: '/konsole/registrieren' })
    await fillDetails('9715858315') // Germany picked: +499715858315, a shape with no number behind it
    fireEvent.click(screen.getByRole('button', { name: t.continue }))
    expect(await screen.findByText(t.errors.mobileInvalid)).toBeInTheDocument()
    expect(called(fetchMock, '/onboarding/register')).toBe(false)
  })

  it('puts the server\'s invalid-mobile refusal on the number field and goes back to it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCapabilityFetch(null, { extraRoutes: { '/onboarding/register': () => problemResponse(PROBLEMS.INVALID_MOBILE) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/registrieren' })
    await fillDetails('0151 1234 5678')
    fireEvent.click(screen.getByRole('button', { name: t.continue }))
    fireEvent.click(await screen.findByLabelText('Deutschland'))
    fireEvent.click(screen.getByRole('button', { name: t.submit }))
    expect(await screen.findByText(t.errors.mobileInvalid)).toBeInTheDocument()
    // Back on step 1, on the field it is about.
    expect(screen.getByLabelText(t.mobile)).toBeInTheDocument()
  })

  it('has the same messages in English', async () => {
    mockCapabilityFetch(null)
    renderConsole(<ConsoleRoutes />, { route: '/konsole/registrieren', locale: 'en' })
    await fillDetails('971585831595', en.onboarding)
    expect(await screen.findByText('Read as +971 58 583 1595')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(en.onboarding.mobile), { target: { value: '12' } })
    fireEvent.blur(screen.getByLabelText(en.onboarding.mobile))
    await waitFor(() => expect(screen.getByText(en.onboarding.errors.mobileTooShort)).toBeInTheDocument())
  })
})

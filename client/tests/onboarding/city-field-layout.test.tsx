import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, render } from '@testing-library/react'
import { PROBLEMS } from '@gwc/contracts/errors'
import ConsoleRoutes from '../../src/console/routes'
import { de } from '../../src/i18n/de'
import { MobileField } from '../../src/components/ui/MobileField'
import { LocaleProvider } from '../../src/i18n/index'
import { renderConsole, mockCapabilityFetch } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * The City field stays inside its card (feature 032).
 *
 * jsdom has no layout engine, so nothing here can MEASURE the overflow; what a
 * test can pin is the set of classes that prevent it, and why each is there is
 * written beside the row in `onboarding/profiling/steps.tsx`. The real proof is
 * the browser check recorded in specs/032-city-field-layout/tasks.md.
 *
 * The mobile-number row has the same two controls and already had these classes;
 * asserting both rows carry the same ones is what stops them drifting apart again.
 */
afterEach(() => vi.unstubAllGlobals())

const t = de.profiling
const json = (body: unknown, status = 200) => ({ body: JSON.stringify(body), status })
const blank = {
  settlingStatus: 'know_where', settlingCountry: null, settlingCity: null, settlingWorkDuration: null,
  languages: null, yearlyIncomeRange: null, qualificationLevel: null, occupation: null,
  relationshipStatus: null, kids: [], partner: null, desiredWorkType: null,
  futureWorkSector: null, futureWorkReady: null, futureWorkOffering: null, futureWorkIdea: null,
  futureWorkBusinessActivities: null, futureWorkPriorities: null,
  primaryCity: null, secondaryCities: [], gwcMatch: false,
}
const handlers: Record<string, RouteHandler> = {
  '/auth/me': () => ({
    body: JSON.stringify(PROBLEMS.PROFILING_INCOMPLETE), status: PROBLEMS.PROFILING_INCOMPLETE.status,
    headers: { 'content-type': 'application/problem+json' },
  }),
  '/onboarding/status': () => json({ step: 'approved', denialReason: null, submittedAt: '2026-09-23T10:00:00.000Z', reviewedAt: '2026-09-24T09:00:00.000Z' }),
  '/profiling/status': () => json({ branch: 'germany', completed: false, outcome: null, matchedCity: null, answers: blank }),
  '/profiling/cities': () => json({ listed: true, cities: ['Berlin'] }),
}

const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)

describe('the City field row (Where will you be settling?)', () => {
  it('lets the country select, the city input and the fieldset shrink to the card', async () => {
    mockCapabilityFetch(null, { extraRoutes: handlers })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
    await screen.findByRole('heading', { name: t.settlingPlaceTitle })

    const select = screen.getByLabelText(`${t.settlingPlaceLabel}: ${t.country}`)
    const input = screen.getByLabelText(`${t.settlingPlaceLabel}: ${t.city}`)
    const fieldset = select.closest('fieldset')!

    // A native select sizes to its longest option and an input to ~20 characters; a flex
    // item will not shrink below its content without `min-w-0`, and a fieldset defaults to
    // `min-inline-size: min-content`. Each of these classes closes one of those.
    expect(classesOf(select)).toEqual(expect.arrayContaining(['w-[46%]', 'min-w-0']))
    expect(classesOf(input)).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']))
    expect(classesOf(fieldset)).toContain('min-w-0')
  })

  it('carries the same classes as the mobile-number row, so the two cannot drift apart', async () => {
    mockCapabilityFetch(null, { extraRoutes: handlers })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
    await screen.findByRole('heading', { name: t.settlingPlaceTitle })
    const citySelect = screen.getByLabelText(`${t.settlingPlaceLabel}: ${t.country}`)
    const cityInput = screen.getByLabelText(`${t.settlingPlaceLabel}: ${t.city}`)

    const { container } = render(<LocaleProvider initialLocale="de"><MobileField value="" onChange={() => undefined} /></LocaleProvider>)
    const mobileSelect = container.querySelector('select')!
    const mobileInput = container.querySelector('input')!

    // The mobile field's select needs only its explicit width (a flex item whose width is
    // set does not fall back to its content size); the city select adds `min-w-0` as well.
    expect(classesOf(mobileSelect)).toContain('w-[46%]')
    expect(classesOf(citySelect)).toContain('w-[46%]')
    for (const cls of ['min-w-0', 'flex-1']) {
      expect(classesOf(mobileInput), `mobile input ${cls}`).toContain(cls)
      expect(classesOf(cityInput), `city input ${cls}`).toContain(cls)
    }
  })
})

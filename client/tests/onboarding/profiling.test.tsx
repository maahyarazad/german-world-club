import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { PROBLEMS } from '@gwc/contracts/errors'
import ConsoleRoutes from '../../src/console/routes'
import { de } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Onboarding Phase 2 (feature 013): the console shows the profiling
 * questionnaire in place of the member area, for exactly as long as
 * GET /profiling/status reports incomplete — and never for a member whose
 * profile is already done or who never applied at all.
 */

afterEach(() => vi.unstubAllGlobals())

const t = de.profiling
const json = (body: unknown, status = 200) => ({ body: JSON.stringify(body), status })
const refusal = (problem: { type: string; title: string; status: number }) => ({
  body: JSON.stringify(problem),
  status: problem.status,
  headers: { 'content-type': 'application/problem+json' },
})

const onboardingStatus: RouteHandler = () =>
  json({ step: 'approved', denialReason: null, submittedAt: '2026-09-23T10:00:00.000Z', reviewedAt: '2026-09-24T09:00:00.000Z' })

const blank = {
  settlingStatus: null, settlingCountry: null, settlingCity: null, settlingWorkDuration: null,
  languages: null, yearlyIncomeRange: null, qualificationLevel: null, occupation: null,
  relationshipStatus: null, kids: [], partner: null, desiredWorkType: null,
  futureWorkSector: null, futureWorkReady: null, futureWorkOffering: null, futureWorkIdea: null,
  futureWorkBusinessActivities: null, futureWorkPriorities: null,
  primaryCity: null, secondaryCities: [], gwcMatch: false,
}
const status = (branch: 'germany' | 'elsewhere', answers: object = {}, extra: object = {}) => json({
  branch, completed: false, outcome: null, matchedCity: null, answers: { ...blank, ...answers }, ...extra,
})
// Q1 (please help) and Q2 answered: the next question is Q3, qualification.
const q1toQ2 = { settlingStatus: 'need_help', languages: ['en'] }
const upToQ5 = { ...q1toQ2, qualificationLevel: 'doctorate', occupation: 'other', yearlyIncomeRange: '50k_to_100k' }
const allGerman = {
  ...q1toQ2, qualificationLevel: 'bachelors_degree', occupation: 'engineer', yearlyIncomeRange: '50k_to_100k',
  relationshipStatus: ['single'], desiredWorkType: 'employee', futureWorkSector: 'technology_it', futureWorkReady: true,
}
const cityList = (listed: boolean, cities: string[] = []) => ({
  '/profiling/cities': () => json({ listed, cities }),
})

const incomplete = (profiling: RouteHandler, more: Record<string, RouteHandler> = {}) => mockCapabilityFetch(null, {
  extraRoutes: {
    '/auth/me': () => refusal(PROBLEMS.PROFILING_INCOMPLETE),
    '/onboarding/status': onboardingStatus,
    '/profiling/status': profiling,
    ...more,
  },
})
const open = () => renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

describe('Onboarding Phase 2: profiling', () => {
  it('shows the profiling screen instead of the member area when incomplete', async () => {
    incomplete(() => status('germany'))
    open()
    expect(await screen.findByRole('heading', { name: t.settlingTitle })).toBeInTheDocument()
    expect(screen.queryByText(de.portals.member)).not.toBeInTheDocument()
  })

  it('resumes at the next unanswered question', async () => {
    incomplete(() => status('germany', q1toQ2))
    open()
    expect(await screen.findByRole('heading', { name: t.qualificationTitle })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.settlingTitle })).not.toBeInTheDocument()
  })

  it('enters the member area once profiling is already complete', async () => {
    mockCapabilityFetch(memberSnapshot(), {
      extraRoutes: {
        '/onboarding/status': onboardingStatus,
        '/profiling/status': () => status('germany', allGerman, { completed: true }),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/bewerbung' })
    expect((await screen.findAllByText(de.portals.member)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: t.settlingTitle })).not.toBeInTheDocument()
  })

  it('asks in the described order: settling, languages, qualification, occupation, income', async () => {
    incomplete(() => status('germany', { ...q1toQ2, qualificationLevel: 'doctorate', occupation: 'other' }))
    open()
    // Income is Q5, after the occupation.
    expect(await screen.findByRole('heading', { name: t.incomeTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.incomeOptions.over_500k })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.incomeOptions.over_1m })).toBeInTheDocument()
  })

  it('goes Back to the previous question with the saved answer', async () => {
    incomplete(() => status('germany', q1toQ2))
    open()
    await screen.findByRole('heading', { name: t.qualificationTitle })

    fireEvent.click(screen.getByRole('button', { name: t.back }))
    expect(await screen.findByRole('heading', { name: t.languagesTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.languagesRemove.replace('{language}', 'English') })).toBeInTheDocument()
  })

  it('has no Back on the first question', async () => {
    incomplete(() => status('germany'))
    open()
    await screen.findByRole('heading', { name: t.settlingTitle })
    expect(screen.queryByRole('button', { name: t.back })).not.toBeInTheDocument()
  })

  describe('settling (Q1)', () => {
    it('"please help" shows the information screen, then languages', async () => {
      incomplete(() => status('germany', { settlingStatus: 'need_help' }), {})
      open()
      // Everything after Q1 is unanswered, so the flow resumes at languages; Back shows the info screen.
      await screen.findByRole('heading', { name: t.languagesTitle })
      fireEvent.click(screen.getByRole('button', { name: t.back }))
      expect(await screen.findByText(t.settlingInfo)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: t.next }))
      expect(await screen.findByRole('heading', { name: t.languagesTitle })).toBeInTheDocument()
    })

    it('"yes" asks for the place and offers the listed cities', async () => {
      const saved: unknown[] = []
      incomplete(() => status('germany', { settlingStatus: 'know_where' }), {
        ...cityList(true, ['Berlin', 'Munich']),
        '/profiling': (options) => { saved.push(JSON.parse(String(options.body))); return status('germany', { settlingStatus: 'know_where', settlingCountry: 'DE', settlingCity: 'Munich' }) },
      })
      open()
      await screen.findByRole('heading', { name: t.settlingPlaceTitle })
      fireEvent.change(screen.getByLabelText(`${t.settlingPlaceLabel}: ${t.country}`), { target: { value: 'DE' } })
      const city = screen.getByLabelText(`${t.settlingPlaceLabel}: ${t.city}`)
      fireEvent.change(city, { target: { value: 'Atlantis' } })
      // A city outside the list of a listed country cannot be continued with.
      expect(await screen.findByText(t.cityNotListed)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: t.next })).toBeDisabled()
      fireEvent.change(city, { target: { value: 'munich' } })
      await waitFor(() => expect(screen.getByRole('button', { name: t.next })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: t.next }))
      await waitFor(() => expect(saved).toEqual([{ settlingCountry: 'DE', settlingCity: 'munich' }]))
    })

    it('accepts free text for a country the lists do not cover', async () => {
      incomplete(() => status('germany', { settlingStatus: 'know_where' }), cityList(false))
      open()
      await screen.findByRole('heading', { name: t.settlingPlaceTitle })
      fireEvent.change(screen.getByLabelText(`${t.settlingPlaceLabel}: ${t.country}`), { target: { value: 'LI' } })
      fireEvent.change(screen.getByLabelText(`${t.settlingPlaceLabel}: ${t.city}`), { target: { value: 'Vaduz' } })
      await waitFor(() => expect(screen.getByRole('button', { name: t.next })).toBeEnabled())
    })

    it('asks how long they have been working only for Dubai, as one of five bands', async () => {
      incomplete(() => status('germany', { settlingStatus: 'know_where', settlingCountry: 'AE', settlingCity: 'Dubai' }))
      open()
      expect(await screen.findByRole('heading', { name: t.workingDurationTitle })).toBeInTheDocument()
      for (const label of Object.values(t.workingDurationOptions)) {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
      }
    })
  })

  describe('Q7', () => {
    it('Business Owner picks the industry and then any of Produce / Distribute / Sales / Other', async () => {
      const saved: unknown[] = []
      incomplete(
        () => status('germany', { ...allGerman, desiredWorkType: 'business_owner', futureWorkReady: null, futureWorkSector: 'legal_services' }),
        { '/profiling': (options) => { saved.push(JSON.parse(String(options.body))); return status('germany', allGerman) } },
      )
      open()
      await screen.findByRole('heading', { name: t.productServiceTitle })
      fireEvent.click(screen.getByRole('button', { name: t.businessActivityOptions.produce }))
      fireEvent.click(screen.getByRole('button', { name: t.businessActivityOptions.sales }))
      fireEvent.click(screen.getByRole('button', { name: t.next }))
      await waitFor(() => expect(saved).toEqual([{ futureWorkBusinessActivities: ['produce', 'sales'] }]))
    })

    it('"I am not sure yet" takes several statements and asks no industry', async () => {
      const saved: unknown[] = []
      incomplete(
        () => status('germany', { ...allGerman, desiredWorkType: 'not_sure', futureWorkSector: null, futureWorkReady: null }),
        { '/profiling': (options) => { saved.push(JSON.parse(String(options.body))); return status('germany', { ...allGerman, desiredWorkType: 'not_sure', futureWorkSector: null, futureWorkReady: null, futureWorkPriorities: ['family_time', 'balance_lifestyle'] }) } },
      )
      open()
      await screen.findByRole('heading', { name: t.futureWorkPrioritiesTitle })
      fireEvent.click(screen.getByRole('button', { name: t.futureWorkPrioritiesOptions.family_time }))
      fireEvent.click(screen.getByRole('button', { name: t.futureWorkPrioritiesOptions.balance_lifestyle }))
      fireEvent.click(screen.getByRole('button', { name: t.next }))
      // Straight to the review: there is no industry question on this path.
      expect(await screen.findByRole('heading', { name: t.reviewTitle })).toBeInTheDocument()
      expect(saved).toEqual([{ futureWorkPriorities: ['family_time', 'balance_lifestyle'] }])
      expect(screen.queryByText(t.futureWorkSectorTitle)).not.toBeInTheDocument()
    })

    it('offers exactly the listed industries in the dropdown', async () => {
      incomplete(() => status('germany', { ...allGerman, futureWorkSector: null }))
      open()
      await screen.findByRole('heading', { name: t.futureWorkSectorTitle })
      const options = screen.getAllByRole('option').map((o) => o.textContent)
      expect(options).toEqual([t.industryPlaceholder, ...Object.values(t.industryOptions)])
      expect(options).toHaveLength(22)
      expect(screen.getByRole('button', { name: t.next })).toBeDisabled()
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'legal_services' } })
      expect(screen.getByRole('button', { name: t.next })).toBeEnabled()
    })
  })

  it('does not complete on the last answer: it goes to the review, and Submit completes', async () => {
    const calls: string[] = []
    incomplete(
      () => status('germany', { ...allGerman, futureWorkReady: null }),
      {
        '/profiling': (options) => {
          calls.push(`${options.method} /profiling`)
          return status('germany', allGerman)
        },
        '/profiling/submit': (options) => {
          calls.push(`${options.method} /profiling/submit`)
          return status('germany', allGerman, { completed: true })
        },
      },
    )
    open()
    await screen.findByRole('heading', { name: t.futureWorkReadyTitle })
    fireEvent.click(screen.getByRole('button', { name: t.futureWorkReadyOptions.yes }))

    expect(await screen.findByRole('heading', { name: t.reviewTitle })).toBeInTheDocument()
    expect(calls).toEqual(['PATCH /profiling'])

    fireEvent.click(screen.getByRole('button', { name: t.submit }))
    await waitFor(() => expect(calls).toEqual(['PATCH /profiling', 'POST /profiling/submit']))
  })

  it('returns to the review after changing an answer from it', async () => {
    const bodies: unknown[] = []
    incomplete(() => status('germany', allGerman), {
      '/profiling': (options) => {
        bodies.push(JSON.parse(String(options.body)))
        return status('germany', { ...allGerman, yearlyIncomeRange: 'over_1m' })
      },
    })
    open()
    await screen.findByRole('heading', { name: t.reviewTitle })
    // Rows follow the questions: settling, languages, qualification, occupation, income (the fifth).
    fireEvent.click(screen.getAllByRole('button', { name: t.change })[4]!)
    expect(await screen.findByRole('heading', { name: t.incomeTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.back })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t.incomeOptions.over_1m }))
    expect(await screen.findByRole('heading', { name: t.reviewTitle })).toBeInTheDocument()
    expect(bodies).toEqual([{ yearlyIncomeRange: 'over_1m' }])
  })

  it('keeps "single" exclusive in both directions', async () => {
    incomplete(() => status('germany', upToQ5))
    open()
    await screen.findByRole('heading', { name: t.relationshipTitle })
    const tag = (name: string) => screen.getByRole('button', { name })
    const opts = t.relationshipOptions

    fireEvent.click(tag(opts.kids))
    fireEvent.click(tag(opts.partner))
    expect(tag(opts.kids)).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(tag(opts.single))
    expect(tag(opts.single)).toHaveAttribute('aria-pressed', 'true')
    expect(tag(opts.kids)).toHaveAttribute('aria-pressed', 'false')
    expect(tag(opts.partner)).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(tag(opts.family))
    expect(tag(opts.single)).toHaveAttribute('aria-pressed', 'false')
    expect(tag(opts.family)).toHaveAttribute('aria-pressed', 'true')
  })

  it('asks one age range per kid', async () => {
    incomplete(() => status('germany', { ...upToQ5, relationshipStatus: ['kids'] }))
    open()
    await screen.findByRole('heading', { name: t.kidsCountTitle })
    const count = screen.getByRole('spinbutton')
    fireEvent.change(count, { target: { value: '3' } })
    expect(screen.getAllByRole('combobox')).toHaveLength(3)
    fireEvent.change(count, { target: { value: '1' } })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    // Continue stays disabled until each kid has a range.
    expect(screen.getByRole('button', { name: t.next })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'age_6_14' } })
    expect(screen.getByRole('button', { name: t.next })).toBeEnabled()
  })

  it('asks the partner the German questionnaire from Q1, without the relationship question', async () => {
    incomplete(() => status('germany', { ...upToQ5, relationshipStatus: ['partner'] }))
    open()
    const partnerQ = (question: string) => t.partnerTitle.replace('{question}', question)
    // The partner starts where the member did: with settling.
    expect(await screen.findByRole('heading', { name: partnerQ(t.settlingTitle) })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.relationshipTitle })).not.toBeInTheDocument()
  })

  describe('the non-German path', () => {
    const paris = { primaryCity: { country: 'FR', city: 'Paris' } }

    it('shows the city form first', async () => {
      incomplete(() => status('elsewhere'), cityList(true, ['Paris']))
      open()
      expect(await screen.findByRole('heading', { name: t.cityTitle })).toBeInTheDocument()
    })

    it('goes straight from the cities to the review when no GWC city matched, and shows the outcome', async () => {
      incomplete(
        () => status('elsewhere', paris),
        {
          '/profiling/submit': () => status('elsewhere', paris, { completed: true, outcome: 'in_person_meeting' }),
        },
      )
      open()
      expect(await screen.findByRole('heading', { name: t.reviewTitle })).toBeInTheDocument()
      // Neither Q6 nor Q7 rows: only the cities.
      expect(screen.queryByText(t.relationshipTitle)).not.toBeInTheDocument()
      expect(screen.queryByText(t.desiredWorkTitle)).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: t.submit }))
      expect(await screen.findByRole('heading', { name: t.meetingTitle })).toBeInTheDocument()
    })

    it('asks Q6 after a GWC city matched', async () => {
      incomplete(() => status('elsewhere', { ...paris, gwcMatch: true }))
      open()
      expect(await screen.findByRole('heading', { name: t.relationshipTitle })).toBeInTheDocument()
    })
  })

  it('moves to the first missing question when the server says answers are missing', async () => {
    let reads = 0
    incomplete(
      // Application reads it once and Profiling once; on the reload after the refusal
      // the server reports Q1 as missing.
      () => status('germany', reads++ < 2 ? allGerman : { ...allGerman, settlingStatus: null }),
      { '/profiling/submit': () => refusal(PROBLEMS.PROFILING_ANSWERS_MISSING) },
    )
    open()
    await screen.findByRole('heading', { name: t.reviewTitle })
    fireEvent.click(screen.getByRole('button', { name: t.submit }))
    expect(await screen.findByRole('heading', { name: t.settlingTitle })).toBeInTheDocument()
    // Failures go to the console, not the screen.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

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
  settlingStatus: null, languages: null, yearlyIncomeRange: null, qualificationLevel: null, occupation: null,
  relationshipStatus: null, kids: [], partner: null, desiredWorkType: null,
  futureWorkSector: null, futureWorkReady: null, futureWorkOffering: null, futureWorkIdea: null,
  futureWorkPriority: null, primaryCity: null, secondaryCities: [],
}
const status = (branch: 'germany' | 'elsewhere', answers: object = {}, extra: object = {}) => json({
  branch, completed: false, outcome: null, matchedCity: null, answers: { ...blank, ...answers }, ...extra,
})
const q1toQ3 = { settlingStatus: 'know_where', languages: ['en'], yearlyIncomeRange: '50k_to_100k' }
const allGerman = {
  ...q1toQ3, qualificationLevel: 'bachelors_degree', occupation: 'engineer', relationshipStatus: ['single'],
  desiredWorkType: 'employee', futureWorkSector: 'technology_it', futureWorkReady: true,
}

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
    incomplete(() => status('germany', q1toQ3))
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

  it('goes Back to the previous question with the saved answer marked', async () => {
    incomplete(() => status('germany', q1toQ3))
    open()
    await screen.findByRole('heading', { name: t.qualificationTitle })

    fireEvent.click(screen.getByRole('button', { name: t.back }))
    expect(await screen.findByRole('heading', { name: t.incomeTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.incomeOptions['50k_to_100k'] })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: t.incomeOptions.over_100k })).toHaveAttribute('aria-pressed', 'false')
  })

  it('has no Back on the first question', async () => {
    incomplete(() => status('germany'))
    open()
    await screen.findByRole('heading', { name: t.settlingTitle })
    expect(screen.queryByRole('button', { name: t.back })).not.toBeInTheDocument()
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
        return status('germany', { ...allGerman, yearlyIncomeRange: 'over_100k' })
      },
    })
    open()
    await screen.findByRole('heading', { name: t.reviewTitle })
    // Row order follows the questions: the income row is the third "Change".
    fireEvent.click(screen.getAllByRole('button', { name: t.change })[2]!)
    expect(await screen.findByRole('heading', { name: t.incomeTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.back })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t.incomeOptions.over_100k }))
    expect(await screen.findByRole('heading', { name: t.reviewTitle })).toBeInTheDocument()
    expect(bodies).toEqual([{ yearlyIncomeRange: 'over_100k' }])
  })

  it('keeps "single" exclusive in both directions', async () => {
    incomplete(() => status('germany', { ...q1toQ3, qualificationLevel: 'doctorate', occupation: 'other' }))
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
    incomplete(() => status('germany', { ...q1toQ3, qualificationLevel: 'doctorate', occupation: 'other', relationshipStatus: ['kids'] }))
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

  it('asks the partner the German questions, without the relationship question', async () => {
    const base = { ...q1toQ3, qualificationLevel: 'doctorate', occupation: 'other', relationshipStatus: ['partner'] }
    incomplete(() => status('germany', base))
    open()
    const partnerQ = (question: string) => t.partnerTitle.replace('{question}', question)
    // First partner question is languages: the partner is never asked where they will settle.
    expect(await screen.findByRole('heading', { name: partnerQ(t.languagesTitle) })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: partnerQ(t.settlingTitle) })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.relationshipTitle })).not.toBeInTheDocument()
  })

  it('asks the industry as a dropdown of the fixed list, and the not-sure statement as a single choice', async () => {
    const saved: unknown[] = []
    incomplete(
      () => status('germany', { ...allGerman, desiredWorkType: 'not_sure', futureWorkSector: null, futureWorkReady: null }),
      { '/profiling': (options) => { saved.push(JSON.parse(String(options.body))); return status('germany', allGerman) } },
    )
    open()
    // Statement first (single select: picking one saves it and moves on).
    await screen.findByRole('heading', { name: t.futureWorkPrioritiesTitle })
    fireEvent.click(screen.getByRole('button', { name: t.futureWorkPrioritiesOptions.balance_lifestyle }))
    expect(saved).toEqual([{ futureWorkPriority: 'balance_lifestyle' }])
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

  it('a non-German member goes from the cities and Q6 straight to the review, then sees the outcome', async () => {
    incomplete(
      () => status('elsewhere', { primaryCity: { country: 'FR', city: 'Paris' }, relationshipStatus: ['single'] }),
      {
        '/profiling/submit': () => status('elsewhere', {
          primaryCity: { country: 'FR', city: 'Paris' }, relationshipStatus: ['single'],
        }, { completed: true, outcome: 'in_person_meeting' }),
      },
    )
    open()
    expect(await screen.findByRole('heading', { name: t.reviewTitle })).toBeInTheDocument()
    // No Q7 rows for the elsewhere branch.
    expect(screen.queryByText(t.desiredWorkTitle)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t.submit }))
    expect(await screen.findByRole('heading', { name: t.meetingTitle })).toBeInTheDocument()
  })

  it('shows the city form first for a non-German member', async () => {
    incomplete(() => status('elsewhere'))
    open()
    expect(await screen.findByRole('heading', { name: t.cityTitle })).toBeInTheDocument()
  })

  it('moves to the first missing question when the server says answers are missing', async () => {
    let reads = 0
    incomplete(
      // Application reads it once and Profiling once; on the reload after the refusal the server reports Q1 as missing.
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

import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
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

describe('Onboarding Phase 2: profiling', () => {
  it('shows the profiling screen instead of the member area when incomplete', async () => {
    mockCapabilityFetch(null, {
      extraRoutes: {
        '/auth/me': () => refusal(PROBLEMS.PROFILING_INCOMPLETE),
        '/onboarding/status': onboardingStatus,
        '/profiling/status': () => json({
          branch: 'germany', completed: false, outcome: null, matchedCity: null,
          answers: {
            settlingStatus: null, languages: null, qualificationLevel: null, occupation: null, desiredWorkType: null,
            primaryCity: null, secondaryCities: [],
          },
        }),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    expect(await screen.findByRole('heading', { name: t.settlingTitle })).toBeInTheDocument()
    expect(screen.queryByText(de.portals.member)).not.toBeInTheDocument()
  })

  it('resumes at the next unanswered question', async () => {
    mockCapabilityFetch(null, {
      extraRoutes: {
        '/auth/me': () => refusal(PROBLEMS.PROFILING_INCOMPLETE),
        '/onboarding/status': onboardingStatus,
        '/profiling/status': () => json({
          branch: 'germany', completed: false, outcome: null, matchedCity: null,
          answers: {
            settlingStatus: 'know_where', languages: ['en'], qualificationLevel: null, occupation: null, desiredWorkType: null,
            primaryCity: null, secondaryCities: [],
          },
        }),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    expect(await screen.findByRole('heading', { name: t.qualificationTitle })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.settlingTitle })).not.toBeInTheDocument()
  })

  it('enters the member area once profiling is already complete', async () => {
    mockCapabilityFetch(memberSnapshot(), {
      extraRoutes: {
        '/onboarding/status': onboardingStatus,
        '/profiling/status': () => json({
          branch: 'germany', completed: true, outcome: null, matchedCity: null,
          answers: {
            settlingStatus: 'know_where', languages: ['en'], qualificationLevel: 'bachelors_degree',
            occupation: 'engineer', desiredWorkType: 'employee', primaryCity: null, secondaryCities: [],
          },
        }),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/bewerbung' })

    expect((await screen.findAllByText(de.portals.member)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: t.settlingTitle })).not.toBeInTheDocument()
  })

  it('shows the elsewhere-branch city form for a non-German member', async () => {
    mockCapabilityFetch(null, {
      extraRoutes: {
        '/auth/me': () => refusal(PROBLEMS.PROFILING_INCOMPLETE),
        '/onboarding/status': onboardingStatus,
        '/profiling/status': () => json({
          branch: 'elsewhere', completed: false, outcome: null, matchedCity: null,
          answers: {
            settlingStatus: null, languages: null, qualificationLevel: null, occupation: null, desiredWorkType: null,
            primaryCity: null, secondaryCities: [],
          },
        }),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    expect(await screen.findByRole('heading', { name: t.cityTitle })).toBeInTheDocument()
  })

  it('shows the in-person-meeting outcome once submitted', async () => {
    mockCapabilityFetch(null, {
      extraRoutes: {
        '/auth/me': () => refusal(PROBLEMS.PROFILING_INCOMPLETE),
        '/onboarding/status': onboardingStatus,
        '/profiling/status': () => json({
          branch: 'elsewhere', completed: false, outcome: null, matchedCity: null,
          answers: {
            settlingStatus: null, languages: null, qualificationLevel: null, occupation: null, desiredWorkType: null,
            primaryCity: null, secondaryCities: [],
          },
        }),
        '/profiling': () => json({
          branch: 'elsewhere', completed: true, outcome: 'in_person_meeting', matchedCity: null,
          answers: {
            settlingStatus: null, languages: null, qualificationLevel: null, occupation: null, desiredWorkType: null,
            primaryCity: { country: 'FR', city: 'Paris' }, secondaryCities: [],
          },
        }),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    await screen.findByRole('heading', { name: t.cityTitle })
    const [countrySelect] = screen.getAllByRole('combobox')
    fireEvent.change(countrySelect!, { target: { value: 'FR' } })
    fireEvent.change(screen.getByPlaceholderText(t.city), { target: { value: 'Paris' } })
    fireEvent.click(screen.getByRole('button', { name: t.submit }))

    expect(await screen.findByRole('heading', { name: t.meetingTitle })).toBeInTheDocument()
  })
})

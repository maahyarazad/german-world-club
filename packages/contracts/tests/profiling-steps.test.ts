import { describe, it, expect } from 'vitest'
import {
  profilingSteps, profilingMissing, DESIRED_WORK_TYPES, RELATIONSHIP_TAGS,
  profilingElsewherePatchSchema, profilingGermanyPatchSchema,
  type ProfilingAnswers, type RelationshipTag, type ProfilingBranch,
} from '../src/profiling.ts'

const blank = (): ProfilingAnswers => ({
  settlingStatus: null, languages: null, yearlyIncomeRange: null, qualificationLevel: null, occupation: null,
  relationshipStatus: null, kids: [], partner: null, desiredWorkType: null,
  futureWorkSector: null, futureWorkReady: null, futureWorkOffering: null, futureWorkIdea: null,
  futureWorkPriority: null, primaryCity: null, secondaryCities: [],
})

const TAG_SETS: RelationshipTag[][] = [
  ['single'], ['partner'], ['family'], ['kids'], ['kids', 'partner'], ['kids', 'family'], ['partner', 'family', 'kids'],
]

describe('profilingSteps', () => {
  for (const branch of ['germany', 'elsewhere'] as ProfilingBranch[]) {
    for (const tags of TAG_SETS) {
      for (const work of DESIRED_WORK_TYPES) {
        it(`${branch} / ${tags.join('+')} / ${work}`, () => {
          const steps = profilingSteps(branch, { ...blank(), relationshipStatus: tags, desiredWorkType: work })
          expect(steps.at(-1)).toBe('review')
          expect(steps.includes('kids')).toBe(tags.includes('kids'))
          expect(steps.includes('partner-languages')).toBe(tags.includes('partner') || tags.includes('family'))
          expect(steps).not.toContain('partner-settling')
          // Q7 is German-only.
          expect(steps.some((s) => s.startsWith('work-'))).toBe(branch === 'germany')
          // Q6 is asked before the partner section and before Q7.
          expect(steps.indexOf('relationship')).toBeLessThan(steps.indexOf('review'))
          if (branch === 'germany') expect(steps.indexOf('relationship')).toBeLessThan(steps.indexOf('work-type'))
        })
      }
    }
  }

  it('orders each Q7 path as the business description does', () => {
    const path = (work: (typeof DESIRED_WORK_TYPES)[number]) =>
      profilingSteps('germany', { ...blank(), relationshipStatus: ['single'], desiredWorkType: work })
        .filter((s) => s.startsWith('work-') && s !== 'work-type')
    expect(path('employee')).toEqual(['work-industry', 'work-ready'])
    expect(path('freelance')).toEqual(['work-offering', 'work-industry', 'work-idea'])
    expect(path('business_owner')).toEqual(['work-industry', 'work-idea'])
    expect(path('own_business')).toEqual(['work-offering', 'work-industry', 'work-idea'])
    expect(path('not_sure')).toEqual(['work-priorities', 'work-industry'])
  })

  it('never asks kids or partner questions for "single"', () => {
    const steps = profilingSteps('germany', { ...blank(), relationshipStatus: ['single'] })
    expect(steps).not.toContain('kids')
    expect(steps.some((s) => s.startsWith('partner-'))).toBe(false)
  })
})

describe('profilingMissing', () => {
  it('lists exactly the unanswered applicable steps', () => {
    const a = { ...blank(), settlingStatus: 'know_where' as const, languages: ['en'] }
    expect(profilingMissing('germany', a)).toEqual(['income', 'qualification', 'occupation', 'relationship', 'work-type'])
  })

  it('is empty for a fully answered "single" German member on the employee path', () => {
    const a: ProfilingAnswers = {
      ...blank(), settlingStatus: 'need_help', languages: ['de'], yearlyIncomeRange: 'over_100k',
      qualificationLevel: 'masters_degree', occupation: 'engineer', relationshipStatus: ['single'],
      desiredWorkType: 'employee', futureWorkSector: 'automotive_transportation', futureWorkReady: false,
    }
    expect(profilingMissing('germany', a)).toEqual([])
  })

  it('treats an empty list and unanswered choices as unanswered', () => {
    const a: ProfilingAnswers = {
      ...blank(), relationshipStatus: ['single'], languages: [], desiredWorkType: 'not_sure',
      futureWorkSector: null, futureWorkPriority: null,
    }
    const missing = profilingMissing('germany', a)
    expect(missing).toContain('languages')
    expect(missing).toContain('work-industry')
    expect(missing).toContain('work-priorities')
  })

  it('ignores an answer whose step no longer applies (kids after the tag is removed)', () => {
    const a = { ...blank(), relationshipStatus: ['partner' as const], kids: ['age_0_6' as const] }
    expect(profilingSteps('elsewhere', a)).not.toContain('kids')
    expect(profilingMissing('elsewhere', a)).not.toContain('kids')
  })

  it('asks the elsewhere branch for cities, Q6 and a partner but never Q7', () => {
    const missing = profilingMissing('elsewhere', { ...blank(), relationshipStatus: ['partner'] })
    expect(missing).toEqual([
      'cities', 'partner-languages', 'partner-income', 'partner-qualification', 'partner-occupation',
    ])
  })
})

describe('patch schemas', () => {
  it('refuses "single" together with any other tag, and accepts it alone', () => {
    for (const other of RELATIONSHIP_TAGS.filter((t) => t !== 'single')) {
      expect(profilingGermanyPatchSchema.safeParse({ relationshipStatus: ['single', other] }).success).toBe(false)
    }
    expect(profilingGermanyPatchSchema.safeParse({ relationshipStatus: ['single'] }).success).toBe(true)
  })

  it('accepts Q6 fields on both branches and rejects cross-branch fields', () => {
    expect(profilingElsewherePatchSchema.safeParse({ relationshipStatus: ['kids'], kids: ['age_0_6'] }).success).toBe(true)
    expect(profilingGermanyPatchSchema.safeParse({ primaryCity: { country: 'AE', city: 'Dubai' } }).success).toBe(false)
    expect(profilingElsewherePatchSchema.safeParse({ occupation: 'student' }).success).toBe(false)
  })

  it('requires the primary city with secondaries and keeps them distinct', () => {
    const dubai = { country: 'AE', city: 'Dubai' }
    expect(profilingElsewherePatchSchema.safeParse({ secondaryCities: [dubai] }).success).toBe(false)
    expect(profilingElsewherePatchSchema.safeParse({ primaryCity: dubai, secondaryCities: [{ ...dubai, city: 'dubai' }] }).success).toBe(false)
    expect(profilingElsewherePatchSchema.safeParse({ primaryCity: dubai, secondaryCities: [] }).success).toBe(true)
  })

  it('bounds the kid count to 1-20', () => {
    expect(profilingGermanyPatchSchema.safeParse({ kids: [] }).success).toBe(false)
    expect(profilingGermanyPatchSchema.safeParse({ kids: Array(21).fill('age_0_6') }).success).toBe(false)
  })
})

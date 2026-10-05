import { describe, it, expect } from 'vitest'
import { isGermanPathway } from '../src/onboarding.ts'
import {
  profilingSteps, profilingMissing, DESIRED_WORK_TYPES, RELATIONSHIP_TAGS, isDubai,
  profilingElsewherePatchSchema, profilingGermanyPatchSchema,
  type ProfilingAnswers, type RelationshipTag, type ProfilingBranch,
} from '../src/profiling.ts'

const blank = (): ProfilingAnswers => ({
  languages: null, yearlyIncomeRange: null, qualificationLevel: null, occupation: null,
  relationshipStatus: null, kids: [], partner: null, desiredWorkType: null,
  futureWorkSector: null, futureWorkReady: null, futureWorkOffering: null, futureWorkIdea: null,
  futureWorkBusinessActivities: null, futureWorkPriorities: null,
  primaryCity: null, secondaryCities: [], gwcMatch: false,
})
const partner = (over: Partial<NonNullable<ProfilingAnswers['partner']>> = {}) => ({
  languages: null, yearlyIncomeRange: null, qualificationLevel: null, occupation: null, ...over,
})

const TAG_SETS: RelationshipTag[][] = [
  ['single'], ['partner'], ['family'], ['kids'], ['kids', 'partner'], ['kids', 'family'], ['partner', 'family', 'kids'],
]

describe('profilingSteps', () => {
  for (const branch of ['germany', 'elsewhere'] as ProfilingBranch[]) {
    for (const tags of TAG_SETS) {
      for (const work of DESIRED_WORK_TYPES) {
        it(`${branch} / ${tags.join('+')} / ${work}`, () => {
          const steps = profilingSteps(branch, { ...blank(), gwcMatch: true, relationshipStatus: tags, desiredWorkType: work })
          expect(steps.at(-1)).toBe('review')
          expect(steps.includes('kids')).toBe(tags.includes('kids'))
          expect(steps.includes('partner-languages')).toBe(tags.includes('partner') || tags.includes('family'))
          // Q7 is German-only.
          expect(steps.some((s) => s.startsWith('work-'))).toBe(branch === 'germany')
          if (branch === 'germany') expect(steps.indexOf('relationship')).toBeLessThan(steps.indexOf('work-type'))
        })
      }
    }
  }

  it('orders the German questions as the business description does', () => {
    const steps = profilingSteps('germany', { ...blank(), relationshipStatus: ['single'] })
    expect(steps).toEqual([
      'settling', 'languages', 'qualification', 'occupation', 'income', 'relationship', 'work-type', 'review',
    ])
  })

  it('orders each Q7 path as the business description does', () => {
    const path = (work: (typeof DESIRED_WORK_TYPES)[number]) =>
      profilingSteps('germany', { ...blank(), relationshipStatus: ['single'], desiredWorkType: work })
        .filter((s) => s.startsWith('work-') && s !== 'work-type')
    expect(path('employee')).toEqual(['work-industry', 'work-ready'])
    expect(path('freelance')).toEqual(['work-offering', 'work-industry', 'work-idea'])
    expect(path('business_owner')).toEqual(['work-industry', 'work-activities'])
    expect(path('own_business')).toEqual(['work-offering', 'work-industry', 'work-idea'])
    // "I am not sure yet" has the statements and no industry.
    expect(path('not_sure')).toEqual(['work-priorities'])
  })

  it('never asks kids or partner questions for "single"', () => {
    const steps = profilingSteps('germany', { ...blank(), relationshipStatus: ['single'] })
    expect(steps).not.toContain('kids')
    expect(steps.some((s) => s.startsWith('partner-'))).toBe(false)
  })

  describe('settling (Q1), the member\'s own — the partner starts at Q2', () => {
    it('"please help" shows an information screen and asks nothing more', () => {
      const steps = profilingSteps('germany', { ...blank(), settlingStatus: 'need_help' })
      expect(steps.slice(0, 3)).toEqual(['settling', 'settling-info', 'languages'])
      expect(steps).not.toContain('settling-place')
    })

    it('"yes" asks for the place, and only Dubai adds the working-duration question', () => {
      const berlin = profilingSteps('germany', { ...blank(), settlingStatus: 'know_where', settlingCountry: 'DE', settlingCity: 'Berlin' })
      expect(berlin.slice(0, 3)).toEqual(['settling', 'settling-place', 'languages'])
      const dubai = profilingSteps('germany', { ...blank(), settlingStatus: 'know_where', settlingCountry: 'AE', settlingCity: ' dubai ' })
      expect(dubai.slice(0, 4)).toEqual(['settling', 'settling-place', 'settling-work', 'languages'])
      expect(isDubai('AE', 'Dubai')).toBe(true)
      expect(isDubai('AE', 'Sharjah')).toBe(false)
      expect(isDubai('DE', 'Dubai')).toBe(false)
    })

    it('the partner block is languages, qualification, occupation, income — never settling', () => {
      const a = { ...blank(), settlingStatus: 'know_where' as const, settlingCountry: 'AE', settlingCity: 'Dubai', relationshipStatus: ['partner' as const] }
      const steps = profilingSteps('germany', a)
      const start = steps.indexOf('partner-languages')
      expect(steps.slice(start, start + 4)).toEqual(['partner-languages', 'partner-qualification', 'partner-occupation', 'partner-income'])
      expect(steps.some((x) => x.startsWith('partner-settling'))).toBe(false)
      // Counter-assertion: the member's own settling, Dubai follow-up included, is still asked.
      expect(steps.slice(0, 4)).toEqual(['settling', 'settling-place', 'settling-work', 'languages'])
    })
  })

  describe('the non-German branch', () => {
    it('with no GWC city goes from the cities straight to the review', () => {
      expect(profilingSteps('elsewhere', { ...blank(), primaryCity: { country: 'FR', city: 'Paris' } })).toEqual(['cities', 'review'])
    })

    it('with a GWC city asks Q6 and its sub-flows, but never Q7', () => {
      const steps = profilingSteps('elsewhere', { ...blank(), gwcMatch: true, relationshipStatus: ['kids', 'partner'] })
      expect(steps[0]).toBe('cities')
      expect(steps).toContain('relationship')
      expect(steps).toContain('kids')
      expect(steps).toContain('partner-income')
      expect(steps.some((s) => s.startsWith('work-'))).toBe(false)
    })
  })
})

describe('profilingMissing', () => {
  it('lists exactly the unanswered applicable steps', () => {
    const a = { ...blank(), settlingStatus: 'need_help' as const, languages: ['en'] }
    expect(profilingMissing('germany', a)).toEqual(['qualification', 'occupation', 'income', 'relationship', 'work-type'])
  })

  it('is empty for a fully answered "single" German member on the employee path', () => {
    const a: ProfilingAnswers = {
      ...blank(), settlingStatus: 'need_help', languages: ['de'], yearlyIncomeRange: 'over_1m',
      qualificationLevel: 'masters_degree', occupation: 'engineer', relationshipStatus: ['single'],
      desiredWorkType: 'employee', futureWorkSector: 'automotive_transportation', futureWorkReady: false,
    }
    expect(profilingMissing('germany', a)).toEqual([])
  })

  it('asks a Business Owner for the industry and at least one activity, and a not-sure member for a statement only', () => {
    const base = { ...blank(), relationshipStatus: ['single' as const] }
    expect(profilingMissing('germany', { ...base, desiredWorkType: 'business_owner' })).toEqual(
      expect.arrayContaining(['work-industry', 'work-activities']))
    expect(profilingMissing('germany', { ...base, desiredWorkType: 'business_owner', futureWorkBusinessActivities: [] })).toContain('work-activities')
    const notSure = profilingMissing('germany', { ...base, desiredWorkType: 'not_sure' })
    expect(notSure).toContain('work-priorities')
    expect(notSure).not.toContain('work-industry')
  })

  it('treats an empty list and unanswered choices as unanswered', () => {
    const a: ProfilingAnswers = { ...blank(), relationshipStatus: ['single'], languages: [], desiredWorkType: 'not_sure', futureWorkPriorities: [] }
    const missing = profilingMissing('germany', a)
    expect(missing).toContain('languages')
    expect(missing).toContain('work-priorities')
  })

  it('ignores an answer whose step no longer applies (kids after the tag is removed)', () => {
    const a = { ...blank(), gwcMatch: true, relationshipStatus: ['partner' as const], kids: ['age_0_6' as const] }
    expect(profilingSteps('elsewhere', a)).not.toContain('kids')
    expect(profilingMissing('elsewhere', a)).not.toContain('kids')
  })

  it('requires the working duration for a Dubai place and nothing more for another city', () => {
    const berlin = { ...blank(), settlingStatus: 'know_where' as const, settlingCountry: 'DE', settlingCity: 'Berlin' }
    expect(profilingMissing('germany', berlin)).not.toContain('settling-work')
    expect(profilingMissing('germany', { ...berlin, settlingCountry: 'AE', settlingCity: 'Dubai' })).toContain('settling-work')
  })

  it('asks the non-German branch for the cities, then Q6 and a partner only after a GWC match', () => {
    expect(profilingMissing('elsewhere', { ...blank(), relationshipStatus: ['partner'] })).toEqual(['cities'])
    expect(profilingMissing('elsewhere', { ...blank(), gwcMatch: true, primaryCity: { country: 'AE', city: 'Dubai' }, relationshipStatus: ['partner'] })).toEqual([
      'partner-languages', 'partner-qualification', 'partner-occupation', 'partner-income',
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

  it('takes the new answers: duration bands, activities, several statements, both new incomes', () => {
    expect(profilingGermanyPatchSchema.safeParse({ settlingWorkDuration: 'over_10' }).success).toBe(true)
    expect(profilingGermanyPatchSchema.safeParse({ settlingWorkDuration: 'twelve' }).success).toBe(false)
    expect(profilingGermanyPatchSchema.safeParse({ futureWorkBusinessActivities: ['produce', 'sales'] }).success).toBe(true)
    expect(profilingGermanyPatchSchema.safeParse({ futureWorkBusinessActivities: [] }).success).toBe(false)
    expect(profilingGermanyPatchSchema.safeParse({ futureWorkPriorities: ['family_time', 'balance_lifestyle'] }).success).toBe(true)
    expect(profilingGermanyPatchSchema.safeParse({ futureWorkPriorities: [] }).success).toBe(false)
    expect(profilingGermanyPatchSchema.safeParse({ yearlyIncomeRange: 'over_1m' }).success).toBe(true)
    // The partner is not asked where they will settle (revision 6): the key is refused, not ignored.
    expect(profilingGermanyPatchSchema.safeParse({ partner: { settlingStatus: 'need_help' } }).success).toBe(false)
    expect(profilingGermanyPatchSchema.safeParse({ partner: { occupation: 'student' } }).success).toBe(true)
  })
})

describe('the German pathway countries', () => {
  it('are Germany, Austria and Switzerland; everything else, and no value, is non-German', () => {
    for (const code of ['DE', 'AT', 'CH']) expect(isGermanPathway(code)).toBe(true)
    for (const code of ['FR', 'AE', 'US', 'LI', 'de', '', null, undefined]) expect(isGermanPathway(code)).toBe(false)
  })
})

import { z } from 'zod'

/**
 * Onboarding Phase 2 (feature 013): a mandatory questionnaire that begins the
 * moment a membership application is approved and gates every other member
 * route until it is complete — the same mechanism `onboarding.ts`'s
 * `ONBOARDING_STEPS` already anticipates via `GERMANY`.
 *
 * The branch is decided once, from `members.country_of_residence`, and never
 * recomputed (server/migrations/032_profiling.sql). Everything below is
 * shared so neither client re-implements the branch, the choice lists, or
 * completion — they only render what `GET /profiling/status` says and submit
 * what `PATCH /profiling` accepts.
 */

export const SETTLING_STATUSES = Object.freeze(['know_where', 'need_help'] as const)

export const QUALIFICATION_LEVELS = Object.freeze([
  'no_formal_qualification',
  'secondary_school',
  'diploma_certificate',
  'associate_degree',
  'bachelors_degree',
  'masters_degree',
  'doctorate',
  'professional_qualification',
] as const)

export const OCCUPATIONS = Object.freeze([
  'student',
  'unemployed',
  'self_employed_business_owner',
  'government_employee',
  'private_sector_employee',
  'teacher_educator',
  'healthcare_professional',
  'engineer',
  'it_software_professional',
  'accountant_finance_professional',
  'lawyer_legal_professional',
  'sales_marketing_professional',
  'consultant',
  'homemaker',
  'retired',
  'freelancer',
  'other',
] as const)

/**
 * Q7 (business description): Employee, Freelancer, Business Owner, Build My
 * Own Business, "I am not sure yet". `freelance` and `own_business` predate
 * `business_owner` and keep their stored values.
 */
export const DESIRED_WORK_TYPES = Object.freeze([
  'employee',
  'freelance',
  'business_owner',
  'own_business',
  'not_sure',
] as const)

/** Q3 — yearly revenue / salary range, asked of the member and of a partner. */
export const YEARLY_INCOME_RANGES = Object.freeze(['up_to_50k', '50k_to_100k', 'over_100k'] as const)

/** Q6 — multi-select on both branches. `single` is exclusive (see `relationshipTagsSchema`). */
export const RELATIONSHIP_TAGS = Object.freeze(['single', 'partner', 'family', 'kids'] as const)

/** The ranges overlap at their edges exactly as the business description states them. */
export const KID_AGE_RANGES = Object.freeze(['age_0_6', 'age_6_14', 'age_14_18', 'age_18_plus'] as const)

export const MAX_KIDS = 20

/** The statements offered when `desiredWorkType = 'not_sure'` — the member picks one (FR-011). */
export const FUTURE_WORK_PRIORITIES = Object.freeze([
  'family_time',
  'balance_lifestyle',
  'wealth_reputation',
] as const)

/**
 * Q7's "Industry / Business Selection", asked on every path. A fixed list from
 * the business description (a dropdown), stored as these codes; the label is
 * the client's, per locale.
 */
export const INDUSTRIES = Object.freeze([
  'technology_it', 'finance_banking', 'real_estate', 'construction_engineering', 'retail_ecommerce',
  'hospitality_tourism', 'food_beverage', 'healthcare_pharma', 'education_training', 'manufacturing_industrial',
  'automotive_transportation', 'logistics_supply_chain', 'consulting_professional', 'legal_services',
  'marketing_advertising', 'media_entertainment', 'government_public', 'energy_utilities',
  'telecommunications', 'general_sales', 'other',
] as const)
export type Industry = (typeof INDUSTRIES)[number]

/**
 * A deliberately short, common-language list rather than the full ISO 639
 * set: the dropdown is searchable, not exhaustive, and the club's own
 * membership is concentrated in a small number of languages. Extend as
 * needed — this is reference data, not a fixed enum baked into a migration.
 */
export type Language = { code: string; en: string; de: string }
export const LANGUAGES: readonly Language[] = [
  { code: 'ar', en: 'Arabic', de: 'Arabisch' },
  { code: 'de', en: 'German', de: 'Deutsch' },
  { code: 'en', en: 'English', de: 'Englisch' },
  { code: 'es', en: 'Spanish', de: 'Spanisch' },
  { code: 'fa', en: 'Persian', de: 'Persisch' },
  { code: 'fr', en: 'French', de: 'Französisch' },
  { code: 'hi', en: 'Hindi', de: 'Hindi' },
  { code: 'it', en: 'Italian', de: 'Italienisch' },
  { code: 'ja', en: 'Japanese', de: 'Japanisch' },
  { code: 'ko', en: 'Korean', de: 'Koreanisch' },
  { code: 'nl', en: 'Dutch', de: 'Niederländisch' },
  { code: 'pl', en: 'Polish', de: 'Polnisch' },
  { code: 'pt', en: 'Portuguese', de: 'Portugiesisch' },
  { code: 'ru', en: 'Russian', de: 'Russisch' },
  { code: 'tr', en: 'Turkish', de: 'Türkisch' },
  { code: 'uk', en: 'Ukrainian', de: 'Ukrainisch' },
  { code: 'ur', en: 'Urdu', de: 'Urdu' },
  { code: 'zh', en: 'Chinese', de: 'Chinesisch' },
]

export const PROFILING_BRANCHES = Object.freeze(['germany', 'elsewhere'] as const)
export const PROFILING_OUTCOMES = Object.freeze(['in_person_meeting', 'gwc_city_match'] as const)

export type ProfilingBranch = (typeof PROFILING_BRANCHES)[number]
export type YearlyIncomeRange = (typeof YEARLY_INCOME_RANGES)[number]
export type RelationshipTag = (typeof RELATIONSHIP_TAGS)[number]
export type KidAgeRange = (typeof KID_AGE_RANGES)[number]
export type DesiredWorkType = (typeof DESIRED_WORK_TYPES)[number]
export type ProfilingOutcome = (typeof PROFILING_OUTCOMES)[number]

const isoCountry = z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code')

export const citySlotSchema = z.object({
  country: isoCountry,
  city: z.string().trim().min(1).max(200),
})
export type CitySlot = z.infer<typeof citySlotSchema>

function sameCity(a: CitySlot, b: CitySlot): boolean {
  return a.country === b.country && a.city.trim().toLowerCase() === b.city.trim().toLowerCase()
}

/**
 * The designated cities a client can offer as a dropdown, per country
 * (`GET /profiling/gwc-cities`). Deliberately just `{ country, city }` pairs —
 * the same shape a client submits — rather than the `id`/`created_at` the
 * server keeps internally for matching (research R4): a client picks a city,
 * never a row.
 */
export const gwcCitiesResponseSchema = z.array(citySlotSchema)

/**
 * The partner answers the German questionnaire without Q1 (settling), Q6 or
 * Q7: languages, income, qualification, occupation — see spec.md Assumptions.
 */
export const partnerAnswersSchema = z.object({
  languages: z.array(z.string()).nullable(),
  yearlyIncomeRange: z.enum(YEARLY_INCOME_RANGES).nullable(),
  qualificationLevel: z.enum(QUALIFICATION_LEVELS).nullable(),
  occupation: z.enum(OCCUPATIONS).nullable(),
})
export type PartnerAnswers = z.infer<typeof partnerAnswersSchema>

export const profilingStatusSchema = z.object({
  branch: z.enum(PROFILING_BRANCHES),
  completed: z.boolean(),
  outcome: z.enum(PROFILING_OUTCOMES).nullable(),
  matchedCity: citySlotSchema.nullable(),
  answers: z.object({
    settlingStatus: z.enum(SETTLING_STATUSES).nullable(),
    languages: z.array(z.string()).nullable(),
    yearlyIncomeRange: z.enum(YEARLY_INCOME_RANGES).nullable(),
    qualificationLevel: z.enum(QUALIFICATION_LEVELS).nullable(),
    occupation: z.enum(OCCUPATIONS).nullable(),
    // Q6 — both branches.
    relationshipStatus: z.array(z.enum(RELATIONSHIP_TAGS)).nullable(),
    kids: z.array(z.enum(KID_AGE_RANGES)),
    partner: partnerAnswersSchema.nullable(),
    desiredWorkType: z.enum(DESIRED_WORK_TYPES).nullable(),
    // Q7 follow-up (FR-009–FR-011): present only for the branch desiredWorkType selects.
    futureWorkSector: z.enum(INDUSTRIES).nullable(),
    futureWorkReady: z.boolean().nullable(),
    futureWorkOffering: z.string().nullable(),
    futureWorkIdea: z.string().nullable(),
    futureWorkPriority: z.enum(FUTURE_WORK_PRIORITIES).nullable(),
    primaryCity: citySlotSchema.nullable(),
    secondaryCities: z.array(citySlotSchema),
  }),
})
export type ProfilingStatus = z.infer<typeof profilingStatusSchema>

const relationshipTagsSchema = z.array(z.enum(RELATIONSHIP_TAGS)).min(1).refine(
  (tags) => new Set(tags).size === tags.length && (!tags.includes('single') || tags.length === 1),
  { message: '"single" cannot be combined with another tag' },
)

/** Fields either branch may send (Q6 and its sub-flows). */
const sharedPatchFields = {
  relationshipStatus: relationshipTagsSchema.optional(),
  // Replaces the whole list: one entry per kid, so the count is the length.
  kids: z.array(z.enum(KID_AGE_RANGES)).min(1).max(MAX_KIDS).optional(),
  partner: z.object({
    languages: z.array(z.string()).min(1).optional(),
    yearlyIncomeRange: z.enum(YEARLY_INCOME_RANGES).optional(),
    qualificationLevel: z.enum(QUALIFICATION_LEVELS).optional(),
    occupation: z.enum(OCCUPATIONS).optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, { message: 'give at least one partner answer' }).optional(),
}

const nonEmpty = (body: object) => Object.keys(body).length > 0

/**
 * `branch = 'germany'` — any non-empty subset; the server merges given
 * fields. `.strict()` so a body carrying an elsewhere-branch field (or any
 * other unknown key) fails validation instead of being silently dropped —
 * that mismatch is meaningful (spec.md's VALIDATION_FAILED case), not noise.
 * Saving never completes profiling: `POST /profiling/submit` does (research R10).
 */
export const profilingGermanyPatchSchema = z.object({
  settlingStatus: z.enum(SETTLING_STATUSES).optional(),
  languages: z.array(z.string()).min(1).optional(),
  yearlyIncomeRange: z.enum(YEARLY_INCOME_RANGES).optional(),
  qualificationLevel: z.enum(QUALIFICATION_LEVELS).optional(),
  occupation: z.enum(OCCUPATIONS).optional(),
  desiredWorkType: z.enum(DESIRED_WORK_TYPES).optional(),
  // Q7 follow-up — send the field(s) matching the CURRENT desiredWorkType (the
  // one already on the row, or the one given in this same call).
  futureWorkSector: z.enum(INDUSTRIES).optional(),
  futureWorkReady: z.boolean().optional(),
  futureWorkOffering: z.string().trim().min(1).max(500).optional(),
  futureWorkIdea: z.string().trim().min(1).max(1000).optional(),
  futureWorkPriority: z.enum(FUTURE_WORK_PRIORITIES).optional(),
  ...sharedPatchFields,
}).strict().refine(nonEmpty, { message: 'give at least one answer' })

/**
 * `branch = 'elsewhere'` — the cities travel as a unit (a primary and up to
 * two distinct secondaries, replacing what was saved), alongside the shared
 * Q6 fields. The GWC match is not computed here; submit does that.
 */
export const profilingElsewherePatchSchema = z.object({
  primaryCity: citySlotSchema.optional(),
  secondaryCities: z.array(citySlotSchema).max(2).optional(),
  ...sharedPatchFields,
}).strict().refine(nonEmpty, { message: 'give at least one answer' })
  .refine((body) => body.secondaryCities === undefined || body.primaryCity !== undefined, {
    message: 'secondary cities are sent together with the primary city',
  })
  .refine((body) => {
    const all = [...(body.primaryCity ? [body.primaryCity] : []), ...(body.secondaryCities ?? [])]
    return all.every((slot, i) => all.findIndex((other) => sameCity(slot, other)) === i)
  }, { message: 'the primary and secondary cities must be distinct' })

export const profilingPatchRequestSchema = z.union([
  profilingGermanyPatchSchema,
  profilingElsewherePatchSchema,
])
export type ProfilingGermanyPatch = z.infer<typeof profilingGermanyPatchSchema>
export type ProfilingElsewherePatch = z.infer<typeof profilingElsewherePatchSchema>
export type ProfilingPatchRequest = z.infer<typeof profilingPatchRequestSchema>

/**
 * Keys only one branch may send. Q6's fields belong to both, so a body
 * carrying only those is valid for either branch.
 */
export const ELSEWHERE_ONLY_KEYS = Object.freeze(['primaryCity', 'secondaryCities'] as const)

// ---------------------------------------------------------------------------
// The step engine
// ---------------------------------------------------------------------------

export type ProfilingAnswers = ProfilingStatus['answers']

export type ProfilingStepId =
  | 'settling' | 'languages' | 'income' | 'qualification' | 'occupation'
  | 'cities'
  | 'relationship' | 'kids'
  | 'partner-languages' | 'partner-income'
  | 'partner-qualification' | 'partner-occupation'
  | 'work-type' | 'work-offering' | 'work-industry' | 'work-idea' | 'work-ready' | 'work-priorities'
  | 'review'

const filled = (value: string | null | undefined) => value != null && value.trim() !== ''
const nonEmptyList = (value: readonly unknown[] | null | undefined) => value != null && value.length > 0

/**
 * The one definition of which questions apply, in what order, and whether each
 * is answered. The server's submit check and both clients' Next/Back/review
 * use it, so they cannot disagree (Constitution I, FR-034). A step that no
 * longer applies (kids after the tag is removed) simply is not in the list —
 * its stored value is discarded by the server on save, never consulted here.
 */
const ANSWERED: Record<Exclude<ProfilingStepId, 'review'>, (a: ProfilingAnswers) => boolean> = {
  settling: (a) => a.settlingStatus !== null,
  languages: (a) => nonEmptyList(a.languages),
  income: (a) => a.yearlyIncomeRange !== null,
  qualification: (a) => a.qualificationLevel !== null,
  occupation: (a) => a.occupation !== null,
  cities: (a) => a.primaryCity !== null,
  relationship: (a) => nonEmptyList(a.relationshipStatus),
  kids: (a) => a.kids.length > 0,
  'partner-languages': (a) => nonEmptyList(a.partner?.languages),
  'partner-income': (a) => a.partner?.yearlyIncomeRange != null,
  'partner-qualification': (a) => a.partner?.qualificationLevel != null,
  'partner-occupation': (a) => a.partner?.occupation != null,
  'work-type': (a) => a.desiredWorkType !== null,
  'work-offering': (a) => filled(a.futureWorkOffering),
  'work-industry': (a) => filled(a.futureWorkSector),
  'work-idea': (a) => filled(a.futureWorkIdea),
  'work-ready': (a) => a.futureWorkReady !== null,
  'work-priorities': (a) => a.futureWorkPriority !== null,
}

const WORK_FOLLOW_UPS: Record<DesiredWorkType, readonly ProfilingStepId[]> = {
  employee: ['work-industry', 'work-ready'],
  freelance: ['work-offering', 'work-industry', 'work-idea'],
  business_owner: ['work-industry', 'work-idea'],
  own_business: ['work-offering', 'work-industry', 'work-idea'],
  not_sure: ['work-priorities', 'work-industry'],
}

export function profilingSteps(branch: ProfilingBranch, answers: ProfilingAnswers): ProfilingStepId[] {
  const tags = answers.relationshipStatus ?? []
  const steps: ProfilingStepId[] = branch === 'germany'
    ? ['settling', 'languages', 'income', 'qualification', 'occupation']
    : ['cities']
  steps.push('relationship')
  if (tags.includes('kids')) steps.push('kids')
  if (tags.includes('partner') || tags.includes('family')) {
    steps.push('partner-languages', 'partner-income', 'partner-qualification', 'partner-occupation')
  }
  // Q7 is German-only (business description: the non-German path ends at Q6).
  if (branch === 'germany') {
    steps.push('work-type')
    if (answers.desiredWorkType) steps.push(...WORK_FOLLOW_UPS[answers.desiredWorkType])
  }
  steps.push('review')
  return steps
}

/** The applicable steps (never `review`) that have no valid answer yet. */
export function profilingMissing(branch: ProfilingBranch, answers: ProfilingAnswers): ProfilingStepId[] {
  return profilingSteps(branch, answers).filter(
    (step): step is Exclude<ProfilingStepId, 'review'> => step !== 'review' && !ANSWERED[step](answers),
  )
}

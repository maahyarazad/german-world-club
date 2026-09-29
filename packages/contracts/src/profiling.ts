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

export const DESIRED_WORK_TYPES = Object.freeze([
  'employee',
  'freelance',
  'own_business',
  'not_sure',
] as const)

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

export const profilingStatusSchema = z.object({
  branch: z.enum(PROFILING_BRANCHES),
  completed: z.boolean(),
  outcome: z.enum(PROFILING_OUTCOMES).nullable(),
  matchedCity: citySlotSchema.nullable(),
  answers: z.object({
    settlingStatus: z.enum(SETTLING_STATUSES).nullable(),
    languages: z.array(z.string()).nullable(),
    qualificationLevel: z.enum(QUALIFICATION_LEVELS).nullable(),
    occupation: z.enum(OCCUPATIONS).nullable(),
    desiredWorkType: z.enum(DESIRED_WORK_TYPES).nullable(),
    primaryCity: citySlotSchema.nullable(),
    secondaryCities: z.array(citySlotSchema),
  }),
})
export type ProfilingStatus = z.infer<typeof profilingStatusSchema>

/**
 * `branch = 'germany'` — any non-empty subset; the server merges given
 * fields. `.strict()` so a body carrying an elsewhere-branch field (or any
 * other unknown key) fails validation instead of being silently dropped —
 * that mismatch is meaningful (spec.md's VALIDATION_FAILED case), not noise.
 */
export const profilingGermanyPatchSchema = z.object({
  settlingStatus: z.enum(SETTLING_STATUSES).optional(),
  languages: z.array(z.string()).min(1).optional(),
  qualificationLevel: z.enum(QUALIFICATION_LEVELS).optional(),
  occupation: z.enum(OCCUPATIONS).optional(),
  desiredWorkType: z.enum(DESIRED_WORK_TYPES).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, { message: 'give at least one answer' })

/** `branch = 'elsewhere'` — submitted together; 0–2 distinct secondary cities. */
export const profilingElsewherePatchSchema = z.object({
  primaryCity: citySlotSchema,
  secondaryCities: z.array(citySlotSchema).max(2).default([]),
}).strict().refine((body) => {
  const all = [body.primaryCity, ...body.secondaryCities]
  return all.every((slot, i) => all.findIndex((other) => sameCity(slot, other)) === i)
}, { message: 'the primary and secondary cities must be distinct' })

export const profilingPatchRequestSchema = z.union([
  profilingGermanyPatchSchema,
  profilingElsewherePatchSchema,
])
export type ProfilingGermanyPatch = z.infer<typeof profilingGermanyPatchSchema>
export type ProfilingElsewherePatch = z.infer<typeof profilingElsewherePatchSchema>
export type ProfilingPatchRequest = z.infer<typeof profilingPatchRequestSchema>

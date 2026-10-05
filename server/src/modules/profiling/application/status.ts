import { query } from '../../../db/query.ts'
import { isGermanPathway } from '@gwc/contracts/onboarding'
import type { GwcApp } from '../../../app.ts'
import type { ProfilingStatus, ProfilingBranch, CitySlot, PartnerAnswers as ProfilingAnswersPartner } from '@gwc/contracts/profiling'

type PartnerRow = {
  settling_status: string | null
  settling_country: string | null
  settling_city: string | null
  settling_work_duration: string | null
  languages: string[] | null
  yearly_income_range: string | null
  qualification_level: string | null
  occupation: string | null
}

type Row = {
  country_of_residence: string | null
  branch: ProfilingBranch | null
  settling_status: string | null
  settling_country: string | null
  settling_city: string | null
  settling_work_duration: string | null
  languages: string[] | null
  yearly_income_range: string | null
  relationship_tags: string[] | null
  qualification_level: string | null
  occupation: string | null
  desired_work_type: string | null
  future_work_sector: string | null
  future_work_ready: boolean | null
  future_work_offering: string | null
  future_work_idea: string | null
  future_work_priorities: string[] | null
  future_work_business_activities: string[] | null
  matched_gwc_city_id: string | null
  primary_city_country: string | null
  primary_city_name: string | null
  secondary_city_1_country: string | null
  secondary_city_1_name: string | null
  secondary_city_2_country: string | null
  secondary_city_2_name: string | null
  outcome: 'in_person_meeting' | 'gwc_city_match' | null
  matched_country: string | null
  matched_city: string | null
  completed_at: string | null
}

function citySlot(country: string | null, city: string | null): CitySlot | null {
  return country && city ? { country, city } : null
}

/**
 * Where a member stands, derived from the facts every time — the same
 * discipline `onboarding/application/status.ts` already uses. `branch` comes
 * from the row once one exists; before that, it is computed from
 * `country_of_residence` without writing anything (research R3: the branch is
 * only frozen on the first answer, in `submit.ts`).
 */
export async function loadProfilingStatus(
  app: GwcApp,
  { memberId, signal }: { memberId: string; signal?: AbortSignal },
): Promise<ProfilingStatus> {
  const { rows } = await query<Row>(
    app.pg,
    `SELECT m.country_of_residence,
            p.branch, p.settling_status, p.settling_country, p.settling_city, p.settling_work_duration,
            p.languages, p.yearly_income_range, p.relationship_tags,
            p.qualification_level,
            p.occupation, p.desired_work_type,
            p.future_work_sector, p.future_work_ready, p.future_work_offering,
            p.future_work_idea, p.future_work_priorities, p.future_work_business_activities,
            p.matched_gwc_city_id,
            p.primary_city_country, p.primary_city_name,
            p.secondary_city_1_country, p.secondary_city_1_name,
            p.secondary_city_2_country, p.secondary_city_2_name,
            p.outcome, p.completed_at,
            g.country AS matched_country, g.city AS matched_city
       FROM members m
       LEFT JOIN member_profiling p ON p.member_id = m.id
       LEFT JOIN gwc_cities g ON g.id = p.matched_gwc_city_id
      WHERE m.id = $1`,
    [memberId],
    { signal },
  )
  const row = rows[0]
  const [kids, partner] = await Promise.all([
    query<{ age_range: string }>(
      app.pg,
      'SELECT age_range FROM member_profiling_kids WHERE member_id = $1 ORDER BY position',
      [memberId],
      { signal },
    ),
    query<PartnerRow>(
      app.pg,
      `SELECT settling_status, settling_country, settling_city, settling_work_duration,
              languages, yearly_income_range, qualification_level, occupation
         FROM member_profiling_partner WHERE member_id = $1`,
      [memberId],
      { signal },
    ),
  ])
  const branch: ProfilingBranch = row?.branch ?? (isGermanPathway(row?.country_of_residence) ? 'germany' : 'elsewhere')

  const secondaryCities: CitySlot[] = [
    citySlot(row?.secondary_city_1_country ?? null, row?.secondary_city_1_name ?? null),
    citySlot(row?.secondary_city_2_country ?? null, row?.secondary_city_2_name ?? null),
  ].filter((slot): slot is CitySlot => slot !== null)

  return {
    branch,
    completed: row?.completed_at != null,
    outcome: row?.outcome ?? null,
    matchedCity: citySlot(row?.matched_country ?? null, row?.matched_city ?? null),
    answers: {
      settlingStatus: (row?.settling_status as ProfilingStatus['answers']['settlingStatus']) ?? null,
      settlingCountry: row?.settling_country ?? null,
      settlingCity: row?.settling_city ?? null,
      settlingWorkDuration: (row?.settling_work_duration as ProfilingStatus['answers']['settlingWorkDuration']) ?? null,
      languages: row?.languages ?? null,
      yearlyIncomeRange: (row?.yearly_income_range as ProfilingStatus['answers']['yearlyIncomeRange']) ?? null,
      relationshipStatus: (row?.relationship_tags as ProfilingStatus['answers']['relationshipStatus']) ?? null,
      kids: kids.rows.map((k) => k.age_range) as ProfilingStatus['answers']['kids'],
      partner: partner.rows[0]
        ? {
            settlingStatus: partner.rows[0].settling_status as ProfilingAnswersPartner['settlingStatus'],
            settlingCountry: partner.rows[0].settling_country,
            settlingCity: partner.rows[0].settling_city,
            settlingWorkDuration: partner.rows[0].settling_work_duration as ProfilingAnswersPartner['settlingWorkDuration'],
            languages: partner.rows[0].languages,
            yearlyIncomeRange: partner.rows[0].yearly_income_range as ProfilingAnswersPartner['yearlyIncomeRange'],
            qualificationLevel: partner.rows[0].qualification_level as ProfilingAnswersPartner['qualificationLevel'],
            occupation: partner.rows[0].occupation as ProfilingAnswersPartner['occupation'],
          }
        : null,
      qualificationLevel: (row?.qualification_level as ProfilingStatus['answers']['qualificationLevel']) ?? null,
      occupation: (row?.occupation as ProfilingStatus['answers']['occupation']) ?? null,
      desiredWorkType: (row?.desired_work_type as ProfilingStatus['answers']['desiredWorkType']) ?? null,
      futureWorkSector: (row?.future_work_sector as ProfilingStatus['answers']['futureWorkSector']) ?? null,
      futureWorkReady: row?.future_work_ready ?? null,
      futureWorkOffering: row?.future_work_offering ?? null,
      futureWorkIdea: row?.future_work_idea ?? null,
      futureWorkBusinessActivities: (row?.future_work_business_activities as ProfilingStatus['answers']['futureWorkBusinessActivities']) ?? null,
      futureWorkPriorities: (row?.future_work_priorities as ProfilingStatus['answers']['futureWorkPriorities']) ?? null,
      primaryCity: citySlot(row?.primary_city_country ?? null, row?.primary_city_name ?? null),
      secondaryCities,
      gwcMatch: row?.matched_gwc_city_id != null,
    },
  }
}

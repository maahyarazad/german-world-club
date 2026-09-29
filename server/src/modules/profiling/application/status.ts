import { query } from '../../../db/query.ts'
import { GERMANY } from '@gwc/contracts/onboarding'
import type { GwcApp } from '../../../app.ts'
import type { ProfilingStatus, ProfilingBranch, CitySlot } from '@gwc/contracts/profiling'

type Row = {
  country_of_residence: string | null
  branch: ProfilingBranch | null
  settling_status: string | null
  languages: string[] | null
  qualification_level: string | null
  occupation: string | null
  desired_work_type: string | null
  future_work_sector: string | null
  future_work_ready: boolean | null
  future_work_offering: string | null
  future_work_idea: string | null
  future_work_priorities: string[] | null
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
            p.branch, p.settling_status, p.languages, p.qualification_level,
            p.occupation, p.desired_work_type,
            p.future_work_sector, p.future_work_ready, p.future_work_offering,
            p.future_work_idea, p.future_work_priorities,
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
  const branch: ProfilingBranch = row?.branch ?? (row?.country_of_residence === GERMANY ? 'germany' : 'elsewhere')

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
      languages: row?.languages ?? null,
      qualificationLevel: (row?.qualification_level as ProfilingStatus['answers']['qualificationLevel']) ?? null,
      occupation: (row?.occupation as ProfilingStatus['answers']['occupation']) ?? null,
      desiredWorkType: (row?.desired_work_type as ProfilingStatus['answers']['desiredWorkType']) ?? null,
      futureWorkSector: row?.future_work_sector ?? null,
      futureWorkReady: row?.future_work_ready ?? null,
      futureWorkOffering: row?.future_work_offering ?? null,
      futureWorkIdea: row?.future_work_idea ?? null,
      futureWorkPriorities: (row?.future_work_priorities as ProfilingStatus['answers']['futureWorkPriorities']) ?? null,
      primaryCity: citySlot(row?.primary_city_country ?? null, row?.primary_city_name ?? null),
      secondaryCities,
    },
  }
}

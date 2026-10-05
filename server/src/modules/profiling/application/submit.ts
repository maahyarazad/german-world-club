import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { PROBLEMS } from '@gwc/contracts/errors'
import { isGermanPathway } from '@gwc/contracts/onboarding'
import {
  QUALIFICATION_LEVELS, OCCUPATIONS, DESIRED_WORK_TYPES, FUTURE_WORK_PRIORITIES, ELSEWHERE_ONLY_KEYS, isDubai,
} from '@gwc/contracts/profiling'
import { loadProfilingStatus } from './status.ts'
import { assertCityAllowed } from './cities.ts'
import type { GwcApp } from '../../../app.ts'
import type { PoolClient } from 'pg'
import type {
  ProfilingStatus, ProfilingBranch,
  ProfilingGermanyPatch, ProfilingElsewherePatch, ProfilingPatchRequest,
} from '@gwc/contracts/profiling'

const invalid = (detail: string) => forbidden(PROBLEMS.VALIDATION_FAILED, detail)

type FutureWorkField =
  | 'future_work_sector' | 'future_work_ready' | 'future_work_offering' | 'future_work_idea'
  | 'future_work_business_activities' | 'future_work_priorities'
const ALL_FUTURE_WORK_FIELDS: readonly FutureWorkField[] = [
  'future_work_sector', 'future_work_ready', 'future_work_offering', 'future_work_idea',
  'future_work_business_activities', 'future_work_priorities',
]
/**
 * Q7 follow-up: which columns each `desired_work_type` may populate. The
 * industry is asked on every path except "I am not sure yet".
 */
const FUTURE_WORK_FIELDS_FOR: Record<string, readonly FutureWorkField[]> = {
  employee: ['future_work_sector', 'future_work_ready'],
  freelance: ['future_work_offering', 'future_work_sector', 'future_work_idea'],
  own_business: ['future_work_offering', 'future_work_sector', 'future_work_idea'],
  business_owner: ['future_work_sector', 'future_work_business_activities'],
  not_sure: ['future_work_priorities'],
}

type FutureWork = {
  future_work_sector: string | null
  future_work_ready: boolean | null
  future_work_offering: string | null
  future_work_idea: string | null
  future_work_business_activities: string[] | null
  future_work_priorities: string[] | null
}

type Row = FutureWork & {
  branch: ProfilingBranch
  settling_status: string | null
  settling_country: string | null
  settling_city: string | null
  settling_work_duration: string | null
  languages: string[] | null
  yearly_income_range: string | null
  qualification_level: string | null
  occupation: string | null
  desired_work_type: string | null
  relationship_tags: string[] | null
  matched_gwc_city_id: string | null
  completed_at: string | null
}

const SHARED_KEYS = ['relationshipStatus', 'kids', 'partner']

/**
 * `PATCH /profiling`. One member_profiling row per member — the branch is
 * frozen on whichever call creates it (research R3) and every later call is
 * checked against it, never recomputed from a possibly-changed
 * `country_of_residence`.
 *
 * Saving never completes profiling (research R10): a member can go back and
 * change any answer until `POST /profiling/submit`, which is the only writer of
 * `completed_at`. Re-sending an answered field replaces it.
 */
export async function submitProfiling(
  app: GwcApp,
  { memberId, body, signal }: { memberId: string; body: ProfilingPatchRequest; signal?: AbortSignal },
): Promise<ProfilingStatus> {
  await withTransaction(app.pg, async (client: PoolClient) => {
    const select = () => client.query(
      `SELECT branch, settling_status, settling_country, settling_city, settling_work_duration,
              languages, yearly_income_range, qualification_level, occupation,
              desired_work_type, relationship_tags, matched_gwc_city_id,
              future_work_sector, future_work_ready, future_work_offering, future_work_idea,
              future_work_business_activities, future_work_priorities, completed_at
         FROM member_profiling WHERE member_id = $1 FOR UPDATE`,
      [memberId],
    )
    let row = (await select()).rows[0] as Row | undefined

    if (row?.completed_at) {
      throw forbidden(PROBLEMS.CONFLICT, 'Profiling is already complete and cannot be changed.')
    }

    if (!row) {
      const member = await client.query('SELECT country_of_residence FROM members WHERE id = $1', [memberId])
      const branch: ProfilingBranch = isGermanPathway(member.rows[0]?.country_of_residence) ? 'germany' : 'elsewhere'
      await client.query(
        'INSERT INTO member_profiling (member_id, branch) VALUES ($1, $2) ON CONFLICT (member_id) DO NOTHING',
        [memberId, branch],
      )
      row = (await select()).rows[0] as Row
    }
    const branch = row.branch

    // Q6 belongs to both branches, so only the other branch's own keys are a mismatch.
    const keys = Object.keys(body)
    const hasElsewhereKeys = keys.some((k) => (ELSEWHERE_ONLY_KEYS as readonly string[]).includes(k))
    const hasGermanyKeys = keys.some(
      (k) => !(ELSEWHERE_ONLY_KEYS as readonly string[]).includes(k) && !SHARED_KEYS.includes(k),
    )
    if ((branch === 'germany' && hasElsewhereKeys) || (branch === 'elsewhere' && hasGermanyKeys)) {
      throw invalid(`This member is on the '${branch}' branch.`)
    }

    let gwcMatched = true // the German branch always asks Q6
    if (branch === 'germany') {
      await saveGermany(client, memberId, row, body as ProfilingGermanyPatch)
    } else {
      gwcMatched = await saveElsewhere(client, memberId, row, body as ProfilingElsewherePatch)
    }
    await saveRelationship(client, memberId, row, body as ProfilingGermanyPatch & ProfilingElsewherePatch, gwcMatched)
  }, { signal })

  return loadProfilingStatus(app, { memberId, signal })
}

type Settling = {
  status: string | null
  country: string | null
  city: string | null
  duration: string | null
}

/**
 * Q1, for the member and for the partner alike. "Please help" asks nothing
 * more; "yes" asks for the place; and only Dubai adds "how long are you
 * already working". Whatever no longer applies is cleared here so a stale
 * place or duration is never kept (FR-033), and a field sent for a question
 * that is not being asked is refused rather than silently dropped.
 */
async function mergeSettling(
  client: PoolClient,
  current: Settling,
  given: { status?: string; country?: string; city?: string; duration?: string },
): Promise<Settling> {
  const status = given.status ?? current.status
  if (status !== 'know_where') {
    if (given.country !== undefined || given.city !== undefined || given.duration !== undefined) {
      throw invalid('A settling place is only given when the answer is "yes".')
    }
    return { status, country: null, city: null, duration: null }
  }
  const country = given.country ?? current.country
  // A different country makes the city that was saved under the old one meaningless.
  const city = given.city ?? (given.country !== undefined && given.country !== current.country ? null : current.city)
  if (country && city) await assertCityAllowed(client, country, city)
  if (!isDubai(country, city)) {
    if (given.duration !== undefined) throw invalid('The working duration is only asked for Dubai.')
    return { status, country, city, duration: null }
  }
  return { status, country, city, duration: given.duration ?? current.duration }
}

async function saveGermany(client: PoolClient, memberId: string, row: Row, body: ProfilingGermanyPatch) {
  const desiredWorkTypeChanged =
    body.desiredWorkType !== undefined && body.desiredWorkType !== row.desired_work_type

  // FR-022: a Q7 answer that differs from what is on the row discards that
  // row's old follow-up answers — they belonged to the choice being replaced.
  const prior: FutureWork = desiredWorkTypeChanged
    ? {
        future_work_sector: null, future_work_ready: null, future_work_offering: null,
        future_work_idea: null, future_work_business_activities: null, future_work_priorities: null,
      }
    : {
        future_work_sector: row.future_work_sector,
        future_work_ready: row.future_work_ready,
        future_work_offering: row.future_work_offering,
        future_work_idea: row.future_work_idea,
        future_work_business_activities: row.future_work_business_activities,
        future_work_priorities: row.future_work_priorities,
      }

  const settling = await mergeSettling(
    client,
    { status: row.settling_status, country: row.settling_country, city: row.settling_city, duration: row.settling_work_duration },
    { status: body.settlingStatus, country: body.settlingCountry, city: body.settlingCity, duration: body.settlingWorkDuration },
  )

  const merged = {
    languages: body.languages ?? row.languages,
    yearly_income_range: body.yearlyIncomeRange ?? row.yearly_income_range,
    qualification_level: body.qualificationLevel ?? row.qualification_level,
    occupation: body.occupation ?? row.occupation,
    desired_work_type: body.desiredWorkType ?? row.desired_work_type,
    future_work_sector: body.futureWorkSector ?? prior.future_work_sector,
    future_work_ready: body.futureWorkReady ?? prior.future_work_ready,
    future_work_offering: body.futureWorkOffering ?? prior.future_work_offering,
    future_work_idea: body.futureWorkIdea ?? prior.future_work_idea,
    future_work_business_activities: body.futureWorkBusinessActivities ?? prior.future_work_business_activities,
    future_work_priorities: body.futureWorkPriorities ?? prior.future_work_priorities,
  }

  // Defensive: the choice lists are shared with the contracts package, so this
  // can only fail if the two drift — the CHECK constraints would refuse it
  // anyway, but a clear application-level error is more useful than a raw
  // constraint-violation message reaching a client.
  for (const [value, allowed, label] of [
    [merged.qualification_level, QUALIFICATION_LEVELS, 'qualification level'],
    [merged.occupation, OCCUPATIONS, 'occupation'],
    [merged.desired_work_type, DESIRED_WORK_TYPES, 'desired work type'],
  ] as const) {
    if (value !== null && !(allowed as readonly string[]).includes(value)) {
      throw invalid(`Unknown ${label} "${value}".`)
    }
  }
  for (const value of merged.future_work_priorities ?? []) {
    if (!(FUTURE_WORK_PRIORITIES as readonly string[]).includes(value)) {
      throw invalid(`Unknown future work priority "${value}".`)
    }
  }

  // A follow-up that does not belong to the FINAL desired_work_type is a
  // contradiction the body itself introduced (FR-022's discard above already
  // resolved the stale ones) — e.g. desiredWorkType: 'employee' together with
  // futureWorkOffering. Refuse it explicitly rather than let the future-work
  // CHECK constraint (036) throw a raw constraint violation.
  const allowedFields = new Set<FutureWorkField>(
    merged.desired_work_type ? FUTURE_WORK_FIELDS_FOR[merged.desired_work_type] ?? [] : [],
  )
  for (const field of ALL_FUTURE_WORK_FIELDS) {
    const value = merged[field]
    const isEmpty = value === null || (Array.isArray(value) && value.length === 0)
    if (!allowedFields.has(field) && !isEmpty) {
      throw invalid(`"${field}" does not apply to this desired work type.`)
    }
  }

  await client.query(
    `UPDATE member_profiling SET
       settling_status = $2, settling_country = $3, settling_city = $4, settling_work_duration = $5,
       languages = $6, yearly_income_range = $7, qualification_level = $8, occupation = $9,
       desired_work_type = $10, future_work_sector = $11, future_work_ready = $12,
       future_work_offering = $13, future_work_idea = $14, future_work_business_activities = $15,
       future_work_priorities = $16
     WHERE member_id = $1`,
    [
      memberId, settling.status, settling.country, settling.city, settling.duration,
      merged.languages, merged.yearly_income_range, merged.qualification_level, merged.occupation,
      merged.desired_work_type, merged.future_work_sector, merged.future_work_ready,
      merged.future_work_offering, merged.future_work_idea, merged.future_work_business_activities,
      merged.future_work_priorities,
    ],
  )
}

/**
 * The elsewhere cities are sent as a unit and replace whatever was saved. Which
 * GWC city (if any) matches is stored now, not at submit, because it decides
 * whether Q6 and its sub-flows are asked at all. When the cities stop matching,
 * the answers only a matching member gives are deleted (FR-033).
 *
 * Returns whether the member currently has a GWC match.
 */
async function saveElsewhere(client: PoolClient, memberId: string, row: Row, body: ProfilingElsewherePatch): Promise<boolean> {
  if (!body.primaryCity) return row.matched_gwc_city_id !== null

  const slots = [body.primaryCity, ...(body.secondaryCities ?? [])]
  for (const slot of slots) await assertCityAllowed(client, slot.country, slot.city)

  // Earliest slot first (primary, then secondaries in the order given).
  const { rows: matches } = await client.query(
    `SELECT g.id
       FROM unnest($1::char(2)[], $2::text[]) WITH ORDINALITY AS s(country, city, ord)
       JOIN gwc_cities g ON g.country = s.country AND lower(g.city) = lower(s.city)
      ORDER BY s.ord
      LIMIT 1`,
    [slots.map((s) => s.country), slots.map((s) => s.city)],
  )
  const matchId = (matches[0] as { id: string } | undefined)?.id ?? null
  const secondary1 = body.secondaryCities?.[0] ?? null
  const secondary2 = body.secondaryCities?.[1] ?? null
  await client.query(
    `UPDATE member_profiling SET
       primary_city_country = $2, primary_city_name = $3,
       secondary_city_1_country = $4, secondary_city_1_name = $5,
       secondary_city_2_country = $6, secondary_city_2_name = $7,
       matched_gwc_city_id = $8
     WHERE member_id = $1`,
    [
      memberId, body.primaryCity.country, body.primaryCity.city,
      secondary1?.country ?? null, secondary1?.city ?? null,
      secondary2?.country ?? null, secondary2?.city ?? null,
      matchId,
    ],
  )
  if (matchId === null) {
    await client.query('UPDATE member_profiling SET relationship_tags = NULL WHERE member_id = $1', [memberId])
    await client.query('DELETE FROM member_profiling_kids WHERE member_id = $1', [memberId])
    await client.query('DELETE FROM member_profiling_partner WHERE member_id = $1', [memberId])
  }
  return matchId !== null
}

/**
 * Q6 and its sub-flows, both branches. Answers that no longer apply are
 * deleted in the same transaction (research R14, FR-033) so nothing stale
 * reaches submit; the children's triggers only allow that while incomplete.
 * A non-German member is only asked Q6 after a GWC city was submitted.
 */
async function saveRelationship(
  client: PoolClient,
  memberId: string,
  row: Row,
  body: Pick<ProfilingGermanyPatch, 'relationshipStatus' | 'kids' | 'partner'>,
  gwcMatched: boolean,
) {
  if (!gwcMatched && (body.relationshipStatus !== undefined || body.kids !== undefined || body.partner !== undefined)) {
    throw invalid('Relationship and family status is only asked once a GWC city has been submitted.')
  }
  const tags = body.relationshipStatus ?? row.relationship_tags ?? []
  const wantsKids = tags.includes('kids')
  const wantsPartner = tags.includes('partner') || tags.includes('family')

  if (body.kids !== undefined && !wantsKids) {
    throw invalid('Kids were given but "kids" is not selected.')
  }
  if (body.partner !== undefined && !wantsPartner) {
    throw invalid('Partner answers were given but "partner" or "family" is not selected.')
  }

  if (body.relationshipStatus !== undefined) {
    await client.query('UPDATE member_profiling SET relationship_tags = $2 WHERE member_id = $1', [memberId, tags])
    if (!wantsKids) await client.query('DELETE FROM member_profiling_kids WHERE member_id = $1', [memberId])
    if (!wantsPartner) await client.query('DELETE FROM member_profiling_partner WHERE member_id = $1', [memberId])
  }

  if (body.kids !== undefined) {
    await client.query('DELETE FROM member_profiling_kids WHERE member_id = $1', [memberId])
    await client.query(
      `INSERT INTO member_profiling_kids (member_id, position, age_range)
       SELECT $1, ord, age FROM unnest($2::text[]) WITH ORDINALITY AS k(age, ord)`,
      [memberId, body.kids],
    )
  }

  if (body.partner !== undefined) {
    const p = body.partner
    const { rows } = await client.query(
      `SELECT settling_status, settling_country, settling_city, settling_work_duration,
              languages, yearly_income_range, qualification_level, occupation
         FROM member_profiling_partner WHERE member_id = $1`,
      [memberId],
    )
    const existing = rows[0] as {
      settling_status: string | null; settling_country: string | null; settling_city: string | null
      settling_work_duration: string | null; languages: string[] | null; yearly_income_range: string | null
      qualification_level: string | null; occupation: string | null
    } | undefined

    // Read-modify-write, not COALESCE: the settling answers can be cleared by
    // the rules above, which a COALESCE could never express. The partner wizard
    // still saves one question at a time — fields not sent keep their value.
    const settling = await mergeSettling(
      client,
      {
        status: existing?.settling_status ?? null, country: existing?.settling_country ?? null,
        city: existing?.settling_city ?? null, duration: existing?.settling_work_duration ?? null,
      },
      { status: p.settlingStatus, country: p.settlingCountry, city: p.settlingCity, duration: p.settlingWorkDuration },
    )
    await client.query(
      `INSERT INTO member_profiling_partner
         (member_id, settling_status, settling_country, settling_city, settling_work_duration,
          languages, yearly_income_range, qualification_level, occupation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (member_id) DO UPDATE SET
         settling_status = EXCLUDED.settling_status, settling_country = EXCLUDED.settling_country,
         settling_city = EXCLUDED.settling_city, settling_work_duration = EXCLUDED.settling_work_duration,
         languages = EXCLUDED.languages, yearly_income_range = EXCLUDED.yearly_income_range,
         qualification_level = EXCLUDED.qualification_level, occupation = EXCLUDED.occupation`,
      [
        memberId, settling.status, settling.country, settling.city, settling.duration,
        p.languages ?? existing?.languages ?? null,
        p.yearlyIncomeRange ?? existing?.yearly_income_range ?? null,
        p.qualificationLevel ?? existing?.qualification_level ?? null,
        p.occupation ?? existing?.occupation ?? null,
      ],
    )
  }
}

import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { PROBLEMS } from '@gwc/contracts/errors'
import { GERMANY } from '@gwc/contracts/onboarding'
import {
  QUALIFICATION_LEVELS, OCCUPATIONS, DESIRED_WORK_TYPES, FUTURE_WORK_PRIORITIES,
} from '@gwc/contracts/profiling'
import { loadProfilingStatus } from './status.ts'
import type { GwcApp } from '../../../app.ts'
import type { PoolClient } from 'pg'
import type {
  ProfilingStatus, ProfilingBranch,
  ProfilingGermanyPatch, ProfilingElsewherePatch, ProfilingPatchRequest,
} from '@gwc/contracts/profiling'

const isElsewherePatch = (body: ProfilingPatchRequest): body is ProfilingElsewherePatch =>
  'primaryCity' in body

const GERMANY_FIELDS_COMPLETE = (row: {
  settling_status: string | null
  languages: string[] | null
  qualification_level: string | null
  occupation: string | null
  desired_work_type: string | null
}) =>
  row.settling_status !== null && row.languages !== null && row.qualification_level !== null
  && row.occupation !== null && row.desired_work_type !== null

type FutureWorkField =
  'future_work_sector' | 'future_work_ready' | 'future_work_offering' | 'future_work_idea' | 'future_work_priorities'
const ALL_FUTURE_WORK_FIELDS: readonly FutureWorkField[] = [
  'future_work_sector', 'future_work_ready', 'future_work_offering', 'future_work_idea', 'future_work_priorities',
]
/** Q5 follow-up (FR-009–FR-011): which columns each `desired_work_type` may populate. */
const FUTURE_WORK_FIELDS_FOR: Record<string, readonly FutureWorkField[]> = {
  employee: ['future_work_sector', 'future_work_ready'],
  freelance: ['future_work_offering', 'future_work_idea'],
  own_business: ['future_work_offering', 'future_work_idea'],
  not_sure: ['future_work_priorities'],
}

type FutureWork = {
  future_work_sector: string | null
  future_work_ready: boolean | null
  future_work_offering: string | null
  future_work_idea: string | null
  future_work_priorities: string[] | null
}

/** FR-009–FR-011: the required follow-up(s) for the current desired_work_type are all present. */
function futureWorkComplete(desiredWorkType: string | null, futureWork: FutureWork): boolean {
  if (desiredWorkType === null) return true // nothing to follow up on yet — FR-012's base-five gate handles this
  const fields = FUTURE_WORK_FIELDS_FOR[desiredWorkType]
  if (!fields) return false
  return fields.every((field) => {
    const value = futureWork[field]
    return Array.isArray(value) ? value.length > 0 : value !== null
  })
}

/**
 * `PATCH /profiling`. One member_profiling row per member, upserted — the
 * branch is frozen on whichever call creates the row (research R3) and every
 * later call is checked against it, never recomputed from a possibly-changed
 * `country_of_residence`.
 */
export async function submitProfiling(
  app: GwcApp,
  { memberId, body, signal }: { memberId: string; body: ProfilingPatchRequest; signal?: AbortSignal },
): Promise<ProfilingStatus> {
  await withTransaction(app.pg, async (client: PoolClient) => {
    const existing = await client.query(
      `SELECT branch, settling_status, languages, qualification_level, occupation, desired_work_type,
              future_work_sector, future_work_ready, future_work_offering, future_work_idea,
              future_work_priorities, completed_at
         FROM member_profiling WHERE member_id = $1 FOR UPDATE`,
      [memberId],
    )
    const row = existing.rows[0] as {
      branch: ProfilingBranch
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
      completed_at: string | null
    } | undefined

    if (row?.completed_at) {
      throw forbidden(PROBLEMS.CONFLICT, 'Profiling is already complete and cannot be changed.')
    }

    let branch: ProfilingBranch
    if (row) {
      branch = row.branch
    } else {
      const member = await client.query('SELECT country_of_residence FROM members WHERE id = $1', [memberId])
      branch = member.rows[0]?.country_of_residence === GERMANY ? 'germany' : 'elsewhere'
    }

    const bodyBranch: ProfilingBranch = isElsewherePatch(body) ? 'elsewhere' : 'germany'
    if (bodyBranch !== branch) {
      throw forbidden(PROBLEMS.VALIDATION_FAILED, `This member is on the '${branch}' branch.`)
    }

    if (branch === 'germany') {
      await submitGermany(client, memberId, row, body as ProfilingGermanyPatch)
    } else {
      await submitElsewhere(client, memberId, row !== undefined, body as ProfilingElsewherePatch)
    }
  }, { signal })

  return loadProfilingStatus(app, { memberId, signal })
}

type GermanyRow = {
  settling_status: string | null; languages: string[] | null; qualification_level: string | null
  occupation: string | null; desired_work_type: string | null
  future_work_sector: string | null; future_work_ready: boolean | null
  future_work_offering: string | null; future_work_idea: string | null
  future_work_priorities: string[] | null
}

async function submitGermany(
  client: PoolClient,
  memberId: string,
  row: GermanyRow | undefined,
  body: ProfilingGermanyPatch,
) {
  const desiredWorkTypeChanged =
    body.desiredWorkType !== undefined && body.desiredWorkType !== (row?.desired_work_type ?? null)

  // FR-022: a Q5 answer that differs from what's on the row discards that
  // row's old follow-up answers — they belonged to the choice being replaced.
  const priorFutureWork: FutureWork = desiredWorkTypeChanged
    ? {
        future_work_sector: null, future_work_ready: null, future_work_offering: null,
        future_work_idea: null, future_work_priorities: null,
      }
    : {
        future_work_sector: row?.future_work_sector ?? null,
        future_work_ready: row?.future_work_ready ?? null,
        future_work_offering: row?.future_work_offering ?? null,
        future_work_idea: row?.future_work_idea ?? null,
        future_work_priorities: row?.future_work_priorities ?? null,
      }

  const merged = {
    settling_status: body.settlingStatus ?? row?.settling_status ?? null,
    languages: body.languages ?? row?.languages ?? null,
    qualification_level: body.qualificationLevel ?? row?.qualification_level ?? null,
    occupation: body.occupation ?? row?.occupation ?? null,
    desired_work_type: body.desiredWorkType ?? row?.desired_work_type ?? null,
    future_work_sector: body.futureWorkSector ?? priorFutureWork.future_work_sector,
    future_work_ready: body.futureWorkReady ?? priorFutureWork.future_work_ready,
    future_work_offering: body.futureWorkOffering ?? priorFutureWork.future_work_offering,
    future_work_idea: body.futureWorkIdea ?? priorFutureWork.future_work_idea,
    future_work_priorities: body.futureWorkPriorities ?? priorFutureWork.future_work_priorities,
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
      throw forbidden(PROBLEMS.VALIDATION_FAILED, `Unknown ${label} "${value}".`)
    }
  }
  if (merged.future_work_priorities !== null) {
    for (const value of merged.future_work_priorities) {
      if (!(FUTURE_WORK_PRIORITIES as readonly string[]).includes(value)) {
        throw forbidden(PROBLEMS.VALIDATION_FAILED, `Unknown future work priority "${value}".`)
      }
    }
  }

  // A follow-up field that does not belong to the FINAL desired_work_type is a
  // contradiction the body itself introduced (not one FR-022's discard above
  // already resolved) — e.g. sending desiredWorkType: 'employee' together with
  // futureWorkOffering in the same call. Refuse it explicitly rather than let
  // the future-work CHECK constraint (033_profiling_future_work.sql) throw a
  // raw constraint-violation error.
  const allowedFields = new Set<FutureWorkField>(
    merged.desired_work_type ? FUTURE_WORK_FIELDS_FOR[merged.desired_work_type] ?? [] : [],
  )
  for (const field of ALL_FUTURE_WORK_FIELDS) {
    const value = merged[field]
    const isEmpty = value === null || (Array.isArray(value) && value.length === 0)
    if (!allowedFields.has(field) && !isEmpty) {
      throw forbidden(PROBLEMS.VALIDATION_FAILED, `"${field}" does not apply to this desired work type.`)
    }
  }

  const completed = GERMANY_FIELDS_COMPLETE(merged) && futureWorkComplete(merged.desired_work_type, merged)

  await client.query(
    `INSERT INTO member_profiling (
       member_id, branch, settling_status, languages, qualification_level, occupation, desired_work_type,
       future_work_sector, future_work_ready, future_work_offering, future_work_idea, future_work_priorities,
       completed_at
     ) VALUES ($1, 'germany', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $12 THEN now() ELSE NULL END)
     ON CONFLICT (member_id) DO UPDATE SET
       settling_status = EXCLUDED.settling_status,
       languages = EXCLUDED.languages,
       qualification_level = EXCLUDED.qualification_level,
       occupation = EXCLUDED.occupation,
       desired_work_type = EXCLUDED.desired_work_type,
       future_work_sector = EXCLUDED.future_work_sector,
       future_work_ready = EXCLUDED.future_work_ready,
       future_work_offering = EXCLUDED.future_work_offering,
       future_work_idea = EXCLUDED.future_work_idea,
       future_work_priorities = EXCLUDED.future_work_priorities,
       completed_at = EXCLUDED.completed_at`,
    [
      memberId, merged.settling_status, merged.languages, merged.qualification_level,
      merged.occupation, merged.desired_work_type,
      merged.future_work_sector, merged.future_work_ready, merged.future_work_offering,
      merged.future_work_idea, merged.future_work_priorities,
      completed,
    ],
  )
}

/**
 * The elsewhere branch is submitted whole (contracts/profiling-api.md): the
 * primary city is required and the up-to-two secondaries travel with it, so
 * unlike the German branch there is no partial-answer state to merge —
 * one call both fills the row and resolves the outcome.
 */
async function submitElsewhere(
  client: PoolClient,
  memberId: string,
  rowExists: boolean,
  body: ProfilingElsewherePatch,
) {
  const slots = [body.primaryCity, ...body.secondaryCities]
  // Checked earliest slot first (primary, then secondaries in the order
  // given), matching contracts/profiling-api.md's "first match found, primary
  // checked first".
  const { rows: matches } = await client.query(
    `SELECT g.id, g.country, g.city, s.ord
       FROM unnest($1::char(2)[], $2::text[]) WITH ORDINALITY AS s(country, city, ord)
       JOIN gwc_cities g ON g.country = s.country AND lower(g.city) = lower(s.city)
      ORDER BY s.ord
      LIMIT 1`,
    [slots.map((s) => s.country), slots.map((s) => s.city)],
  )
  const match = matches[0] as { id: string } | undefined
  const outcome = match ? 'gwc_city_match' : 'in_person_meeting'

  const secondary1 = body.secondaryCities[0] ?? null
  const secondary2 = body.secondaryCities[1] ?? null

  const columns = `
       primary_city_country, primary_city_name,
       secondary_city_1_country, secondary_city_1_name,
       secondary_city_2_country, secondary_city_2_name,
       matched_gwc_city_id, outcome, completed_at`
  const values = [
    body.primaryCity.country, body.primaryCity.city,
    secondary1?.country ?? null, secondary1?.city ?? null,
    secondary2?.country ?? null, secondary2?.city ?? null,
    match?.id ?? null, outcome,
  ]

  if (rowExists) {
    await client.query(
      `UPDATE member_profiling SET
         primary_city_country = $2, primary_city_name = $3,
         secondary_city_1_country = $4, secondary_city_1_name = $5,
         secondary_city_2_country = $6, secondary_city_2_name = $7,
         matched_gwc_city_id = $8, outcome = $9, completed_at = now()
       WHERE member_id = $1`,
      [memberId, ...values],
    )
  } else {
    await client.query(
      `INSERT INTO member_profiling (member_id, branch,${columns})
       VALUES ($1, 'elsewhere', $2, $3, $4, $5, $6, $7, $8, $9, now())`,
      [memberId, ...values],
    )
  }
}

import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { PROBLEMS } from '@gwc/contracts/errors'
import { GERMANY } from '@gwc/contracts/onboarding'
import {
  QUALIFICATION_LEVELS, OCCUPATIONS, DESIRED_WORK_TYPES,
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
              completed_at
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

async function submitGermany(
  client: PoolClient,
  memberId: string,
  row: {
    settling_status: string | null; languages: string[] | null; qualification_level: string | null
    occupation: string | null; desired_work_type: string | null
  } | undefined,
  body: ProfilingGermanyPatch,
) {
  const merged = {
    settling_status: body.settlingStatus ?? row?.settling_status ?? null,
    languages: body.languages ?? row?.languages ?? null,
    qualification_level: body.qualificationLevel ?? row?.qualification_level ?? null,
    occupation: body.occupation ?? row?.occupation ?? null,
    desired_work_type: body.desiredWorkType ?? row?.desired_work_type ?? null,
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

  const completed = GERMANY_FIELDS_COMPLETE(merged)

  await client.query(
    `INSERT INTO member_profiling (
       member_id, branch, settling_status, languages, qualification_level, occupation, desired_work_type,
       completed_at
     ) VALUES ($1, 'germany', $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() ELSE NULL END)
     ON CONFLICT (member_id) DO UPDATE SET
       settling_status = EXCLUDED.settling_status,
       languages = EXCLUDED.languages,
       qualification_level = EXCLUDED.qualification_level,
       occupation = EXCLUDED.occupation,
       desired_work_type = EXCLUDED.desired_work_type,
       completed_at = EXCLUDED.completed_at`,
    [
      memberId, merged.settling_status, merged.languages, merged.qualification_level,
      merged.occupation, merged.desired_work_type, completed,
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

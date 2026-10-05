import { PROBLEMS } from '@gwc/contracts/errors'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import type { GwcApp } from '../../../app.ts'
import type { PoolClient } from 'pg'
import type { Application, ApplicationState } from '@gwc/contracts/onboarding'

/**
 * Staff review of membership applications — step 5 of §6.1.
 *
 * Approve or deny, a reason on every denial, an email either way. Approving
 * also approves the device the application came from, and only that device:
 * approval is device-bound (§12.6), and an application is the one moment staff
 * have looked at which phone somebody is using.
 */

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)

// Names its columns, like every query on a path that reaches a response: the
// password hash sits one `*` away in this join.
const APPLICATION_COLUMNS = `
  a.member_id, a.device_id, a.state, a.submitted_at, a.reviewed_at, a.denial_reason,
  a.decided_automatically, m.primary_language,
  m.display_name, m.email, m.mobile, m.gender, m.country_of_residence,
  -- A calendar date, formatted by Postgres: pg would otherwise hand back a
  -- local-midnight Date that serialises a day early east of UTC.
  to_char(m.birthday, 'YYYY-MM-DD') AS birthday,
  -- Onboarding Phase 2 (013): profiling's own outcome, surfaced here rather
  -- than through a dedicated staff screen (spec.md Assumptions).
  p.branch AS profiling_branch, p.completed_at AS profiling_completed_at, p.outcome AS profiling_outcome,
  g.country AS profiling_matched_country, g.city AS profiling_matched_city`
const APPLICATION_JOINS = `
   LEFT JOIN member_profiling p ON p.member_id = a.member_id
   LEFT JOIN gwc_cities g ON g.id = p.matched_gwc_city_id`

function toApplication(row: Record<string, unknown>): Application {
  return {
    memberId: String(row.member_id),
    fullName: (row.display_name as string | null) ?? null,
    email: String(row.email),
    mobile: (row.mobile as string | null) ?? null,
    birthday: (row.birthday as string | null) ?? null,
    gender: (row.gender as string | null) ?? null,
    countryOfResidence: (row.country_of_residence as string | null) ?? null,
    deviceId: row.device_id ? String(row.device_id) : null,
    state: row.state as ApplicationState,
    submittedAt: iso(row.submitted_at),
    reviewedAt: iso(row.reviewed_at),
    denialReason: (row.denial_reason as string | null) ?? null,
    primaryLanguage: (row.primary_language as 'german' | 'non_german' | null) ?? null,
    decidedBy: row.state === 'pending' ? null : row.decided_automatically ? 'automatic' as const : 'staff' as const,
    profiling: row.profiling_branch ? {
      completed: row.profiling_completed_at != null,
      branch: row.profiling_branch as 'germany' | 'elsewhere',
      outcome: (row.profiling_outcome as 'in_person_meeting' | 'gwc_city_match' | null) ?? null,
      matchedCity: row.profiling_matched_country
        ? { country: row.profiling_matched_country as string, city: row.profiling_matched_city as string }
        : null,
    } : null,
  }
}

/**
 * Submitted applications only. One that stalled before its email was confirmed
 * is not finished, and a queue full of those buries the ones that are.
 */
export async function listApplications(
  app: GwcApp,
  { state = 'pending', signal }: { state?: ApplicationState; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    `SELECT ${APPLICATION_COLUMNS}
       FROM membership_applications a
       JOIN members m ON m.id = a.member_id
       ${APPLICATION_JOINS}
      WHERE a.submitted_at IS NOT NULL AND a.state = $1
      ORDER BY a.submitted_at
      LIMIT 200`,
    [state],
    { signal },
  )
  return rows.map(toApplication)
}

export type Decision =
  | { state: 'approved'; reason?: undefined }
  | { state: 'denied'; reason: string }

/**
 * Applies one decision inside the caller's transaction: the state change, the
 * device approval, and the email. Staff and the two automatic rules (the
 * non-German denial and the 24-hour approval) all come through here, so an
 * automatic decision cannot behave differently from a manual one except in who
 * is recorded — `reviewed_by` stays NULL and `decided_automatically` is set.
 *
 * `state = 'pending'` in the WHERE clause is what makes a double click, two
 * staff members at once, or staff racing the job decide exactly once. The
 * trigger in 020_onboarding.sql refuses a second decision outright; this
 * answers it cleanly before it gets there.
 */
export async function applyDecision(
  app: GwcApp,
  client: PoolClient,
  { memberId, adminId, decision }: { memberId: string; adminId: string | null; decision: Decision },
): Promise<boolean> {
  const automatic = adminId === null
  const { rows } = await client.query(
    `UPDATE membership_applications
        SET state = $2, denial_reason = $3, reviewed_by = $4, reviewed_at = now(),
            decided_automatically = $5
      WHERE member_id = $1 AND state = 'pending' AND submitted_at IS NOT NULL
      RETURNING member_id, device_id`,
    [memberId, decision.state, decision.reason ?? null, adminId, automatic],
  )
  if (rows.length === 0) return false
  const { device_id: deviceId } = rows[0]

  // A web application has no device to approve: the member-level decision
  // above is the whole of it, and any phone they sign in from later still
  // needs its own approval.
  if (deviceId) await client.query(
    `INSERT INTO device_approvals (member_id, device_id, state, denial_reason, reviewed_by, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (member_id, device_id) DO UPDATE
       SET state = EXCLUDED.state, denial_reason = EXCLUDED.denial_reason,
           reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at, updated_at = now()`,
    [memberId, deviceId, decision.state, decision.reason ?? null, adminId],
  )

  const { rows: member } = await client.query('SELECT email, display_name FROM members WHERE id = $1', [memberId])

  // Queued inside the transaction, so the mail exists exactly when the
  // decision does. A decision that rolled back must not have told anybody.
  await app.enqueueMail({
    to: member[0].email,
    template: decision.state === 'approved' ? 'onboarding.approved' : 'onboarding.denied',
    subjectKey: `application:${memberId}`,
    variables: { name: member[0].display_name, ...(decision.reason ? { reason: decision.reason } : {}) },
  }, { client })

  return true
}

/** The audit entry for a decision nobody on staff made (no actor: the system did). */
export const auditAutomaticDecision = (
  app: GwcApp, { memberId, decision }: { memberId: string; decision: Decision },
) => app.audit({
  action: decision.state === 'approved' ? 'membership_application_approved' : 'membership_application_denied',
  outcome: 'allowed', actorId: null, actorKind: null,
  targetType: 'membership_application', targetId: memberId,
  detail: { reason: decision.state === 'approved' ? 'automatic-approval-after-24h' : 'automatic-denial-non-german' },
})

export async function decide(
  app: GwcApp,
  { memberId, adminId, decision, requestId, signal }:
    { memberId: string; adminId: string; decision: Decision; requestId?: string; signal?: AbortSignal },
) {
  const decided = await withTransaction(app.pg, (client) => applyDecision(app, client, { memberId, adminId, decision }), { signal })

  if (!decided) {
    // Unknown, not yet submitted, or already decided: none of them can be
    // decided now, and staff learn which by reading the application.
    const { rows } = await query(app.pg, 'SELECT state FROM membership_applications WHERE member_id = $1', [memberId], { signal })
    const current = rows[0]
    if (current && current.state !== 'pending') {
      throw refuse(PROBLEMS.CONFLICT, `This application was already ${current.state}.`)
    }
    throw refuse(PROBLEMS.NOT_FOUND, 'No submitted application for this member.')
  }

  await app.audit({
    action: decision.state === 'approved' ? 'membership_application_approved' : 'membership_application_denied',
    outcome: 'allowed', requestId, actorId: adminId, actorKind: 'admin',
    targetType: 'membership_application', targetId: memberId,
    detail: decision.reason ? { reason: decision.reason } : null,
  })

  const { rows } = await query(
    app.pg,
    `SELECT ${APPLICATION_COLUMNS} FROM membership_applications a JOIN members m ON m.id = a.member_id ${APPLICATION_JOINS} WHERE a.member_id = $1`,
    [memberId],
    { signal },
  )
  return toApplication(rows[0]!)
}

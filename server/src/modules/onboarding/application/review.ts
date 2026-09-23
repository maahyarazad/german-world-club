import { PROBLEMS } from '@gwc/contracts/errors'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import type { GwcApp } from '../../../app.ts'
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
  m.display_name, m.email, m.mobile, m.gender, m.country_of_residence,
  -- A calendar date, formatted by Postgres: pg would otherwise hand back a
  -- local-midnight Date that serialises a day early east of UTC.
  to_char(m.birthday, 'YYYY-MM-DD') AS birthday`

function toApplication(row: Record<string, unknown>): Application {
  return {
    memberId: String(row.member_id),
    fullName: (row.display_name as string | null) ?? null,
    email: String(row.email),
    mobile: (row.mobile as string | null) ?? null,
    birthday: (row.birthday as string | null) ?? null,
    gender: (row.gender as string | null) ?? null,
    countryOfResidence: (row.country_of_residence as string | null) ?? null,
    deviceId: String(row.device_id),
    state: row.state as ApplicationState,
    submittedAt: iso(row.submitted_at),
    reviewedAt: iso(row.reviewed_at),
    denialReason: (row.denial_reason as string | null) ?? null,
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
      WHERE a.submitted_at IS NOT NULL AND a.state = $1
      ORDER BY a.submitted_at
      LIMIT 200`,
    [state],
    { signal },
  )
  return rows.map(toApplication)
}

type Decision =
  | { state: 'approved'; reason?: undefined }
  | { state: 'denied'; reason: string }

export async function decide(
  app: GwcApp,
  { memberId, adminId, decision, requestId, signal }:
    { memberId: string; adminId: string; decision: Decision; requestId?: string; signal?: AbortSignal },
) {
  const decided = await withTransaction(app.pg, async (client) => {
    // `state = 'pending'` in the WHERE clause is what makes a double click, or
    // two staff members at once, decide exactly once. The trigger in
    // 020_onboarding.sql refuses a second decision outright; this answers it
    // cleanly before it gets there.
    const { rows } = await client.query(
      `UPDATE membership_applications
          SET state = $2, denial_reason = $3, reviewed_by = $4, reviewed_at = now()
        WHERE member_id = $1 AND state = 'pending' AND submitted_at IS NOT NULL
        RETURNING member_id, device_id`,
      [memberId, decision.state, decision.reason ?? null, adminId],
    )
    if (rows.length === 0) return null
    const { device_id: deviceId } = rows[0]

    await client.query(
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
  }, { signal })

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
    `SELECT ${APPLICATION_COLUMNS} FROM membership_applications a JOIN members m ON m.id = a.member_id WHERE a.member_id = $1`,
    [memberId],
    { signal },
  )
  return toApplication(rows[0]!)
}

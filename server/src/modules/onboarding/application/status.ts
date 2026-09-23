import { query } from '../../../db/query.ts'
import type { GwcApp } from '../../../app.ts'
import type { OnboardingStatus, OnboardingStep } from '@gwc/contracts/onboarding'

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)

/**
 * Where an applicant stands, derived from the facts every time.
 *
 * There is no `step` column. A stored step is a second copy of what the
 * verification timestamps and the application state already say, and the day
 * they disagree the app would show a screen the server does not believe in.
 */
export async function loadStatus(
  app: GwcApp,
  { memberId, signal }: { memberId: string; signal?: AbortSignal },
): Promise<OnboardingStatus> {
  const { rows } = await query(
    app.pg,
    `SELECT m.mobile_verified_at, m.email_confirmed_at,
            a.member_id AS applied, a.state, a.denial_reason, a.submitted_at, a.reviewed_at
       FROM members m
       LEFT JOIN membership_applications a ON a.member_id = m.id
      WHERE m.id = $1`,
    [memberId],
    { signal },
  )
  const row = rows[0] ?? {}

  return {
    step: stepFor(row),
    // Only a denial has a reason worth showing; §6.1 requires one.
    denialReason: row.state === 'denied' ? row.denial_reason : null,
    submittedAt: iso(row.submitted_at),
    reviewedAt: iso(row.reviewed_at),
  }
}

function stepFor(row: Record<string, unknown>): OnboardingStep {
  // A member who never applied — invited, or from before onboarding existed —
  // is simply a member. Nothing here is theirs to complete.
  if (!row.applied) return 'approved'
  if (row.state === 'denied') return 'denied'
  if (row.state === 'approved') return 'approved'
  if (!row.mobile_verified_at) return 'verify_mobile'
  if (!row.email_confirmed_at) return 'verify_email'
  return 'awaiting_approval'
}

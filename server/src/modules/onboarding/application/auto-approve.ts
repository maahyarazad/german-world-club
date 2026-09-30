import { withTransaction } from '../../../db/query.ts'
import { applyDecision, auditAutomaticDecision } from './review.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * The scheduled job behind "approval may take up to 48 hours": a German
 * speaker's application still pending 24 hours after it was submitted is
 * approved, with the same email a staff approval sends.
 *
 * Only rows with an explicit `primary_language = 'german'` qualify, so an
 * application with no stored language is never decided by this rule. Each row
 * is decided in its own transaction: one failing mail must not roll back the
 * others, and `applyDecision`'s `state = 'pending'` guard makes a staff
 * decision made a moment earlier win cleanly (this job then does nothing).
 */
export async function autoApproveDue(app: GwcApp): Promise<number> {
  const { rows } = await app.pg.query(
    `SELECT a.member_id
       FROM membership_applications a
       JOIN members m ON m.id = a.member_id
      WHERE a.state = 'pending'
        AND a.submitted_at IS NOT NULL
        AND a.submitted_at <= now() - interval '24 hours'
        AND m.primary_language = 'german'
      ORDER BY a.submitted_at
      LIMIT 100`,
  )
  let approved = 0
  for (const { member_id: memberId } of rows as { member_id: string }[]) {
    const decision = { state: 'approved' } as const
    const done = await withTransaction(app.pg, (client) => applyDecision(app, client, { memberId, adminId: null, decision }))
    if (done) {
      approved += 1
      await auditAutomaticDecision(app, { memberId, decision })
    }
  }
  return approved
}

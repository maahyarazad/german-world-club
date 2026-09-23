import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Staff moderation of Threads (§8), under the existing `threads_moderation`
 * module.
 *
 * The marketplace's rules, unchanged: staff hide, restore, remove and resolve —
 * each with a reason, each audited — and never edit. The trigger in
 * 024_threads.sql refuses a changed body outright, so "no staff endpoint
 * rewrites what a member said" is a property of the table, not of this file.
 */

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)

type Transition = { action: 'hide' | 'restore' | 'remove'; from: string[]; to: string }

const TRANSITIONS: Record<Transition['action'], Transition> = {
  hide: { action: 'hide', from: ['visible'], to: 'hidden' },
  restore: { action: 'restore', from: ['hidden'], to: 'visible' },
  // From hidden too: a post can be hidden while staff decide, then removed.
  remove: { action: 'remove', from: ['visible', 'hidden'], to: 'removed' },
}

export async function getPostForStaff(app: GwcApp, { postId, signal }: { postId: string; signal?: AbortSignal }) {
  const { rows } = await query(
    app.pg,
    `SELECT p.id, p.author_id, m.display_name AS author_name, p.body, p.reply_to_id, p.state,
            p.state_reason, p.state_changed_at, p.created_at
       FROM thread_posts p JOIN members m ON m.id = p.author_id
      WHERE p.id = $1`,
    [postId],
    { signal },
  )
  const row = rows[0]
  if (!row) throw refuse(PROBLEMS.NOT_FOUND, 'No such post.')
  return toStaffPost(row)
}

function toStaffPost(row: Record<string, any>) {
  return {
    id: String(row.id),
    authorId: String(row.author_id),
    authorDisplayName: row.author_name ?? null,
    body: String(row.body),
    replyToId: row.reply_to_id ? String(row.reply_to_id) : null,
    state: String(row.state),
    stateReason: row.state_reason ?? null,
    stateChangedAt: iso(row.state_changed_at)!,
    createdAt: iso(row.created_at)!,
  }
}

export async function moderatePost(
  app: GwcApp,
  { postId, adminId, action, reason, requestId, signal }:
    { postId: string; adminId: string; action: Transition['action']; reason: string; requestId?: string; signal?: AbortSignal },
) {
  const t = TRANSITIONS[action]
  const { rows } = await query(
    app.pg,
    `UPDATE thread_posts SET state = $2, state_reason = $3, state_changed_by = $4
      WHERE id = $1 AND state = ANY($5::thread_post_state[])
      RETURNING id`,
    [postId, t.to, reason, adminId, t.from],
    { signal },
  )
  if (rows.length === 0) {
    // Distinguish "no such post" from "not from this state", for staff only —
    // they may know a post's state; members may not.
    const current = await getPostForStaff(app, { postId, signal })
    throw refuse(PROBLEMS.CONFLICT, `A ${current.state} post cannot be ${t.to === 'visible' ? 'restored' : t.to}.`)
  }
  await app.audit({
    action: `thread_post_${action}`, outcome: 'allowed', requestId,
    actorId: adminId, actorKind: 'admin', targetType: 'thread_post', targetId: postId,
    detail: { reason },
  })
  return getPostForStaff(app, { postId, signal })
}

export async function listReports(
  app: GwcApp,
  { state = 'open', signal }: { state?: 'open' | 'upheld' | 'dismissed'; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    `SELECT r.id, r.post_id, r.reporter_id, r.reason, r.state, r.created_at, r.resolved_at,
            r.resolved_by, r.resolution_note, p.body AS post_body, p.state AS post_state
       FROM thread_reports r JOIN thread_posts p ON p.id = r.post_id
      WHERE r.state = $1
      ORDER BY r.created_at
      LIMIT 200`,
    [state],
    { signal },
  )
  return rows.map((row) => ({
    id: String(row.id),
    postId: String(row.post_id),
    reporterId: String(row.reporter_id),
    reason: String(row.reason),
    state: String(row.state),
    createdAt: iso(row.created_at)!,
    resolvedAt: iso(row.resolved_at),
    resolvedBy: row.resolved_by ? String(row.resolved_by) : null,
    resolutionNote: row.resolution_note ?? null,
    postBody: String(row.post_body),
    postState: String(row.post_state),
  }))
}

/**
 * Close a report. Upholding one does not by itself hide the post — hiding is
 * its own audited action with its own reason — so the two cannot drift apart
 * in the log by one implying the other silently.
 */
export async function resolveReport(
  app: GwcApp,
  { reportId, adminId, outcome, note, requestId, signal }:
    { reportId: string; adminId: string; outcome: 'upheld' | 'dismissed'; note: string; requestId?: string; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    `UPDATE thread_reports SET state = $2, resolution_note = $3, resolved_by = $4, resolved_at = now()
      WHERE id = $1 AND state = 'open'
      RETURNING id, post_id`,
    [reportId, outcome, note, adminId],
    { signal },
  )
  if (rows.length === 0) throw refuse(PROBLEMS.NOT_FOUND, 'No open report with that id.')
  await app.audit({
    action: 'thread_report_resolved', outcome: 'allowed', requestId,
    actorId: adminId, actorKind: 'admin', targetType: 'thread_report', targetId: reportId,
    detail: { outcome, note, postId: String(rows[0]!.post_id) },
  })
  return { id: reportId, state: outcome }
}

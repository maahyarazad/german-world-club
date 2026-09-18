import { query } from '../db/query.ts'
import type { Pool } from 'pg'

/**
 * Append-only audit writer (FR-015).
 *
 * `detail` must never carry credentials, tokens, one-time codes, or member
 * contact details (FR-048) — the caller passes only what is safe, and
 * `SAFE_DETAIL_KEYS` is the allowlist that enforces it rather than trusting
 * every future call site.
 */

const SAFE_DETAIL_KEYS = new Set([
  'reason', 'module', 'flag', 'audience', 'routeClass', 'bucket', 'deviceIdHash',
  'statusFrom', 'statusTo', 'variant', 'format', 'count', 'sessionId',
])

export function sanitizeDetail(detail) {
  if (!detail || typeof detail !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(detail)) {
    if (SAFE_DETAIL_KEYS.has(k)) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

export function createAuditWriter(pool: Pool) {
  /**
   * @param {{action: string, outcome?: 'allowed'|'denied'|'error', requestId?: string,
   *          actorId?: string|null, actorKind?: 'member'|'admin'|null,
   *          targetType?: string|null, targetId?: string|null,
   *          requiredPermission?: string|null, detail?: object|null}} event
   */
  return async function audit(event) {
    const {
      action, outcome = 'allowed', requestId = null,
      actorId = null, actorKind = null,
      targetType = null, targetId = null,
      requiredPermission = null, detail = null,
    } = event

    await query(
      pool,
      `INSERT INTO audit_log
         (request_id, actor_id, actor_kind, action, target_type, target_id,
          required_permission, outcome, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [requestId, actorId, actorKind, action, targetType, targetId,
       requiredPermission, outcome, sanitizeDetail(detail)],
    )
  }
}

/**
 * Query helpers staff need (T191).
 *
 * The audit trail only earns its keep if a question can be asked of it. §11's
 * four questions are: what did this person do, what happened to this object,
 * who was refused which permission, and what happened in this window. Each is
 * an index-backed query here rather than a log search.
 *
 * Every helper is bounded by `limit` and ordered newest-first: an unbounded
 * audit query on a table that only ever grows is a way to take the database
 * down from the admin console.
 */
export function createAuditReader(pool: Pool) {
  const MAX_LIMIT = 500
  const bounded = (limit) => Math.min(Math.max(1, Number(limit) || 50), MAX_LIMIT)

  const SELECT = `
    SELECT id, occurred_at, request_id, actor_id, actor_kind, action,
           target_type, target_id, required_permission, outcome, detail
      FROM audit_log`

  return {
    /** What did this principal do? */
    async byPrincipal({ actorId, actorKind = null, limit = 50 }) {
      const { rows } = await query(
        pool,
        `${SELECT} WHERE actor_id = $1 AND ($2::account_kind IS NULL OR actor_kind = $2)
          ORDER BY occurred_at DESC, id DESC LIMIT $3`,
        [actorId, actorKind, bounded(limit)],
      )
      return rows
    },

    /** What has happened to this object? */
    async byTarget({ targetType, targetId, limit = 50 }) {
      const { rows } = await query(
        pool,
        `${SELECT} WHERE target_type = $1 AND target_id = $2
          ORDER BY occurred_at DESC, id DESC LIMIT $3`,
        [targetType, targetId, bounded(limit)],
      )
      return rows
    },

    /**
     * Who was refused which permission?
     *
     * The question behind FR-015: a run of denials on one module is either a
     * grant somebody forgot to make or someone probing for what they can reach,
     * and both are worth seeing.
     */
    async byRequiredPermission({ requiredPermission, outcome = 'denied', limit = 50 }) {
      const { rows } = await query(
        pool,
        `${SELECT} WHERE required_permission = $1 AND ($2::text IS NULL OR outcome = $2)
          ORDER BY occurred_at DESC, id DESC LIMIT $3`,
        [requiredPermission, outcome, bounded(limit)],
      )
      return rows
    },

    /** What happened between these times? */
    async byWindow({ from, to = new Date(), action = null, outcome = null, limit = 100 }) {
      const { rows } = await query(
        pool,
        `${SELECT} WHERE occurred_at >= $1 AND occurred_at <= $2
                     AND ($3::text IS NULL OR action = $3)
                     AND ($4::text IS NULL OR outcome = $4)
          ORDER BY occurred_at DESC, id DESC LIMIT $5`,
        [from, to, action, outcome, bounded(limit)],
      )
      return rows
    },

    /** Everything recorded under one request id, for tracing a failure. */
    async byRequestId(requestId) {
      const { rows } = await query(
        pool,
        `${SELECT} WHERE request_id = $1 ORDER BY occurred_at ASC, id ASC`,
        [requestId],
      )
      return rows
    },
  }
}

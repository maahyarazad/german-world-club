import { query } from '../db/query.js'

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

export function createAuditWriter(pool) {
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

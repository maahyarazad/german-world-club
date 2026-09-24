import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { tokenPreview } from '../providers.ts'
import type { Device } from '@gwc/contracts/push'
import type { GwcApp } from '../../../app.ts'

/** Named columns: a device response must never grow a column by accident. */
const DEVICE_COLUMNS = 'id, provider, platform, locale, enabled, token, last_seen_at, created_at'

export const toDevice = (row: Record<string, any>): Device => ({
  id: String(row.id),
  provider: row.provider,
  platform: row.platform ?? null,
  locale: row.locale,
  enabled: row.enabled,
  // A token is a credential for addressing someone's phone; never echo it whole.
  tokenPreview: tokenPreview(row.token),
  lastSeenAt: new Date(row.last_seen_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
})

/**
 * Register or refresh this phone (feature 011, research R3).
 *
 * An upsert on the **token**, not on (member, token): a token addresses one
 * physical phone, so the most recent sign-in on that phone owns it. The
 * previous member stops receiving at once (FR-004, acceptance 1.6) — keyed on
 * the pair, the same phone would have kept notifying whoever signed in first.
 *
 * Called on every cold start, so it must be cheap and idempotent. It also
 * records the session (sign-out deletes by it), stores the language, and
 * clears `disabled_reason`: a token the provider called dead and the app now
 * presents again has been reinstalled.
 */
export async function registerDevice(
  app: GwcApp,
  { memberId, sessionId, token, provider, platform, locale, enabled, signal }: {
    memberId: string; sessionId: string | null; token: string; provider: string
    platform?: string; locale: string; enabled?: boolean; signal?: AbortSignal
  },
) {
  const { rows } = await query(
    app.pg,
    `INSERT INTO push_devices (member_id, session_id, token, provider, platform, locale, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true))
     ON CONFLICT (token) DO UPDATE
       SET member_id       = EXCLUDED.member_id,
           session_id      = EXCLUDED.session_id,
           provider        = EXCLUDED.provider,
           platform        = EXCLUDED.platform,
           locale          = EXCLUDED.locale,
           -- The member's own switch survives a refresh — unless the phone just
           -- changed hands, when the new member starts opted in.
           enabled         = CASE
                               WHEN $7::boolean IS NOT NULL THEN $7
                               WHEN push_devices.member_id <> EXCLUDED.member_id THEN true
                               ELSE push_devices.enabled
                             END,
           disabled_reason = NULL,
           last_seen_at    = now(),
           updated_at      = now()
     RETURNING ${DEVICE_COLUMNS}`,
    [memberId, sessionId, token, provider, platform ?? null, locale, enabled ?? null],
    { signal },
  )
  return rows[0]
}

export async function listDevices(app: GwcApp, { memberId, signal }: { memberId: string; signal?: AbortSignal }) {
  const { rows } = await query(
    app.pg,
    `SELECT ${DEVICE_COLUMNS} FROM push_devices WHERE member_id = $1 ORDER BY last_seen_at DESC`,
    [memberId],
    { signal },
  )
  return rows
}

/**
 * Change this phone's switch or language (the app's settings screen).
 *
 * Scoped to the caller's own devices; another member's device id answers 404,
 * indistinguishable from one that does not exist.
 */
export async function updateDevice(
  app: GwcApp,
  { id, memberId, enabled, locale, signal }: {
    id: string; memberId: string; enabled?: boolean; locale?: string; signal?: AbortSignal
  },
) {
  const { rows } = await query(
    app.pg,
    `UPDATE push_devices
        SET enabled = COALESCE($3, enabled),
            locale = COALESCE($4, locale),
            updated_at = now()
      WHERE id = $1 AND member_id = $2
      RETURNING ${DEVICE_COLUMNS}`,
    [id, memberId, enabled ?? null, locale ?? null],
    { signal },
  )
  if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such device.')
  return rows[0]
}

/**
 * Deregistration, by device id.
 *
 * The blueprint clears a token by re-posting an empty string, and then notes
 * its own server rejects that. A DELETE on the device says what is meant,
 * and scoping it to the caller's own member id means one member cannot
 * silence another's phone.
 */
export async function deregisterDevice(
  app: GwcApp,
  { id, memberId, signal }: { id: string; memberId: string; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    'DELETE FROM push_devices WHERE id = $1 AND member_id = $2 RETURNING id',
    [id, memberId],
    { signal },
  )
  if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such device.')
  return String(rows[0].id)
}

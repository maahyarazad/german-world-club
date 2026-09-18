import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'

/** A token is a credential for addressing someone's phone; never echo it whole. */
const preview = (token) => `${String(token).slice(0, 12)}…${String(token).slice(-4)}`

export const toDevice = (row) => ({
  id: row.id,
  provider: row.provider,
  platform: row.platform ?? null,
  enabled: row.enabled,
  tokenPreview: preview(row.token),
  lastSeenAt: new Date(row.last_seen_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
})

/**
 * An upsert on (member_id, token), which is what makes re-registration safe.
 * Tokens rotate on reinstall and OS restore, and the blueprint warns that a
 * token registered once at signup goes stale and the member silently stops
 * receiving anything — so the client is expected to call this on every cold
 * start, and calling it must be cheap and idempotent.
 */
export async function registerDevice(app, { memberId, token, provider, platform, enabled, signal }) {
  const { rows } = await query(
    app.pg,
    `INSERT INTO push_devices (member_id, token, provider, platform, enabled)
     VALUES ($1, $2, $3, $4, COALESCE($5, true))
     ON CONFLICT (member_id, token) DO UPDATE
       SET provider = EXCLUDED.provider,
           platform = EXCLUDED.platform,
           enabled  = COALESCE($5, push_devices.enabled),
           last_seen_at = now(),
           updated_at = now()
     RETURNING *`,
    [memberId, token, provider, platform ?? null, enabled ?? null],
    { signal },
  )
  return rows[0]
}

export async function listDevices(app, { memberId, signal }) {
  const { rows } = await query(
    app.pg,
    'SELECT * FROM push_devices WHERE member_id = $1 ORDER BY last_seen_at DESC',
    [memberId],
    { signal },
  )
  return rows
}

/**
 * Deregistration, by device id.
 *
 * The blueprint clears a token by re-posting an empty string, and then notes
 * its own server rejects that. A DELETE on the device says what is meant,
 * and scoping it to the caller's own member id means one member cannot
 * silence another's phone.
 */
export async function deregisterDevice(app, { id, memberId, signal }) {
  const { rows } = await query(
    app.pg,
    'DELETE FROM push_devices WHERE id = $1 AND member_id = $2 RETURNING id',
    [id, memberId],
    { signal },
  )
  if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such device.')
  return rows[0].id
}

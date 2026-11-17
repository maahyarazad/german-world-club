import { query } from '../../../db/query.ts'
import type { GwcApp } from '../../../app.ts'
import type { MemberDevicesResponse } from '@gwc/contracts/devices'

/**
 * The member's own signed-in devices (feature 026, US2).
 *
 * Columns are named, never `SELECT *`: this row family also holds the device
 * key (a hash of the browser's cookie, or the phone's id) and `known_at`, and
 * neither may reach a client (constitution VI). `lastSeenAt` is the SESSION's
 * — it moves on every token refresh — rather than the device row's, which only
 * moves at sign-in and would show a long-lived phone as idle.
 */
export async function listDevices(
  app: GwcApp,
  { memberId, sessionId, signal }: { memberId: string; sessionId: string; signal?: AbortSignal },
): Promise<MemberDevicesResponse> {
  const { rows } = await query(
    app.pg,
    `SELECT d.id, d.kind, d.label, d.first_seen_at, s.last_seen_at, (s.id = $2) AS current
       FROM member_devices d
       JOIN sessions s ON s.member_device_id = d.id AND s.revoked_at IS NULL
      WHERE d.member_id = $1
      ORDER BY s.last_seen_at DESC, d.id`,
    [memberId, sessionId],
    { signal },
  )
  return {
    devices: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      firstSeenAt: new Date(r.first_seen_at).toISOString(),
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
      current: r.current === true,
    })),
  }
}

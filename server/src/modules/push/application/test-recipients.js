import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.js'
import { forbidden } from '../../../authz/require-permission.js'

export async function listTestRecipients(app, { signal }) {
  const { rows } = await query(
    app.pg,
    `SELECT t.member_id, m.display_name, m.email,
            (SELECT count(*)::int FROM push_devices d WHERE d.member_id = t.member_id AND d.enabled) AS device_count
       FROM push_test_recipients t
       JOIN members m ON m.id = t.member_id
      ORDER BY m.email`,
    [],
    { signal },
  )
  return rows.map((r) => ({
    memberId: r.member_id,
    displayName: r.display_name ?? null,
    email: r.email,
    deviceCount: r.device_count,
  }))
}

export async function addTestRecipient(app, { memberId, addedBy, signal }) {
  const { rows } = await query(
    app.pg,
    `INSERT INTO push_test_recipients (member_id, added_by) VALUES ($1, $2)
     ON CONFLICT (member_id) DO UPDATE SET added_by = EXCLUDED.added_by
     RETURNING member_id`,
    [memberId, addedBy],
    { signal },
  )
  return rows[0].member_id
}

export async function removeTestRecipient(app, { memberId, signal }) {
  const { rows } = await query(
    app.pg,
    'DELETE FROM push_test_recipients WHERE member_id = $1 RETURNING member_id',
    [memberId],
    { signal },
  )
  if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'Not on the test list.')
  return rows[0].member_id
}

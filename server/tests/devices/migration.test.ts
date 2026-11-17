import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { buildAuthApp, createAdmin, createMember, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 026's database rules, asserted directly.
 *
 * These are the invariants a well-meaning application change could break
 * without any HTTP test noticing, so each one has a counter-assertion: the
 * staff case fails if the old index was dropped without its new predicate, and
 * the backfill cases fail against a migration that trusted every row.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

describe.skipIf(!hasDatabase)('member devices (migration 044)', () => {
  let member: { id: string }
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    member = await createMember(app.pg)
  })

  const device = async (key: string, kind = 'mobile') => {
    const { rows } = await app.pg.query(
      `INSERT INTO member_devices (member_id, kind, device_key, label) VALUES ($1, $2, $3, 'Test') RETURNING id`,
      [member.id, kind, key],
    )
    return rows[0].id as string
  }
  const session = (deviceId: string | null, accountId = member.id, kind = 'member') =>
    app.pg.query(
      'INSERT INTO sessions (account_id, account_kind, member_device_id) VALUES ($1, $2, $3)',
      [accountId, kind, deviceId],
    )

  it('accepts two active sessions on two devices and refuses two on one', async () => {
    const a = await device('a')
    const b = await device('b')
    await session(a)
    await session(b)
    await expect(session(a)).rejects.toMatchObject({ code: '23505' })
  })

  it('still allows only one active session per staff account', async () => {
    const admin = await createAdmin(app.pg)
    await session(null, admin.id, 'admin')
    await expect(session(null, admin.id, 'admin')).rejects.toMatchObject({ code: '23505' })
  })

  it('allows a new session on a device once its old one is revoked', async () => {
    const a = await device('a')
    await session(a)
    await app.pg.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'device_ended' WHERE member_device_id = $1`, [a])
    await expect(session(a)).resolves.toBeTruthy()
  })

  it('accepts the new revocation reason and still refuses an unknown one', async () => {
    const a = await device('a')
    await session(a)
    await expect(app.pg.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'made-up' WHERE member_device_id = $1`, [a],
    )).rejects.toMatchObject({ code: '23514' })
  })

  it('only phones can be known', async () => {
    await expect(app.pg.query(
      `INSERT INTO member_devices (member_id, kind, device_key, label, known_at) VALUES ($1, 'web', 'w', 'Web', now())`,
      [member.id],
    )).rejects.toMatchObject({ code: '23514' })
  })

  it.each(['locked', 'inactive', 'ended'])('forgets every phone when the member becomes %s', async (status) => {
    const a = await device('a')
    await app.pg.query('UPDATE member_devices SET known_at = now() WHERE id = $1', [a])
    await app.pg.query('UPDATE members SET status = $2 WHERE id = $1', [member.id, status])
    const { rows } = await app.pg.query('SELECT known_at FROM member_devices WHERE id = $1', [a])
    expect(rows[0].known_at).toBeNull()
  })

  it('does not forget a phone on an unrelated update', async () => {
    const a = await device('a')
    await app.pg.query('UPDATE member_devices SET known_at = now() WHERE id = $1', [a])
    await app.pg.query(`UPDATE members SET display_name = 'Renamed' WHERE id = $1`, [member.id])
    const { rows } = await app.pg.query('SELECT known_at FROM member_devices WHERE id = $1', [a])
    expect(rows[0].known_at).not.toBeNull()
  })

  it('carries approved device approvals over as known phones, and nothing else', async () => {
    const other = await createMember(app.pg)
    await app.pg.query(
      `INSERT INTO device_approvals (member_id, device_id, state, denial_reason) VALUES
         ($1, 'ok-phone', 'approved', NULL),
         ($1, 'waiting-phone', 'pending', NULL),
         ($2, 'refused-phone', 'denied', 'not recognised')`,
      [member.id, other.id],
    )
    // Re-running the file is the migration's own idempotency promise, and the
    // quickest way to exercise its backfill against rows that exist now.
    const sql = await readFile(new URL('../../migrations/044_member_devices.sql', import.meta.url), 'utf8')
    await app.pg.query(sql)
    await app.pg.query(sql)

    const { rows } = await app.pg.query(
      'SELECT member_id, device_key, known_at FROM member_devices ORDER BY device_key')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ member_id: member.id, device_key: 'ok-phone' })
    expect(rows[0].known_at).not.toBeNull()
  })
})

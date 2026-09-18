import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, resetAuthTables, signIn } from '../helpers/auth.js'
import { hasDatabase } from '../helpers/db.js'

/**
 * §6.1 / §12.6 — device approval, and why the primary key is the mechanism.
 *
 * `device_approvals` is keyed `(member_id, device_id)`. That is not an
 * incidental choice: it means a member on a new device simply *has no row*, so
 * the re-approval requirement falls out of the key rather than out of a step
 * somebody has to remember to write. These tests assert the behaviour a member
 * sees, and then assert the key that produces it — because a well-meaning
 * change to either one alone would quietly re-admit an unapproved device.
 */
let app
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const KNOWN = 'device-known'
const FRESH = 'device-never-seen'

describe.skipIf(!hasDatabase)('a device must be approved before it signs in (§6.1)', () => {
  let member

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    // No mobile: this suite is about the approval gate alone, so the OTP step
    // that would otherwise follow it stays out of the way.
    member = await createMember(app.pg)
  })

  const approve = (deviceId, state = 'approved', denialReason = null) =>
    app.pg.query(
      `INSERT INTO device_approvals (member_id, device_id, state, denial_reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (member_id, device_id) DO UPDATE
         SET state = EXCLUDED.state, denial_reason = EXCLUDED.denial_reason`,
      [member.id, deviceId, state, denialReason],
    )

  it('routes a never-seen device to approval, issuing no token', async () => {
    const { statusCode, body } = await signIn(app, member.email, undefined, { deviceId: FRESH })
    expect(statusCode).toBe(200)
    expect(body.outcome).toBe('approval_pending')
    expect(body.accessToken).toBeUndefined()
    expect(body.refreshToken).toBeUndefined()

    const { rows } = await app.pg.query('SELECT id FROM sessions WHERE account_id = $1', [member.id])
    expect(rows).toHaveLength(0)
  })

  it('admits the same member once that device is approved', async () => {
    await approve(KNOWN)
    const { statusCode, body } = await signIn(app, member.email, undefined, { deviceId: KNOWN })
    expect(statusCode).toBe(200)
    expect(body.outcome).toBe('authenticated')
    expect(body.accessToken).toBeTruthy()
  })

  it('refuses a PENDING device — a row is not an approval', async () => {
    await approve(KNOWN, 'pending')
    const { body } = await signIn(app, member.email, undefined, { deviceId: KNOWN })
    expect(body.outcome).toBe('approval_pending')
    expect(body.accessToken).toBeUndefined()
  })

  it('refuses a DENIED device', async () => {
    await approve(KNOWN, 'denied', 'Not recognised by the committee')
    const { body } = await signIn(app, member.email, undefined, { deviceId: KNOWN })
    expect(body.outcome).toBe('approval_pending')
    expect(body.accessToken).toBeUndefined()
  })

  /**
   * The §12.6 claim, asserted directly: approving one device approves exactly
   * that device. This is the test that fails if someone ever "simplifies" the
   * key to `member_id` alone.
   */
  it('does not carry an approval across to a second device', async () => {
    await approve(KNOWN)
    const admitted = await signIn(app, member.email, undefined, { deviceId: KNOWN })
    expect(admitted.body.outcome).toBe('authenticated')

    const other = await signIn(app, member.email, undefined, { deviceId: FRESH })
    expect(other.body.outcome).toBe('approval_pending')
    expect(other.body.accessToken).toBeUndefined()
  })
})

describe.skipIf(!hasDatabase)('the key is what makes re-approval automatic (§12.6)', () => {
  let member
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    member = await createMember(app.pg)
  })

  it('keys approval on (member_id, device_id), so a new device has no row', async () => {
    const { rows } = await app.pg.query(
      `SELECT a.attname AS column_name
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'device_approvals'::regclass AND i.indisprimary
        ORDER BY a.attname`,
    )
    expect(rows.map((r) => r.column_name)).toEqual(['device_id', 'member_id'])
  })

  it('lets one member hold independent approvals for several devices', async () => {
    for (const device of ['phone', 'tablet', 'laptop']) {
      await app.pg.query(
        'INSERT INTO device_approvals (member_id, device_id, state) VALUES ($1, $2, $3)',
        [member.id, device, device === 'phone' ? 'approved' : 'pending'],
      )
    }
    const { rows } = await app.pg.query(
      `SELECT device_id, state FROM device_approvals WHERE member_id = $1 ORDER BY device_id`,
      [member.id],
    )
    expect(rows).toEqual([
      { device_id: 'laptop', state: 'pending' },
      { device_id: 'phone', state: 'approved' },
      { device_id: 'tablet', state: 'pending' },
    ])
  })

  /** §6.1 requires a reason on denial, which is emailed to the applicant. */
  it('refuses to record a denial with no reason', async () => {
    await expect(
      app.pg.query(
        'INSERT INTO device_approvals (member_id, device_id, state) VALUES ($1, $2, $3)',
        [member.id, 'phone', 'denied'],
      ),
    ).rejects.toThrow(/denial_states_its_reason/)
  })
})

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { ELIGIBLE_DEVICE } from '../../src/modules/push/application/audience.ts'
import { resetPush, memberWithDevice, addToTestList } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * `ELIGIBLE_DEVICE` — the one rule for who a notification reaches
 * (data-model.md "Audience query"). Asserted against the fragment itself, so
 * the materialisation, the per-batch re-check and the confirm dialog, which all
 * import it, are covered at once.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

async function eligible(audience: 'test' | 'broadcasts' | 'offers') {
  const { rows } = await app.pg.query(
    `SELECT d.id FROM push_devices d CROSS JOIN (SELECT $1::text AS audience) n WHERE ${ELIGIBLE_DEVICE}`,
    [audience],
  )
  return rows.map((r) => String(r.id))
}

async function applicant(state: string) {
  const member = await memberWithDevice(app)
  await app.pg.query(
    `INSERT INTO membership_applications (member_id, device_id, state, submitted_at, reviewed_at, denial_reason)
     VALUES ($1, 'device-x', $2::approval_state,
             CASE WHEN $2 = 'pending' THEN NULL ELSE now() END,
             CASE WHEN $2 = 'pending' THEN NULL ELSE now() END,
             CASE WHEN $2 = 'denied' THEN 'not a fit' END)`,
    [member.id, state],
  )
  return member
}

describe.skipIf(!hasDatabase)('ELIGIBLE_DEVICE', () => {
  it('includes an active member with an enabled device', async () => {
    // The counter-assertion for every exclusion below.
    const member = await memberWithDevice(app)
    expect(await eligible('broadcasts')).toEqual([member.deviceId])
  })

  it.each(['locked', 'inactive', 'ended'])('excludes a %s member', async (status) => {
    await memberWithDevice(app, { status })
    const active = await memberWithDevice(app)
    expect(await eligible('broadcasts')).toEqual([active.deviceId])
  })

  it('excludes an applicant who is not approved, and includes an approved one', async () => {
    await applicant('pending')
    await applicant('denied')
    const approved = await applicant('approved')
    expect(await eligible('broadcasts')).toEqual([approved.deviceId])
  })

  it('excludes a disabled device and one with a dead token', async () => {
    await memberWithDevice(app, { enabled: false })
    await memberWithDevice(app, { disabledReason: 'unregistered' })
    const fine = await memberWithDevice(app)
    expect(await eligible('broadcasts')).toEqual([fine.deviceId])
  })

  it('honours the preference for its own kind only', async () => {
    const noOffers = await memberWithDevice(app)
    await app.pg.query(
      'INSERT INTO member_push_preferences (member_id, offers, broadcasts) VALUES ($1, false, true)',
      [noOffers.id],
    )
    expect(await eligible('offers')).toEqual([])
    // Counter-assertion: switching off offers is not switching off club news.
    expect(await eligible('broadcasts')).toEqual([noOffers.deviceId])
  })

  it('reaches only the test list for a rehearsal, whatever the preferences say', async () => {
    const tester = await memberWithDevice(app)
    await memberWithDevice(app)
    await addToTestList(app.pg, tester.id)
    await app.pg.query(
      'INSERT INTO member_push_preferences (member_id, offers, broadcasts) VALUES ($1, false, false)',
      [tester.id],
    )
    expect(await eligible('test')).toEqual([tester.deviceId])
  })
})

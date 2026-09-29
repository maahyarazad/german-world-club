import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { approvedMember, profilingCalls } from './support.ts'
import type { GwcApp } from '../../src/app.ts'

/** The children of member_profiling are final with their parent — by trigger, not by the API. */

let app: GwcApp
let call: ReturnType<typeof profilingCalls>
beforeAll(async () => { app = await buildAuthApp(); call = profilingCalls(app) })
afterAll(async () => { await app.close() })
beforeEach(async () => { await resetAuthTables(app.pg) })

async function withKidsAndPartner() {
  const { memberId, authorization } = await approvedMember(app, 'FR')
  await call.patch(authorization, {
    primaryCity: { country: 'ZZ', city: 'Nowhere' }, relationshipStatus: ['kids', 'partner'],
    kids: ['age_0_6'], partner: { languages: ['en'], yearlyIncomeRange: 'up_to_50k', qualificationLevel: 'doctorate', occupation: 'other' },
  })
  return { memberId, authorization }
}

describe.skipIf(!hasDatabase)('member_profiling_kids / member_profiling_partner', () => {
  it('rejects bad values by CHECK', async () => {
    const { memberId } = await withKidsAndPartner()
    await expect(app.pg.query(`UPDATE member_profiling_kids SET age_range = 'toddler' WHERE member_id = $1`, [memberId])).rejects.toThrow(/age_range/)
    await expect(app.pg.query(`INSERT INTO member_profiling_kids VALUES ($1, 21, 'age_0_6')`, [memberId])).rejects.toThrow(/position/)
    await expect(app.pg.query(`UPDATE member_profiling_partner SET yearly_income_range = 'rich' WHERE member_id = $1`, [memberId])).rejects.toThrow(/yearly_income_range/)
  })

  it('allows changes and deletes before completion', async () => {
    const { memberId } = await withKidsAndPartner()
    await app.pg.query(`UPDATE member_profiling_kids SET age_range = 'age_6_14' WHERE member_id = $1`, [memberId])
    await app.pg.query('DELETE FROM member_profiling_kids WHERE member_id = $1', [memberId])
    await app.pg.query('DELETE FROM member_profiling_partner WHERE member_id = $1', [memberId])
  })

  it('refuses insert, update and delete once the parent is complete', async () => {
    const { memberId, authorization } = await withKidsAndPartner()
    expect((await call.submit(authorization)).statusCode).toBe(200)

    await expect(app.pg.query(`INSERT INTO member_profiling_kids VALUES ($1, 2, 'age_0_6')`, [memberId])).rejects.toThrow(/already complete/)
    await expect(app.pg.query(`UPDATE member_profiling_kids SET age_range = 'age_6_14' WHERE member_id = $1`, [memberId])).rejects.toThrow(/already complete/)
    await expect(app.pg.query('DELETE FROM member_profiling_kids WHERE member_id = $1', [memberId])).rejects.toThrow(/already complete/)
    await expect(app.pg.query(`UPDATE member_profiling_partner SET occupation = 'student' WHERE member_id = $1`, [memberId])).rejects.toThrow(/already complete/)
    await expect(app.pg.query('DELETE FROM member_profiling_partner WHERE member_id = $1', [memberId])).rejects.toThrow(/already complete/)

    // Counter-assertion: the data survived every attempt above.
    const { rows } = await app.pg.query('SELECT age_range FROM member_profiling_kids WHERE member_id = $1', [memberId])
    expect(rows).toEqual([{ age_range: 'age_0_6' }])
  })

  it('leaves a profiling row that completed before this revision final', async () => {
    const { memberId } = await approvedMember(app, 'FR')
    await app.pg.query(
      `INSERT INTO member_profiling (member_id, branch, primary_city_country, primary_city_name, outcome, completed_at)
       VALUES ($1, 'elsewhere', 'ZZ', 'Old', 'in_person_meeting', now())`, [memberId])
    await expect(app.pg.query(`UPDATE member_profiling SET relationship_tags = ARRAY['single'] WHERE member_id = $1`, [memberId]))
      .rejects.toThrow(/already complete/)
  })
})

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { approvedMember, profilingCalls, germanQ1toQ5, partnerAnswers } from './support.ts'
import type { GwcApp } from '../../src/app.ts'

/** Q6 — relationship, kids and partner — on both branches (Story 4). */

let app: GwcApp
let call: ReturnType<typeof profilingCalls>
beforeAll(async () => { app = await buildAuthApp(); call = profilingCalls(app) })
afterAll(async () => { await app.close() })
beforeEach(async () => { await resetAuthTables(app.pg) })

const countRows = async (memberId: string) => {
  const kids = await app.pg.query('SELECT count(*)::int AS n FROM member_profiling_kids WHERE member_id = $1', [memberId])
  const partner = await app.pg.query('SELECT count(*)::int AS n FROM member_profiling_partner WHERE member_id = $1', [memberId])
  return { kids: kids.rows[0].n as number, partner: partner.rows[0].n as number }
}

describe.skipIf(!hasDatabase)('relationship & family status', () => {
  it('refuses "single" together with any other tag, and accepts it alone', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    for (const other of ['partner', 'family', 'kids']) {
      const res = await call.patch(authorization, { relationshipStatus: ['single', other] })
      expect(res.statusCode).toBe(400)
    }
    const ok = await call.patch(authorization, { relationshipStatus: ['single'] })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().answers.relationshipStatus).toEqual(['single'])
  })

  it('the database refuses "single" + another tag even if the API were bypassed', async () => {
    const { memberId, authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { settlingStatus: 'know_where' })
    await expect(app.pg.query(
      `UPDATE member_profiling SET relationship_tags = ARRAY['single','kids'] WHERE member_id = $1`, [memberId],
    )).rejects.toThrow(/relationship_tags_valid/)
  })

  it('stores kids as one age range each and returns them in order', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    const res = await call.patch(authorization, {
      relationshipStatus: ['kids'], kids: ['age_0_6', 'age_18_plus', 'age_6_14'],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answers.kids).toEqual(['age_0_6', 'age_18_plus', 'age_6_14'])
  })

  it('refuses kids without the tag and a partner without partner/family', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { relationshipStatus: ['single'] })
    expect((await call.patch(authorization, { kids: ['age_0_6'] })).statusCode).toBe(400)
    expect((await call.patch(authorization, { partner: { occupation: 'student' } })).statusCode).toBe(400)
  })

  it('saves the partner one question at a time and keeps what was saved', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { relationshipStatus: ['partner'] })
    await call.patch(authorization, { partner: { yearlyIncomeRange: 'over_100k' } })
    const res = await call.patch(authorization, { partner: { languages: ['ar', 'en'], occupation: 'student' } })
    expect(res.json().answers.partner).toEqual({
      settlingStatus: null, settlingCountry: null, settlingCity: null, settlingWorkDuration: null,
      languages: ['ar', 'en'], yearlyIncomeRange: 'over_100k', qualificationLevel: null, occupation: 'student',
    })
  })

  it('validates partner answers with the same enums as the member\'s own', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { relationshipStatus: ['family'] })
    expect((await call.patch(authorization, { partner: { occupation: 'astronaut' } })).statusCode).toBe(400)
    expect((await call.patch(authorization, { partner: { languages: [] } })).statusCode).toBe(400)
  })

  it('discards kids and partner rows when the tags stop asking for them', async () => {
    const { memberId, authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, {
      relationshipStatus: ['kids', 'partner'], kids: ['age_0_6', 'age_14_18'], partner: { occupation: 'student' },
    })
    // Counter-assertion: the rows exist, so the deletions below mean something.
    expect(await countRows(memberId)).toEqual({ kids: 2, partner: 1 })

    let res = await call.patch(authorization, { relationshipStatus: ['partner'] })
    expect(res.json().answers.kids).toEqual([])
    expect(res.json().answers.partner).not.toBeNull()
    expect(await countRows(memberId)).toEqual({ kids: 0, partner: 1 })

    await call.patch(authorization, { relationshipStatus: ['kids'], kids: ['age_6_14'] })
    res = await call.patch(authorization, { relationshipStatus: ['kids'] })
    expect(res.json().answers.partner).toBeNull()
    expect(await countRows(memberId)).toEqual({ kids: 1, partner: 0 })

    await call.patch(authorization, { relationshipStatus: ['kids', 'family'], partner: { occupation: 'retired' } })
    await call.patch(authorization, { relationshipStatus: ['single'] })
    expect(await countRows(memberId)).toEqual({ kids: 0, partner: 0 })
  })

  it('a changed kid count replaces the list', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { relationshipStatus: ['kids'], kids: ['age_0_6', 'age_0_6', 'age_6_14'] })
    const res = await call.patch(authorization, { kids: ['age_14_18'] })
    expect(res.json().answers.kids).toEqual(['age_14_18'])
  })

  it('German: submit needs kids ages and every partner answer, then Q7', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { ...germanQ1toQ5, relationshipStatus: ['kids', 'partner'], desiredWorkType: 'business_owner' })
    await call.patch(authorization, { futureWorkSector: 'technology_it', futureWorkBusinessActivities: ['sales'] })

    let res = await call.submit(authorization)
    expect(res.statusCode).toBe(409)
    expect(res.json().type).toBe(PROBLEMS.PROFILING_ANSWERS_MISSING.type)
    expect(res.json().detail).toContain('kids')
    // The partner is asked the whole questionnaire from Q1, settling included.
    expect(res.json().detail).toContain('partner-settling')
    expect(res.json().detail).toContain('partner-income')

    await call.patch(authorization, { kids: ['age_0_6'] })
    await call.patch(authorization, { partner: { settlingStatus: 'need_help', languages: ['de'] } })
    res = await call.submit(authorization)
    expect(res.statusCode).toBe(409) // partner qualification, occupation and income still missing
    expect(res.json().detail).not.toContain('partner-settling')
    expect(res.json().detail).not.toContain('partner-languages')
    expect(res.json().detail).not.toContain('kids')

    await call.patch(authorization, { partner: { yearlyIncomeRange: 'up_to_50k', qualificationLevel: 'diploma_certificate', occupation: 'teacher_educator' } })
    res = await call.submit(authorization)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ completed: true })
  })

  it('non-German with a GWC city: Q6 and the partner section, then review, with no Q7', async () => {
    const gwc = (await app.pg.query('SELECT country, city FROM gwc_cities ORDER BY city LIMIT 1')).rows[0]
    const { authorization } = await approvedMember(app, 'FR')
    await call.patch(authorization, { primaryCity: gwc, relationshipStatus: ['family'], partner: { ...partnerAnswers } })
    const res = await call.submit(authorization)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ completed: true, outcome: 'gwc_city_match' })
    expect(res.json().answers.partner.occupation).toBe('engineer')
  })

  it('non-German without a GWC city: no Q6 at all, straight to review', async () => {
    const { authorization } = await approvedMember(app, 'FR')
    await call.patch(authorization, { primaryCity: { country: 'ZZ', city: 'Nowhere' } })
    expect((await call.patch(authorization, { relationshipStatus: ['family'] })).statusCode).toBe(400)
    expect((await call.submit(authorization)).json()).toMatchObject({ completed: true, outcome: 'in_person_meeting' })
  })

  it('a non-German member cannot send German-only answers', async () => {
    const { authorization } = await approvedMember(app, 'FR')
    expect((await call.patch(authorization, { occupation: 'student' })).statusCode).toBe(400)
  })
})

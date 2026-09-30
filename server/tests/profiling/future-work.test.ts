import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createMember, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Onboarding Phase 2 (feature 013): Q5's conditional follow-up questions
 * (FR-009–FR-012, FR-022), added after the business description grew.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => { await resetAuthTables(app.pg) })

async function approvedGermanMember() {
  const row = await createMember(app.pg, { passwordHash: null })
  await app.pg.query(`UPDATE members SET country_of_residence = 'DE' WHERE id = $1`, [row.id])
  await app.pg.query(
    `INSERT INTO membership_applications (member_id, device_id, state, submitted_at, reviewed_at)
     VALUES ($1, 'device-x', 'approved', now(), now())`,
    [row.id],
  )
  const { authorization } = await bearerFor(app, { accountId: String(row.id), accountKind: 'member' })
  return { memberId: row.id, authorization }
}

// Q1-Q6 answered ("single" asks nothing further); these tests are about Q7.
const baseFive = {
  settlingStatus: 'need_help', languages: ['en'], yearlyIncomeRange: '50k_to_100k',
  qualificationLevel: 'bachelors_degree', occupation: 'engineer', relationshipStatus: ['single'],
}
const submit = (headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/profiling/submit', headers })
const missingFor = async (headers: Record<string, string>) => (await submit(headers)).statusCode

const patch = (headers: Record<string, string>, payload: object) =>
  app.inject({ method: 'PATCH', url: '/profiling', headers, payload })
const status = (headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/profiling/status', headers })

describe.skipIf(!hasDatabase)('Q7 conditional follow-ups', () => {
  it('Employee: submit is refused until industry and readiness are both answered', async () => {
    const { authorization } = await approvedGermanMember()
    await patch({ authorization }, { ...baseFive, desiredWorkType: 'employee' })
    expect(await missingFor({ authorization })).toBe(409)

    let res = await patch({ authorization }, { futureWorkSector: 'technology_it' })
    expect(res.json().answers.futureWorkSector).toBe('technology_it')
    expect(await missingFor({ authorization })).toBe(409)

    res = await patch({ authorization }, { futureWorkReady: true })
    expect(res.json().answers.futureWorkReady).toBe(true)
    expect(res.json().completed).toBe(false)
    expect((await submit({ authorization })).json().completed).toBe(true)
  })

  it('Freelancer: asks offering, industry and idea', async () => {
    const { authorization } = await approvedGermanMember()
    await patch({ authorization }, { ...baseFive, desiredWorkType: 'freelance', futureWorkOffering: 'Graphic design' })
    await patch({ authorization }, { futureWorkSector: 'marketing_advertising' })
    expect(await missingFor({ authorization })).toBe(409)
    await patch({ authorization }, { futureWorkIdea: 'Branding for small businesses' })
    expect((await submit({ authorization })).json().completed).toBe(true)
  })

  it('Business Owner: asks the industry and at least one activity, and refuses an offering or idea', async () => {
    const { authorization } = await approvedGermanMember()
    await patch({ authorization }, { ...baseFive, desiredWorkType: 'business_owner' })
    expect((await patch({ authorization }, { futureWorkOffering: 'x' })).statusCode).toBe(400)
    expect((await patch({ authorization }, { futureWorkIdea: 'x' })).statusCode).toBe(400)
    expect((await patch({ authorization }, { futureWorkBusinessActivities: [] })).statusCode).toBe(400)
    expect((await patch({ authorization }, { futureWorkBusinessActivities: ['bake'] })).statusCode).toBe(400)

    await patch({ authorization }, { futureWorkSector: 'hospitality_tourism' })
    expect(await missingFor({ authorization })).toBe(409)
    const res = await patch({ authorization }, { futureWorkBusinessActivities: ['produce', 'sales'] })
    expect(res.json().answers.futureWorkBusinessActivities).toEqual(['produce', 'sales'])
    expect((await submit({ authorization })).json().completed).toBe(true)
  })

  it('Build my own business: asks the same three questions as Freelancer', async () => {
    const { authorization } = await approvedGermanMember()
    await patch({ authorization }, {
      ...baseFive, desiredWorkType: 'own_business',
      futureWorkOffering: 'A coffee shop', futureWorkSector: 'food_beverage', futureWorkIdea: 'Specialty Arabic coffee',
    })
    expect((await submit({ authorization })).json().completed).toBe(true)
  })

  it('Not sure yet: one or more statements and NO industry', async () => {
    const { authorization } = await approvedGermanMember()
    await patch({ authorization }, { ...baseFive, desiredWorkType: 'not_sure' })

    expect((await patch({ authorization }, { futureWorkPriorities: [] })).statusCode).toBe(400)
    expect((await patch({ authorization }, { futureWorkPriorities: ['nonsense'] })).statusCode).toBe(400)
    // This path asks no industry, so one is refused rather than stored.
    expect((await patch({ authorization }, { futureWorkSector: 'technology_it' })).statusCode).toBe(400)
    expect(await missingFor({ authorization })).toBe(409)

    const res = await patch({ authorization }, { futureWorkPriorities: ['family_time', 'balance_lifestyle'] })
    expect(res.json().answers.futureWorkPriorities).toEqual(['family_time', 'balance_lifestyle'])
    expect((await submit({ authorization })).json().completed).toBe(true)
  })

  it('refuses an industry outside the list on every path that asks one', async () => {
    const { authorization } = await approvedGermanMember()
    await patch({ authorization }, { ...baseFive, desiredWorkType: 'employee' })
    expect((await patch({ authorization }, { futureWorkSector: 'Retail shop' })).statusCode).toBe(400)
  })

  it('discards the previous path\'s follow-ups when the Q7 answer changes, whatever the pair', async () => {
    const types = ['employee', 'freelance', 'business_owner', 'own_business', 'not_sure'] as const
    const seed: Record<string, object> = {
      employee: { futureWorkSector: 'technology_it', futureWorkReady: true },
      freelance: { futureWorkOffering: 'B', futureWorkSector: 'technology_it', futureWorkIdea: 'C' },
      business_owner: { futureWorkSector: 'technology_it', futureWorkBusinessActivities: ['sales'] },
      own_business: { futureWorkOffering: 'B', futureWorkSector: 'technology_it', futureWorkIdea: 'C' },
      not_sure: { futureWorkPriorities: ['family_time'] },
    }
    for (const from of types) {
      for (const to of types) {
        if (from === to) continue
        const { memberId, authorization } = await approvedGermanMember()
        await patch({ authorization }, { ...baseFive, desiredWorkType: from, ...seed[from] })
        const switched = await patch({ authorization }, { desiredWorkType: to })
        expect(switched.statusCode, `${from} -> ${to}`).toBe(200)
        expect(switched.json().completed).toBe(false)

        const { rows } = await app.pg.query(
          `SELECT future_work_sector, future_work_ready, future_work_offering, future_work_idea,
                  future_work_business_activities, future_work_priorities FROM member_profiling WHERE member_id = $1`,
          [memberId],
        )
        expect(Object.values(rows[0]).every((v) => v === null), `${from} -> ${to}`).toBe(true)
        // Nothing carried over, so the new path is fully unanswered.
        expect(await missingFor({ authorization })).toBe(409)
        await app.pg.query('TRUNCATE member_profiling RESTART IDENTITY CASCADE')
      }
    }
  })

  it('rejects a follow-up field that contradicts the desired work type in the same call', async () => {
    const { authorization } = await approvedGermanMember()
    const res = await patch({ authorization }, { ...baseFive, desiredWorkType: 'employee', futureWorkOffering: 'x' })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a follow-up field sent before Q7 is answered', async () => {
    const { authorization } = await approvedGermanMember()
    const res = await patch({ authorization }, { futureWorkSector: 'technology_it' })
    expect(res.statusCode).toBe(400)
  })

  it('reports null follow-up answers before Q7 is answered', async () => {
    const { authorization } = await approvedGermanMember()
    const body = (await status({ authorization })).json()
    expect(body.answers).toMatchObject({
      futureWorkSector: null, futureWorkReady: null, futureWorkOffering: null,
      futureWorkIdea: null, futureWorkBusinessActivities: null, futureWorkPriorities: null,
    })
  })
})

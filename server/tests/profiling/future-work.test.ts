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

const baseFive = {
  settlingStatus: 'know_where', languages: ['en'], qualificationLevel: 'bachelors_degree', occupation: 'engineer',
}

const patch = (headers: Record<string, string>, payload: object) =>
  app.inject({ method: 'PATCH', url: '/profiling', headers, payload })
const status = (headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/profiling/status', headers })

describe.skipIf(!hasDatabase)('Q5 conditional follow-ups', () => {
  it('Employee: does not complete until sector and readiness are both answered', async () => {
    const { authorization } = await approvedGermanMember()
    let res = await patch({ authorization }, { ...baseFive, desiredWorkType: 'employee' })
    expect(res.json().completed).toBe(false)

    res = await patch({ authorization }, { futureWorkSector: 'IT / Software' })
    expect(res.json().completed).toBe(false)
    expect(res.json().answers.futureWorkSector).toBe('IT / Software')

    res = await patch({ authorization }, { futureWorkReady: true })
    expect(res.statusCode).toBe(200)
    expect(res.json().completed).toBe(true)
    expect(res.json().answers.futureWorkReady).toBe(true)
  })

  it('Freelance: does not complete until offering and idea are both answered', async () => {
    const { authorization } = await approvedGermanMember()
    await patch({ authorization }, { ...baseFive, desiredWorkType: 'freelance' })
    let res = await patch({ authorization }, { futureWorkOffering: 'Graphic design' })
    expect(res.json().completed).toBe(false)
    res = await patch({ authorization }, { futureWorkIdea: 'Branding for small businesses' })
    expect(res.json().completed).toBe(true)
  })

  it('Build own business: asks the identical pair of questions as Freelance', async () => {
    const { authorization } = await approvedGermanMember()
    const res = await patch({ authorization }, {
      ...baseFive, desiredWorkType: 'own_business',
      futureWorkOffering: 'A coffee shop', futureWorkIdea: 'Specialty Arabic coffee',
    })
    expect(res.json().completed).toBe(true)
  })

  it('Not sure yet: requires at least one selected priority, allows more than one', async () => {
    const { authorization } = await approvedGermanMember()
    await patch({ authorization }, { ...baseFive, desiredWorkType: 'not_sure' })

    const empty = await patch({ authorization }, { futureWorkPriorities: [] })
    expect(empty.statusCode).toBe(400)

    const res = await patch({ authorization }, { futureWorkPriorities: ['family_time', 'balance_lifestyle'] })
    expect(res.statusCode).toBe(200)
    expect(res.json().completed).toBe(true)
    expect(res.json().answers.futureWorkPriorities).toEqual(['family_time', 'balance_lifestyle'])
  })

  it('discards the previous branch\'s follow-up when the Q5 answer changes before completion', async () => {
    const { memberId, authorization } = await approvedGermanMember()
    await patch({ authorization }, { ...baseFive, desiredWorkType: 'employee' })
    await patch({ authorization }, { futureWorkSector: 'Finance' })

    // Switch to Freelance before finishing Employee's follow-up.
    const switched = await patch({ authorization }, { desiredWorkType: 'freelance' })
    expect(switched.statusCode).toBe(200)
    expect(switched.json().completed).toBe(false)
    expect(switched.json().answers.futureWorkSector).toBeNull()

    const { rows } = await app.pg.query(
      'SELECT future_work_sector, future_work_ready, future_work_offering, future_work_idea FROM member_profiling WHERE member_id = $1',
      [memberId],
    )
    expect(rows[0]).toMatchObject({
      future_work_sector: null, future_work_ready: null, future_work_offering: null, future_work_idea: null,
    })

    // Only Freelance's own follow-up is now required.
    await patch({ authorization }, { futureWorkOffering: 'Consulting' })
    const done = await patch({ authorization }, { futureWorkIdea: 'Small-business strategy' })
    expect(done.json().completed).toBe(true)
  })

  it('rejects a follow-up field that contradicts the desired work type in the same call', async () => {
    const { authorization } = await approvedGermanMember()
    const res = await patch({ authorization }, { ...baseFive, desiredWorkType: 'employee', futureWorkOffering: 'x' })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a follow-up field sent before Q5 is answered', async () => {
    const { authorization } = await approvedGermanMember()
    const res = await patch({ authorization }, { futureWorkSector: 'IT' })
    expect(res.statusCode).toBe(400)
  })

  it('reports null follow-up answers before Q5 is answered', async () => {
    const { authorization } = await approvedGermanMember()
    const body = (await status({ authorization })).json()
    expect(body.answers).toMatchObject({
      futureWorkSector: null, futureWorkReady: null, futureWorkOffering: null,
      futureWorkIdea: null, futureWorkPriorities: null,
    })
  })
})

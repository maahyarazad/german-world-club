import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, resetAuthTables, createMember, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

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

const status = (headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/profiling/status', headers })
const patch = (headers: Record<string, string>, payload: object) =>
  app.inject({ method: 'PATCH', url: '/profiling', headers, payload })
const submit = (headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/profiling/submit', headers })

// Q1-Q5 and Q6 ("single" asks nothing further), so a test can focus on Q7.
const upToQ6 = {
  settlingStatus: 'need_help', languages: ['en'], yearlyIncomeRange: '50k_to_100k',
  qualificationLevel: 'masters_degree', occupation: 'engineer', relationshipStatus: ['single'],
}

describe.skipIf(!hasDatabase)('the German pathway covers Germany, Austria and Switzerland', () => {
  async function approvedFrom(country: string) {
    const row = await createMember(app.pg, { passwordHash: null })
    await app.pg.query('UPDATE members SET country_of_residence = $2 WHERE id = $1', [row.id, country])
    await app.pg.query(
      `INSERT INTO membership_applications (member_id, device_id, state, submitted_at, reviewed_at)
       VALUES ($1, 'device-x', 'approved', now(), now())`, [row.id])
    const { authorization } = await bearerFor(app, { accountId: String(row.id), accountKind: 'member' })
    return { memberId: row.id, authorization }
  }

  it.each(['DE', 'AT', 'CH'])('%s starts on the German pathway and is asked settling first', async (country) => {
    const { authorization } = await approvedFrom(country)
    expect((await status({ authorization })).json().branch).toBe('germany')
    // Q7 and the settling answers belong to this pathway only: they are accepted here.
    expect((await patch({ authorization }, { settlingStatus: 'need_help', desiredWorkType: 'employee' })).statusCode).toBe(200)
  })

  it.each(['FR', 'AE', 'US'])('%s follows the non-German pathway', async (country) => {
    const { authorization } = await approvedFrom(country)
    expect((await status({ authorization })).json().branch).toBe('elsewhere')
    expect((await patch({ authorization }, { settlingStatus: 'need_help' })).statusCode).toBe(400)
  })
})

describe.skipIf(!hasDatabase)('the German profiling flow (Story 1)', () => {
  it('starts on the germany branch with nothing answered', async () => {
    const { authorization } = await approvedGermanMember()
    const body = (await status({ authorization })).json()
    expect(body.branch).toBe('germany')
    expect(body.completed).toBe(false)
    expect(body.answers).toMatchObject({
      settlingStatus: null, settlingCountry: null, settlingCity: null, settlingWorkDuration: null,
      languages: null, yearlyIncomeRange: null, qualificationLevel: null, occupation: null,
      relationshipStatus: null, kids: [], partner: null, desiredWorkType: null,
    })
  })

  it('answers one question at a time, resuming correctly, and completes only on submit', async () => {
    const { authorization } = await approvedGermanMember()

    let res = await patch({ authorization }, { settlingStatus: 'know_where' })
    expect(res.statusCode).toBe(200)
    expect(res.json().completed).toBe(false)

    // A fresh status read — simulating a new session — still shows Q1 answered.
    expect((await status({ authorization })).json().answers.settlingStatus).toBe('know_where')

    // "Yes" is not enough on its own: the place is asked too.
    res = await patch({ authorization }, { settlingCountry: 'DE', settlingCity: 'Berlin' })
    expect(res.json().answers).toMatchObject({ settlingCountry: 'DE', settlingCity: 'Berlin' })

    res = await patch({ authorization }, { languages: ['en', 'de'] })
    expect(res.json().answers.languages).toEqual(['en', 'de'])

    res = await patch({ authorization }, { yearlyIncomeRange: 'over_100k' })
    expect(res.json().answers.yearlyIncomeRange).toBe('over_100k')

    await patch({ authorization }, { qualificationLevel: 'bachelors_degree' })
    await patch({ authorization }, { occupation: 'it_software_professional' })
    await patch({ authorization }, { relationshipStatus: ['single'] })
    await patch({ authorization }, { desiredWorkType: 'employee' })
    res = await patch({ authorization }, { futureWorkSector: 'technology_it', futureWorkReady: true })
    expect(res.statusCode).toBe(200)
    // Every answer is in, and it is still not complete: only submit completes.
    expect(res.json().completed).toBe(false)

    res = await submit({ authorization })
    expect(res.statusCode).toBe(200)
    expect(res.json().completed).toBe(true)

    const final = (await status({ authorization })).json()
    expect(final).toMatchObject({
      branch: 'germany',
      completed: true,
      answers: {
        settlingStatus: 'know_where',
        settlingCountry: 'DE',
        settlingCity: 'Berlin',
        languages: ['en', 'de'],
        yearlyIncomeRange: 'over_100k',
        qualificationLevel: 'bachelors_degree',
        occupation: 'it_software_professional',
        relationshipStatus: ['single'],
        desiredWorkType: 'employee',
      },
    })
  })

  it('accepts more than one answer per call', async () => {
    const { authorization } = await approvedGermanMember()
    const res = await patch({ authorization }, {
      ...upToQ6, desiredWorkType: 'not_sure', futureWorkPriorities: ['wealth_reputation'],
    })
    expect(res.statusCode).toBe(200)
    expect((await submit({ authorization })).json().completed).toBe(true)
  })

  it('refuses any further change once complete', async () => {
    const { authorization } = await approvedGermanMember()
    await patch({ authorization }, {
      ...upToQ6, desiredWorkType: 'employee', futureWorkSector: 'technology_it', futureWorkReady: true,
    })
    await submit({ authorization })
    const again = await patch({ authorization }, { settlingStatus: 'need_help' })
    expect(again.statusCode).toBe(409)
    expect(again.json().type).toBe(PROBLEMS.CONFLICT.type)
  })

  it('rejects an elsewhere-branch field from a germany-branch member', async () => {
    const { authorization } = await approvedGermanMember()
    const res = await patch({ authorization }, { primaryCity: { country: 'GB', city: 'London' } })
    expect(res.statusCode).toBe(400)
  })

  it('requires at least one language when the languages field is given', async () => {
    const { authorization } = await approvedGermanMember()
    const res = await patch({ authorization }, { languages: [] })
    expect(res.statusCode).toBe(400)
  })
})

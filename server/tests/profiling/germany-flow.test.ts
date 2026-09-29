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

describe.skipIf(!hasDatabase)('the German profiling flow (Story 1)', () => {
  it('starts on the germany branch with nothing answered', async () => {
    const { authorization } = await approvedGermanMember()
    const body = (await status({ authorization })).json()
    expect(body.branch).toBe('germany')
    expect(body.completed).toBe(false)
    expect(body.answers).toMatchObject({
      settlingStatus: null, languages: null, qualificationLevel: null, occupation: null, desiredWorkType: null,
    })
  })

  it('answers one question at a time, resuming correctly, and completes on the fifth', async () => {
    const { authorization } = await approvedGermanMember()

    let res = await patch({ authorization }, { settlingStatus: 'know_where' })
    expect(res.statusCode).toBe(200)
    expect(res.json().completed).toBe(false)

    // A fresh status read — simulating a new session — still shows Q1 answered.
    expect((await status({ authorization })).json().answers.settlingStatus).toBe('know_where')

    res = await patch({ authorization }, { languages: ['en', 'de'] })
    expect(res.json().answers.languages).toEqual(['en', 'de'])
    expect(res.json().completed).toBe(false)

    res = await patch({ authorization }, { qualificationLevel: 'bachelors_degree' })
    expect(res.json().completed).toBe(false)

    res = await patch({ authorization }, { occupation: 'it_software_professional' })
    expect(res.json().completed).toBe(false)

    res = await patch({ authorization }, { desiredWorkType: 'employee' })
    expect(res.statusCode).toBe(200)
    expect(res.json().completed).toBe(true)

    const final = (await status({ authorization })).json()
    expect(final).toMatchObject({
      branch: 'germany',
      completed: true,
      answers: {
        settlingStatus: 'know_where',
        languages: ['en', 'de'],
        qualificationLevel: 'bachelors_degree',
        occupation: 'it_software_professional',
        desiredWorkType: 'employee',
      },
    })
  })

  it('accepts more than one answer per call', async () => {
    const { authorization } = await approvedGermanMember()
    const res = await patch({ authorization }, {
      settlingStatus: 'need_help', languages: ['ar'], qualificationLevel: 'doctorate',
      occupation: 'consultant', desiredWorkType: 'not_sure',
    })
    expect(res.json().completed).toBe(true)
  })

  it('refuses any further change once complete', async () => {
    const { authorization } = await approvedGermanMember()
    await patch({ authorization }, {
      settlingStatus: 'know_where', languages: ['en'], qualificationLevel: 'masters_degree',
      occupation: 'engineer', desiredWorkType: 'employee',
    })
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

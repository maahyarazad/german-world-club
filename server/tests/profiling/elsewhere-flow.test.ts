import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, resetAuthTables, createMember, createAdmin, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

let app: GwcApp
// Read from the real table rather than hardcoded, so this suite survives the
// reference list being edited (it already has been, more than once).
let SEEDED_MATCH: { country: string; city: string }
let OTHER_MATCH: { country: string; city: string }

beforeAll(async () => {
  app = await buildAuthApp()
  const { rows } = await app.pg.query('SELECT country, city FROM gwc_cities ORDER BY country, city')
  if (rows.length < 2) throw new Error('gwc_cities needs at least 2 seeded rows for this suite to mean anything')
  ;[SEEDED_MATCH, OTHER_MATCH] = rows as [{ country: string; city: string }, { country: string; city: string }]
})
afterAll(async () => { await app.close() })
beforeEach(async () => { await resetAuthTables(app.pg) })

async function approvedMember(country: string) {
  const row = await createMember(app.pg, { passwordHash: null })
  await app.pg.query('UPDATE members SET country_of_residence = $2 WHERE id = $1', [row.id, country])
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

// Cities, then Q6 ("single") only when a GWC city matched — a member with no
// match is never asked it — then submit. The elsewhere branch has no Q7.
async function saveAndSubmit(headers: Record<string, string>, cities: object) {
  const saved = await patch(headers, cities)
  expect(saved.statusCode).toBe(200)
  if (saved.json().answers.gwcMatch) {
    expect((await patch(headers, { relationshipStatus: ['single'] })).statusCode).toBe(200)
  }
  return submit(headers)
}

async function staffApplications(state = 'approved') {
  const admin = await createAdmin(app.pg, { grants: { members: { read: true } } })
  const { authorization } = await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' })
  const res = await app.inject({
    method: 'GET', url: `/admin/onboarding/applications?state=${state}`, headers: { authorization },
  })
  return res.json().items as Array<{ memberId: string; profiling: unknown }>
}

// Guaranteed not to be in the gwc_cities seed (server/migrations/032_profiling.sql).
const UNLISTED = { country: 'ZZ', city: 'Nonexistentville' }

describe.skipIf(!hasDatabase)('the non-German nearest-city flow (Stories 2 & 3)', () => {
  it('stores the GWC match when the cities are saved; the outcome waits for submit', async () => {
    const { authorization } = await approvedMember('FR')
    const saved = await patch({ authorization }, { primaryCity: SEEDED_MATCH, secondaryCities: [] })
    expect(saved.json()).toMatchObject({ completed: false, outcome: null, matchedCity: SEEDED_MATCH })
    expect(saved.json().answers).toMatchObject({ primaryCity: SEEDED_MATCH, gwcMatch: true })
  })

  it('a member with no GWC city goes straight to submit and is never asked Q6', async () => {
    const { authorization } = await approvedMember('FR')
    const saved = await patch({ authorization }, { primaryCity: UNLISTED })
    expect(saved.json().answers.gwcMatch).toBe(false)
    expect((await patch({ authorization }, { relationshipStatus: ['single'] })).statusCode).toBe(400)
    // Counter-assertion: the same answer is accepted once a GWC city matches.
    await patch({ authorization }, { primaryCity: SEEDED_MATCH })
    expect((await patch({ authorization }, { relationshipStatus: ['single'] })).statusCode).toBe(200)
  })

  it('a match that stops matching deletes the Q6, kids and partner answers', async () => {
    const { memberId, authorization } = await approvedMember('FR')
    await patch({ authorization }, { primaryCity: SEEDED_MATCH })
    await patch({ authorization }, { relationshipStatus: ['kids', 'partner'], kids: ['age_0_6'], partner: { occupation: 'student' } })
    const changed = await patch({ authorization }, { primaryCity: UNLISTED })
    expect(changed.json().answers).toMatchObject({ gwcMatch: false, relationshipStatus: null, kids: [], partner: null })
    const kids = await app.pg.query('SELECT 1 FROM member_profiling_kids WHERE member_id = $1', [memberId])
    expect(kids.rows).toHaveLength(0)
  })

  it('starts on the elsewhere branch', async () => {
    const { authorization } = await approvedMember('FR')
    expect((await status({ authorization })).json().branch).toBe('elsewhere')
  })

  it('requires a primary city with the secondaries, and before submit', async () => {
    const { authorization } = await approvedMember('FR')
    const res = await patch({ authorization }, { secondaryCities: [UNLISTED] })
    expect(res.statusCode).toBe(400)

    await patch({ authorization }, { relationshipStatus: ['single'] })
    const refused = await submit({ authorization })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().type).toBe(PROBLEMS.PROFILING_ANSWERS_MISSING.type)
  })

  it('rejects a secondary city identical to the primary', async () => {
    const { authorization } = await approvedMember('FR')
    const res = await patch({ authorization }, { primaryCity: UNLISTED, secondaryCities: [UNLISTED] })
    expect(res.statusCode).toBe(400)
  })

  it('rejects two identical secondary cities', async () => {
    const { authorization } = await approvedMember('FR')
    const res = await patch({ authorization }, {
      primaryCity: UNLISTED,
      secondaryCities: [{ country: 'US', city: 'Nowhere' }, { country: 'US', city: 'Nowhere' }],
    })
    expect(res.statusCode).toBe(400)
  })

  it('resolves to an in-person meeting when nothing matches a GWC city (Story 2)', async () => {
    const { memberId, authorization } = await approvedMember('FR')
    const res = await saveAndSubmit({ authorization }, { primaryCity: UNLISTED, secondaryCities: [] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ completed: true, outcome: 'in_person_meeting', matchedCity: null })

    const [row] = await staffApplications()
    expect(row.memberId).toBe(memberId)
    expect(row.profiling).toMatchObject({ completed: true, branch: 'elsewhere', outcome: 'in_person_meeting' })
  })

  it('resolves to a GWC city match on the primary city (Story 3)', async () => {
    const { memberId, authorization } = await approvedMember('FR')
    const res = await saveAndSubmit({ authorization }, { primaryCity: SEEDED_MATCH, secondaryCities: [] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      completed: true, outcome: 'gwc_city_match', matchedCity: SEEDED_MATCH,
    })

    const [row] = await staffApplications()
    expect(row.profiling).toMatchObject({ outcome: 'gwc_city_match', matchedCity: SEEDED_MATCH })
  })

  it('resolves to a GWC city match on a secondary city when the primary does not match', async () => {
    const { authorization } = await approvedMember('FR')
    const res = await saveAndSubmit({ authorization }, {
      primaryCity: UNLISTED, secondaryCities: [SEEDED_MATCH],
    })
    expect(res.json()).toMatchObject({ outcome: 'gwc_city_match', matchedCity: SEEDED_MATCH })
  })

  it('checks the primary city before secondaries when both would match', async () => {
    const { authorization } = await approvedMember('FR')
    const res = await saveAndSubmit({ authorization }, {
      primaryCity: SEEDED_MATCH, secondaryCities: [OTHER_MATCH],
    })
    expect(res.json().matchedCity).toEqual(SEEDED_MATCH)
  })

  it('is case-insensitive on city name', async () => {
    const { authorization } = await approvedMember('FR')
    const res = await saveAndSubmit({ authorization }, {
      primaryCity: { country: SEEDED_MATCH.country, city: SEEDED_MATCH.city.toUpperCase() },
      secondaryCities: [],
    })
    expect(res.json().outcome).toBe('gwc_city_match')
  })

  it('refuses any further change once complete', async () => {
    const { authorization } = await approvedMember('FR')
    await saveAndSubmit({ authorization }, { primaryCity: UNLISTED, secondaryCities: [] })
    const again = await patch({ authorization }, { primaryCity: SEEDED_MATCH, secondaryCities: [] })
    expect(again.statusCode).toBe(409)
    expect((await submit({ authorization })).statusCode).toBe(409)
  })
})

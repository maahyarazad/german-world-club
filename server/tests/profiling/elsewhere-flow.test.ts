import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
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
  it('starts on the elsewhere branch', async () => {
    const { authorization } = await approvedMember('FR')
    expect((await status({ authorization })).json().branch).toBe('elsewhere')
  })

  it('requires a primary city', async () => {
    const { authorization } = await approvedMember('FR')
    const res = await patch({ authorization }, { secondaryCities: [UNLISTED] })
    expect(res.statusCode).toBe(400)
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
    const res = await patch({ authorization }, { primaryCity: UNLISTED, secondaryCities: [] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ completed: true, outcome: 'in_person_meeting', matchedCity: null })

    const [row] = await staffApplications()
    expect(row.memberId).toBe(memberId)
    expect(row.profiling).toMatchObject({ completed: true, branch: 'elsewhere', outcome: 'in_person_meeting' })
  })

  it('resolves to a GWC city match on the primary city (Story 3)', async () => {
    const { memberId, authorization } = await approvedMember('FR')
    const res = await patch({ authorization }, { primaryCity: SEEDED_MATCH, secondaryCities: [] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      completed: true, outcome: 'gwc_city_match', matchedCity: SEEDED_MATCH,
    })

    const [row] = await staffApplications()
    expect(row.profiling).toMatchObject({ outcome: 'gwc_city_match', matchedCity: SEEDED_MATCH })
  })

  it('resolves to a GWC city match on a secondary city when the primary does not match', async () => {
    const { authorization } = await approvedMember('FR')
    const res = await patch({ authorization }, {
      primaryCity: UNLISTED, secondaryCities: [SEEDED_MATCH],
    })
    expect(res.json()).toMatchObject({ outcome: 'gwc_city_match', matchedCity: SEEDED_MATCH })
  })

  it('checks the primary city before secondaries when both would match', async () => {
    const { authorization } = await approvedMember('FR')
    const res = await patch({ authorization }, {
      primaryCity: SEEDED_MATCH, secondaryCities: [OTHER_MATCH],
    })
    expect(res.json().matchedCity).toEqual(SEEDED_MATCH)
  })

  it('is case-insensitive on city name', async () => {
    const { authorization } = await approvedMember('FR')
    const res = await patch({ authorization }, {
      primaryCity: { country: SEEDED_MATCH.country, city: SEEDED_MATCH.city.toUpperCase() },
      secondaryCities: [],
    })
    expect(res.json().outcome).toBe('gwc_city_match')
  })

  it('refuses any further change once complete', async () => {
    const { authorization } = await approvedMember('FR')
    await patch({ authorization }, { primaryCity: UNLISTED, secondaryCities: [] })
    const again = await patch({ authorization }, { primaryCity: SEEDED_MATCH, secondaryCities: [] })
    expect(again.statusCode).toBe(409)
  })
})

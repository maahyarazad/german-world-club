import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { approvedMember, profilingCalls } from './support.ts'
import type { GwcApp } from '../../src/app.ts'

/** The InterNations country/city list, merged with the club's designated cities. */

let app: GwcApp
let call: ReturnType<typeof profilingCalls>
beforeAll(async () => { app = await buildAuthApp(); call = profilingCalls(app) })
afterAll(async () => { await app.close() })
beforeEach(async () => { await resetAuthTables(app.pg) })

const cities = (authorization: string, query: string) =>
  app.inject({ method: 'GET', url: `/profiling/cities?${query}`, headers: { authorization } })

describe.skipIf(!hasDatabase)('GET /profiling/cities', () => {
  it('lists the workbook cities for a country, capital first', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    const res = await cities(authorization, 'country=DE')
    expect(res.statusCode).toBe(200)
    const body = res.json() as { listed: boolean; cities: string[] }
    expect(body.listed).toBe(true)
    expect(body.cities[0]).toBe('Berlin')
    expect(body.cities).toEqual(expect.arrayContaining(['Hamburg', 'Munich', 'Frankfurt']))
  })

  it('filters by a case-insensitive prefix', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    const body = (await cities(authorization, 'country=DE&q=mu')).json() as { cities: string[] }
    expect(body.cities).toEqual(['Munich'])
  })

  it('also offers the club\'s designated cities the workbook lacks', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    const { rows } = await app.pg.query(`SELECT city FROM gwc_cities WHERE country = 'AE' AND lower(city) NOT IN (SELECT lower(city) FROM world_cities WHERE country = 'AE')`)
    expect(rows.length).toBeGreaterThan(0) // Ajman, Umm Al Quwain, Fujairah
    const body = (await cities(authorization, 'country=AE')).json() as { cities: string[] }
    for (const { city } of rows) expect(body.cities).toContain(city)
    expect(body.cities).toContain('Dubai')
    // A city in both lists is offered once.
    expect(body.cities.filter((c) => c === 'Dubai')).toHaveLength(1)
  })

  it('offers Tripoli under both of its countries', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    for (const country of ['LB', 'LY']) {
      expect(((await cities(authorization, `country=${country}`)).json() as { cities: string[] }).cities).toContain('Tripoli')
    }
  })

  it('says a country is not listed, rather than returning an empty dropdown', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    expect((await cities(authorization, 'country=LI')).json()).toEqual({ listed: false, cities: [] })
  })

  it('validates its query', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    expect((await cities(authorization, 'country=germany')).statusCode).toBe(400)
    expect((await cities(authorization, 'q=x')).statusCode).toBe(400)
  })

  it('is refused without a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/profiling/cities?country=DE' })).statusCode).toBe(401)
  })
})

describe.skipIf(!hasDatabase)('cities are validated against the list', () => {
  it('rejects an unlisted city for a listed country and accepts free text elsewhere (non-German cities)', async () => {
    const { authorization } = await approvedMember(app, 'FR')
    expect((await call.patch(authorization, { primaryCity: { country: 'FR', city: 'Atlantis' } })).statusCode).toBe(400)
    expect((await call.patch(authorization, { primaryCity: { country: 'FR', city: 'PARIS' } })).statusCode).toBe(200)
    expect((await call.patch(authorization, { primaryCity: { country: 'LI', city: 'Vaduz' } })).statusCode).toBe(200)
  })

  it('accepts a designated city the workbook lacks', async () => {
    const { authorization } = await approvedMember(app, 'FR')
    const res = await call.patch(authorization, { primaryCity: { country: 'AE', city: 'Fujairah' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().answers.gwcMatch).toBe(true)
  })

  it('matches names with an apostrophe exactly but case-insensitively', async () => {
    const { authorization } = await approvedMember(app, 'FR')
    expect((await call.patch(authorization, { primaryCity: { country: 'CN', city: "XI'AN" } })).statusCode).toBe(200)
    expect((await call.patch(authorization, { primaryCity: { country: 'CN', city: 'Xi’an' } })).statusCode).toBe(400)
  })
})

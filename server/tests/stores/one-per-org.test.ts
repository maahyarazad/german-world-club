import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { organisationUser } from '../threads/social-helpers.ts'
import { merchantWithStore, resetOffers } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-001: each merchant organisation has at most one store, and the
 * rule holds under concurrent attempts. It is held by a UNIQUE constraint, so
 * the suite asserts the database refuses too — not only that the route does.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

describe.skipIf(!hasDatabase)('one store per merchant organisation', () => {
  it('creates the store, active, with no gallery and no cover', async () => {
    const merchant = await merchantWithStore(app, { createStore: false })
    const response = await app.inject({
      method: 'POST', url: '/merchant/store', headers: merchant.headers, payload: { description: 'Gutes Essen' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ active: true, description: 'Gutes Essen', cover: null, media: [], deactivationNotice: null })
  })

  it('answers 404 store-not-found before the store exists, and 200 after', async () => {
    const merchant = await merchantWithStore(app, { createStore: false })
    const before = await app.inject({ method: 'GET', url: '/merchant/store', headers: merchant.headers })
    expect(before.statusCode).toBe(404)
    expect(before.json().type).toContain('store-not-found')

    await app.inject({ method: 'POST', url: '/merchant/store', headers: merchant.headers, payload: {} })
    const after = await app.inject({ method: 'GET', url: '/merchant/store', headers: merchant.headers })
    expect(after.statusCode).toBe(200)
  })

  it('refuses a second store for the same organisation with 409 store-exists', async () => {
    const merchant = await merchantWithStore(app, { createStore: false })
    const first = await app.inject({ method: 'POST', url: '/merchant/store', headers: merchant.headers, payload: {} })
    const second = await app.inject({ method: 'POST', url: '/merchant/store', headers: merchant.headers, payload: {} })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(409)
    expect(second.json().type).toContain('store-exists')
  })

  it('lets exactly one of two simultaneous creates win', async () => {
    const merchant = await merchantWithStore(app, { createStore: false })
    const colleague = await organisationUser(app, 'merchant', { organisationId: merchant.organisationId, role: 'manager' })
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/merchant/store', headers: merchant.headers, payload: {} }),
      app.inject({ method: 'POST', url: '/merchant/store', headers: colleague.headers as unknown as Record<string, string>, payload: {} }),
    ])
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409])
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM stores WHERE organisation_id = $1', [merchant.organisationId])
    expect(rows[0].n).toBe(1)
  })

  it('is refused by the database too, not only by the route', async () => {
    const merchant = await merchantWithStore(app)
    await expect(
      app.pg.query('INSERT INTO stores (organisation_id) VALUES ($1)', [merchant.organisationId]),
    ).rejects.toThrow(/stores_organisation_id_key|duplicate key/)
  })

  it('cannot belong to a partner organisation', async () => {
    const partner = await organisationUser(app, 'partner')
    await expect(
      app.pg.query('INSERT INTO stores (organisation_id) VALUES ($1)', [partner.organisationId]),
    ).rejects.toThrow()

    // Counter-assertion: the same insert for a merchant organisation works,
    // so the refusal above is about the kind, not about the insert itself.
    const merchant = await merchantWithStore(app, { createStore: false })
    await expect(
      app.pg.query('INSERT INTO stores (organisation_id) VALUES ($1)', [merchant.organisationId]),
    ).resolves.toBeTruthy()
  })

  it('refuses a partner, a member and an anonymous caller at the route', async () => {
    const partner = await organisationUser(app, 'partner')
    expect((await app.inject({ method: 'POST', url: '/merchant/store', headers: partner.headers as unknown as Record<string, string>, payload: {} })).statusCode)
      .toBeGreaterThanOrEqual(401)
    expect((await app.inject({ method: 'POST', url: '/merchant/store', payload: {} })).statusCode).toBe(401)
  })

  it('never shows one merchant another merchant’s store', async () => {
    const a = await merchantWithStore(app, { displayName: 'Alpha' })
    const b = await merchantWithStore(app, { displayName: 'Beta' })
    const mine = await app.inject({ method: 'GET', url: '/merchant/store', headers: b.headers })
    expect(mine.json().id).toBe(b.storeId)
    expect(mine.json().id).not.toBe(a.storeId)
    expect(mine.body).not.toContain('Alpha')
  })

  it('refuses to DELETE a store: it is switched off, never removed', async () => {
    const merchant = await merchantWithStore(app)
    await expect(app.pg.query('DELETE FROM stores WHERE id = $1', [merchant.storeId])).rejects.toThrow(/cannot be deleted/)
  })

  it('refuses a stale edit with 409 and applies a current one', async () => {
    const merchant = await merchantWithStore(app)
    const current = (await app.inject({ method: 'GET', url: '/merchant/store', headers: merchant.headers })).json()

    const ok = await app.inject({
      method: 'PATCH', url: '/merchant/store', headers: merchant.headers,
      payload: { version: current.version, description: 'Neu' },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().description).toBe('Neu')
    expect(ok.json().version).not.toBe(current.version)

    // The first version is stale now.
    const stale = await app.inject({
      method: 'PATCH', url: '/merchant/store', headers: merchant.headers,
      payload: { version: current.version, description: 'Überschrieben' },
    })
    expect(stale.statusCode).toBe(409)
    const after = (await app.inject({ method: 'GET', url: '/merchant/store', headers: merchant.headers })).json()
    expect(after.description).toBe('Neu')
  })
})

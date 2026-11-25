import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, seedReadyAsset, resetOffers } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-024: another merchant's offer is indistinguishable from one
 * that does not exist, in status, body and headers. A response that differed
 * would let a merchant enumerate a competitor's offers by guessing ids.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

type Response = Awaited<ReturnType<GwcApp['inject']>>

/** What varies per request by construction, removed (the list tests/marketplace/ownership.test.ts uses). */
const comparable = (response: Response) => ({
  status: response.statusCode,
  body: { ...response.json(), instance: null, requestId: null },
  headers: Object.fromEntries(
    Object.entries(response.headers).filter(([k]) => ![
      'x-request-id', 'date', 'content-length', 'content-security-policy', 'etag', 'ratelimit-remaining',
    ].includes(k)),
  ),
})

describe.skipIf(!hasDatabase)('another merchant’s offer', () => {
  it.each([
    ['edit', (id: string) => ({ method: 'PATCH', url: `/merchant/offers/${id}`, payload: { version: 'x', title: 'Hijack' } })],
    ['publish', (id: string) => ({ method: 'POST', url: `/merchant/offers/${id}/publish` })],
    ['withdraw', (id: string) => ({ method: 'POST', url: `/merchant/offers/${id}/withdraw` })],
    ['media', (id: string) => ({ method: 'PUT', url: `/merchant/offers/${id}/media`, payload: { assetIds: [] } })],
  ] as const)('answers %s exactly like an unknown id', async (_label, build) => {
    const mine = await merchantWithStore(app)
    const theirs = await merchantWithStore(app)
    const offerId = await seedOffer(app.pg, { organisationId: theirs.organisationId, storeId: theirs.storeId, state: 'draft' })

    const probe = async (id: string) => {
      const r = build(id) as { method: 'PATCH' | 'POST' | 'PUT'; url: string; payload?: object }
      return app.inject({ method: r.method, url: r.url, headers: mine.headers, payload: r.payload })
    }
    const foreign = await probe(offerId)
    const absent = await probe(randomUUID())

    expect(foreign.statusCode).toBe(404)
    expect(comparable(foreign)).toEqual(comparable(absent))

    // Counter-assertion: nothing about the other merchant's offer changed.
    const { rows } = await app.pg.query('SELECT title, state FROM offers WHERE id = $1', [offerId])
    expect(rows[0].state).toBe('draft')
    expect(rows[0].title).not.toBe('Hijack')
  })

  it('never appears in my own list', async () => {
    const mine = await merchantWithStore(app)
    const theirs = await merchantWithStore(app)
    const theirOffer = await seedOffer(app.pg, { organisationId: theirs.organisationId, storeId: theirs.storeId })
    await seedOffer(app.pg, { organisationId: mine.organisationId, storeId: mine.storeId })

    const list = await app.inject({ method: 'GET', url: '/merchant/offers', headers: mine.headers })
    const ids = list.json().items.map((o: { id: string }) => o.id)
    expect(ids).toHaveLength(1)
    expect(ids).not.toContain(theirOffer)
  })

  it('cannot be given my files, and my files cannot be hung on it', async () => {
    const mine = await merchantWithStore(app)
    const theirs = await merchantWithStore(app)
    const myAsset = await seedReadyAsset(app.pg, { uploaderId: mine.id, uploaderKind: 'merchant' })
    const theirOffer = await seedOffer(app.pg, { organisationId: theirs.organisationId, storeId: theirs.storeId, state: 'draft' })

    const response = await app.inject({
      method: 'PUT', url: `/merchant/offers/${theirOffer}/media`, headers: mine.headers, payload: { assetIds: [myAsset] },
    })
    expect(response.statusCode).toBe(404)
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM offer_media WHERE offer_id = $1', [theirOffer])
    expect(rows[0].n).toBe(0)
  })
})

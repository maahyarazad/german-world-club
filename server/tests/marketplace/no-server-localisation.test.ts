import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildAuthApp, createMember, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { seedVehicleFeatures } from '../../src/seed/vehicle-features.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The marketplace emits no localised text (extends tests/ops/no-server-localisation).
 *
 * The platform's second language cost no server change at all, because the
 * server answers with `type` and with keys and the console translates. The
 * marketplace has ~44 vehicle features, which is the largest set of
 * human-readable labels the product has — and therefore the most tempting place
 * to start sending words. This pins that it does not.
 */

describe.skipIf(!hasDatabase)('the marketplace sends keys, not words', () => {
  let app: GwcApp
  let headers: Record<string, string>

  beforeAll(async () => {
    app = await buildAuthApp()
    await resetAuthTables(app.pg)
    await seedVehicleFeatures(app.pg)
    const row = await createMember(app.pg, { permissions: { marketplace_post: true } })
    headers = await bearerFor(app, { accountId: row.id, accountKind: 'member' })
  })
  afterAll(async () => { await app.close() })

  const categories = (locale?: string) =>
    app.inject({
      method: 'GET',
      url: '/marketplace/categories',
      headers: locale ? { ...headers, 'accept-language': locale } : headers,
    })

  it('returns the same bytes whatever Accept-Language says', async () => {
    const de = await categories('de-DE,de;q=0.9')
    const en = await categories('en-GB,en;q=0.9')

    expect(de.statusCode).toBe(200)
    expect(de.body).toBe(en.body)
  })

  it('reads a non-empty catalogue — a scan of nothing proves nothing', async () => {
    // Counter-assertion. Without it this suite passes against an endpoint that
    // returned an empty list, which would trivially be identical in both
    // languages.
    const response = await categories()
    expect(response.json().vehicleFeatures.length).toBeGreaterThan(20)
    expect(response.json().categories.length).toBe(4)
  })

  it('carries no label field on any feature', async () => {
    const { vehicleFeatures } = (await categories()).json()
    for (const feature of vehicleFeatures) {
      expect(Object.keys(feature).sort()).toEqual(['group', 'key', 'position'])
    }
  })

  it('carries no German or English words in the feature payload', async () => {
    // The specific failure this guards: someone adds `label` to the catalogue
    // table because the form needs it, and the server starts deciding language.
    const body = (await categories()).body
    for (const word of ['Klimaanlage', 'Sitzheizung', 'Rückfahrkamera',
                        'Air conditioning', 'Heated seats', 'Reversing camera']) {
      expect(body, `"${word}" leaked into a server response`).not.toContain(word)
    }
  })
})

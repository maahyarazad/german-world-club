import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createMember, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { organisationUser } from '../threads/social-helpers.ts'
import { merchantWithStore, seedReadyAsset, resetOffers } from '../offers/helpers.ts'
import { PUBLIC_CACHE } from '../../src/modules/public/application/render-record.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, US6: the landing pages show a strip of the club's active
 * partners and merchants — name and logo — with no script, from live state.
 * Only the public face: never a legal name, a fee tier, a store or an offer.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
  await app.pg.query(`DELETE FROM seo_metadata WHERE record_type = 'partner' AND slug LIKE 'org-partner-%'`)
  // Other suites leave active organisations behind (organisations are never
  // deleted); this suite counts what it can see, so put them out of the picture.
  await app.pg.query(`DELETE FROM organisation_profiles`)
})

const landing = (url: '/' | '/en' = '/', cookie?: string) =>
  app.inject({ method: 'GET', url, headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) } })

async function partner(displayName: string, { withPage = false, status = 'active', profile = true } = {}) {
  const user = await organisationUser(app, 'partner', { status })
  if (profile) await app.pg.query('INSERT INTO organisation_profiles (organisation_id, display_name) VALUES ($1, $2)', [user.organisationId, displayName])
  if (withPage) {
    await app.pg.query(
      `INSERT INTO seo_metadata (record_type, record_id, slug, seo_title, meta_description, indexable, language, published)
       VALUES ('partner', gen_random_uuid(), $1, $2, 'x', true, 'de', true)`,
      [user.slug, displayName],
    )
  }
  return user
}

describe.skipIf(!hasDatabase)('the partners and merchants strip', () => {
  it('shows active partners and merchants by name, on both language pages', async () => {
    await partner('Alpha Partner')
    await merchantWithStore(app, { displayName: 'Beta Café' })

    for (const url of ['/', '/en'] as const) {
      const body = (await landing(url)).body
      expect(body, url).toContain('class="partners"')
      expect(body, url).toContain('Alpha Partner')
      expect(body, url).toContain('Beta Café')
    }
    expect((await landing('/')).body).toContain('Unsere Partner und Händler')
    expect((await landing('/en')).body).toContain('Our partners and merchants')
  })

  it('links a partner only when it has a published page, and never links a merchant', async () => {
    const withPage = await partner('Verlinkt', { withPage: true })
    await partner('Ohne Seite')
    await merchantWithStore(app, { displayName: 'Händler Hans' })

    const body = (await landing('/')).body
    expect(body).toContain(`href="/partners/${withPage.slug}"`)
    // The partner with no page and the merchant are names only.
    expect(body).toMatch(/<span class="partner-card"><span class="partner-name">Ohne Seite<\/span>/)
    expect(body).toMatch(/<span class="partner-card"><span class="partner-name">Händler Hans<\/span>/)
    expect(body.match(/class="partner-card"/g)?.filter(() => true).length).toBeGreaterThan(0)
  })

  it('leaves out a deactivated store, a suspended organisation, a pending one and one with no public name', async () => {
    await merchantWithStore(app, { displayName: 'Aktiv GmbH' })
    await merchantWithStore(app, { displayName: 'Abgeschaltet', storeActive: false })
    await merchantWithStore(app, { displayName: 'Gesperrt', orgStatus: 'suspended' })
    await merchantWithStore(app, { displayName: 'Ausstehend', orgStatus: 'pending' })
    await merchantWithStore(app, { profile: false })
    await merchantWithStore(app, { displayName: 'Ohne Shop', createStore: false })
    await partner('Beendet', { status: 'ended' })

    const body = (await landing('/')).body
    expect(body).toContain('Aktiv GmbH')
    for (const hidden of ['Abgeschaltet', 'Gesperrt', 'Ausstehend', 'Ohne Shop', 'Beendet']) {
      expect(body, hidden).not.toContain(hidden)
    }
  })

  it('drops a merchant on the next request after staff switch its store off, and brings it back', async () => {
    const m = await merchantWithStore(app, { displayName: 'Wandelbar' })
    expect((await landing('/')).body).toContain('Wandelbar')
    await app.pg.query(`UPDATE stores SET active = false, deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`, [m.storeId])
    expect((await landing('/')).body).not.toContain('Wandelbar')
    await app.pg.query(`UPDATE stores SET active = true, deactivated_at = NULL, deactivation_reason = NULL WHERE id = $1`, [m.storeId])
    expect((await landing('/')).body).toContain('Wandelbar')
  })

  it('omits the section entirely when nobody is eligible — no empty heading', async () => {
    for (const url of ['/', '/en'] as const) {
      const body = (await landing(url)).body
      expect(body, url).not.toContain('partners-heading')
      expect(body, url).not.toContain('class="partners"')
      // The slot itself stays in the shell, empty.
      expect(body, url).toContain('<!--gwc:partners--><!--/gwc:partners-->')
    }
  })

  it('exposes only the public face: no legal name, fee tier, store or offer, and no script', async () => {
    const p = await partner('Öffentlich')
    await app.pg.query('UPDATE organisations SET legal_name = $2 WHERE id = $1', [p.organisationId, 'Geheime Rechtsform AG'])
    await merchantWithStore(app, { displayName: 'Mit Shop' })

    const body = (await landing('/')).body
    expect(body).toContain('Öffentlich')
    expect(body).not.toContain('Geheime Rechtsform AG')
    expect(body).not.toMatch(/gold-secret-tier|fee_?tier|legal_?name/i)
    expect(body).not.toMatch(/\/merchant\/|\/member\/offers|club-offers/)
    expect(body).not.toMatch(/<script/i)
  })

  it('draws the logo as a derivative and never an original', async () => {
    const p = await partner('Mit Logo')
    const user = await app.pg.query(`SELECT id FROM organisation_users WHERE organisation_id = $1`, [p.organisationId])
    const asset = await seedReadyAsset(app.pg, { uploaderId: String(user.rows[0].id), uploaderKind: 'partner', width: 800, height: 400 })
    await app.pg.query('UPDATE organisation_profiles SET logo_asset_id = $2 WHERE organisation_id = $1', [p.organisationId, asset])

    const body = (await landing('/')).body
    expect(body).toMatch(/<img src="\/media\/[0-9a-f]{64}\/thumb\.webp" alt="" width="160" height="90" loading="lazy">/)
    expect(body).not.toContain('test/')
  })

  it('keeps the anonymous page publicly cached with no Vary: Cookie, and a signed-in page private — the counter-assertion', async () => {
    await partner('Gecacht')
    const anonymous = await landing('/')
    expect(anonymous.headers['cache-control']).toBe(PUBLIC_CACHE)
    expect(String(anonymous.headers.vary ?? '')).not.toMatch(/cookie/i)

    const person = await createMember(app.pg, { passwordHash: null, displayName: 'Person Eins' })
    const { authorization } = await bearerFor(app, { accountId: String(person.id), accountKind: 'member' })
    const signedIn = await landing('/', `gwc_at=${authorization.replace(/^Bearer /, '')}`)
    expect(signedIn.headers['cache-control']).toBe('private, no-store')
    expect(String(signedIn.headers.vary)).toMatch(/cookie/i)
    // The strip is on the signed-in page too.
    expect(signedIn.body).toContain('Gecacht')
  })

  it('serves the page without the strip rather than failing if the strip cannot be loaded', async () => {
    await partner('Vorhanden')
    // A real fault, not a stub: the table the strip reads goes missing for a moment.
    await app.pg.query('ALTER TABLE organisation_profiles RENAME TO organisation_profiles_away')
    try {
      const response = await landing('/')
      expect(response.statusCode).toBe(200)
      expect(response.body).not.toContain('Vorhanden')
      expect(response.body).toContain('href="/konsole/anmelden"')
    } finally {
      await app.pg.query('ALTER TABLE organisation_profiles_away RENAME TO organisation_profiles')
    }
  })
})

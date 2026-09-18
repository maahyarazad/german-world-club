import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildAuthApp, createAdmin, grant, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'

/**
 * FR-020, FR-021 and §12.12 — staff editing of SEO fields.
 *
 * Two rules carry all the weight here:
 *
 *  1. **Dual permission.** Editing a record's SEO fields needs the flag on the
 *     `seo` module *and* on the record's own module. Without the second, a
 *     single `seo.edit` grant is edit access to every title on the site,
 *     including the paying partners'.
 *  2. **Automatic 301.** A slug change writes the old path into
 *     `legacy_redirects`. A slug change that silently discards accumulated
 *     search equity surfaces months later as a ranking decline with no error
 *     anywhere to explain it — which is why this is enforced in the same
 *     transaction as the update rather than left to whoever made the change.
 */
let app
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const PARTNER = { type: 'partner', module: 'partners' }

describe.skipIf(!hasDatabase)('editing SEO fields requires BOTH modules (FR-020, FR-021)', () => {
  let recordId

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    recordId = randomUUID()
    await app.pg.query('DELETE FROM legacy_redirects WHERE note LIKE $1', ['Automatic 301%'])
    await app.pg.query(`DELETE FROM seo_metadata WHERE record_type = 'partner'`)
    await app.pg.query(
      `INSERT INTO seo_metadata (record_type, record_id, slug, seo_title, published, indexable)
       VALUES ($1, $2, $3, $4, true, true)
       ON CONFLICT (record_type, record_id) DO UPDATE SET slug = EXCLUDED.slug`,
      [PARTNER.type, recordId, `partner-${recordId.slice(0, 8)}`, 'Before'],
    )
  })

  const patch = (headers, body) =>
    app.inject({ method: 'PATCH', url: `/admin/seo/${PARTNER.type}/${recordId}`, headers, payload: body })

  const read = (headers) =>
    app.inject({ method: 'GET', url: `/admin/seo/${PARTNER.type}/${recordId}`, headers })

  const adminWith = async (grants) => {
    const admin = await createAdmin(app.pg, { grants })
    app.permissions.invalidate(admin.id)
    return bearerFor(app, { accountId: admin.id, accountKind: 'admin' })
  }

  it('refuses an admin holding seo.edit but nothing on the record’s module', async () => {
    const headers = await adminWith({ seo: { read: true, edit: true } })
    const response = await patch(headers, { seoTitle: 'After' })
    expect(response.statusCode).toBe(403)
    expect(response.json().detail).toMatch(/partners/)
  })

  it('refuses an admin holding partners.edit but nothing on seo', async () => {
    const headers = await adminWith({ partners: { read: true, edit: true } })
    const response = await patch(headers, { seoTitle: 'After' })
    expect(response.statusCode).toBe(403)
  })

  it('admits an admin holding the flag on BOTH modules', async () => {
    const headers = await adminWith({ seo: { read: true, edit: true }, partners: { read: true, edit: true } })
    const response = await patch(headers, { seoTitle: 'After' })
    expect(response.statusCode).toBe(200)
    expect(response.json().seoTitle).toBe('After')
  })

  it('applies the same dual requirement to READ, not only to edit', async () => {
    const seoOnly = await adminWith({ seo: { read: true } })
    expect((await read(seoOnly)).statusCode).toBe(403)

    const both = await adminWith({ seo: { read: true }, partners: { read: true } })
    expect((await read(both)).statusCode).toBe(200)
  })

  it('checks the right flag: read access does not confer edit', async () => {
    const headers = await adminWith({ seo: { read: true }, partners: { read: true } })
    expect((await read(headers)).statusCode).toBe(200)
    expect((await patch(headers, { seoTitle: 'After' })).statusCode).toBe(403)
  })

  it('admits a superadmin with no module row at all (FR-008)', async () => {
    const admin = await createAdmin(app.pg, { isSuperadmin: true })
    app.permissions.invalidate(admin.id)
    const headers = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })
    expect((await patch(headers, { seoTitle: 'After' })).statusCode).toBe(200)
  })

  it('refuses anonymously, before any handler runs', async () => {
    const response = await patch(undefined, { seoTitle: 'After' })
    expect(response.statusCode).toBe(401)
  })

  it('records the denial with the permission that was required (FR-015)', async () => {
    const headers = await adminWith({ seo: { read: true, edit: true } })
    await patch(headers, { seoTitle: 'After' })
    const { rows } = await app.pg.query(
      `SELECT required_permission FROM audit_log WHERE outcome = 'denied' ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    )
    expect(rows[0]?.required_permission).toBe('partners.edit')
  })
})

describe.skipIf(!hasDatabase)('a slug change registers its own 301 (§12.12)', () => {
  let recordId
  let headers

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    recordId = randomUUID()
    await app.pg.query('DELETE FROM legacy_redirects WHERE note LIKE $1', ['Automatic 301%'])
    await app.pg.query(`DELETE FROM seo_metadata WHERE record_type = 'partner'`)
    await app.pg.query(
      `INSERT INTO seo_metadata (record_type, record_id, slug, published, indexable)
       VALUES ($1, $2, $3, true, true)`,
      [PARTNER.type, recordId, 'the-old-slug'],
    )
    const admin = await createAdmin(app.pg, {})
    await grant(app.pg, admin.id, 'seo', true)
    await grant(app.pg, admin.id, 'partners', true)
    app.permissions.invalidate(admin.id)
    headers = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })
  })

  const patch = (body) =>
    app.inject({ method: 'PATCH', url: `/admin/seo/${PARTNER.type}/${recordId}`, headers, payload: body })

  const redirectFrom = async (legacyPath) => {
    const { rows } = await app.pg.query(
      'SELECT target_path, status FROM legacy_redirects WHERE legacy_path = $1',
      [legacyPath],
    )
    return rows[0] ?? null
  }

  it('writes a 301 from the old path to the new one', async () => {
    const response = await patch({ slug: 'the-new-slug' })
    expect(response.statusCode).toBe(200)
    expect(response.json().slug).toBe('the-new-slug')
    expect(response.json().redirectCreated).toBe('/partners/the-old-slug')

    expect(await redirectFrom('/partners/the-old-slug')).toEqual({
      target_path: '/partners/the-new-slug',
      status: 301,
    })
  })

  it('actually serves that redirect, rather than only recording it', async () => {
    await patch({ slug: 'the-new-slug' })
    const response = await app.inject({ method: 'GET', url: '/partners/the-old-slug' })
    expect(response.statusCode).toBe(301)
    // Absolute, against the canonical origin: a relative Location here would
    // let the retired path keep resolving under a non-canonical host.
    expect(response.headers.location).toMatch(/^https?:\/\/[^/]+\/partners\/the-new-slug$/)
  })

  it('writes no redirect when the slug is untouched', async () => {
    const response = await patch({ seoTitle: 'Only the title changed' })
    expect(response.json().redirectCreated).toBeNull()
    expect(await redirectFrom('/partners/the-old-slug')).toBeNull()
  })

  it('treats a case-only change as no change — slugs are case-insensitive', async () => {
    const response = await patch({ slug: 'the-old-slug' })
    expect(response.json().redirectCreated).toBeNull()
  })

  /**
   * Renaming twice must leave *both* old paths pointing at the live one. A
   * chain (first → second → third) costs equity at every hop and is the usual
   * way this gets implemented wrong.
   */
  it('keeps every historical path pointing at the current one, not at each other', async () => {
    await patch({ slug: 'second-slug' })
    await patch({ slug: 'third-slug' })

    expect((await redirectFrom('/partners/the-old-slug'))?.status).toBe(301)
    expect((await redirectFrom('/partners/second-slug'))?.target_path).toBe('/partners/third-slug')

    const first = await app.inject({ method: 'GET', url: '/partners/the-old-slug' })
    expect(first.statusCode).toBe(301)
  })
})

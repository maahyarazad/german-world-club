import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, organisationUser, uploadPhoto, post, get } from '../threads/social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Principle VI, after constitution 2.0.0 removed response schemas: nothing
 * structural stops a `members` or `organisations` column reaching a client, so
 * this scans every Threads and profile response a member can reach for the
 * values that must never be there (plan, Post-Phase 1 point 1).
 *
 * The world is built so every forbidden value exists and is one careless
 * `SELECT *` away: the author has an email, a mobile and a birthday; the
 * organisation has a legal name and a fee tier; every asset has a storage key.
 */
describe.skipIf(!hasDatabase)('no private data in Threads or profile responses', () => {
  let app: GwcApp
  let bodies: { url: string; body: string }[] = []
  let forbidden: string[] = []
  let viewerOwnEmail = ''

  beforeAll(async () => {
    app = await buildSocialApp()
    await resetSocial(app)
    const anna = await member(app, 'Anna', { mobile: '+4917055512345' })
    await app.pg.query(`UPDATE members SET birthday = '1979-11-23' WHERE id = $1`, [anna.id])
    const ben = await member(app, 'Ben')
    viewerOwnEmail = ben.email

    const photo = await uploadPhoto(app, anna.headers)
    await app.inject({ method: 'PUT', url: '/profile/me/avatar', headers: anna.headers, payload: { assetId: photo.id } })
    const original = (await post(app, anna, { body: `Hi @${ben.handle}`, media: [{ assetId: photo.id }] })).json()
    const quote = (await post(app, ben, { body: 'Quote', quoteOfId: original.id })).json()
    await post(app, ben, { body: `Back @${anna.handle}`, replyToId: original.id })
    await app.inject({ method: 'PUT', url: `/threads/follows/${anna.id}`, headers: ben.headers })
    await app.inject({ method: 'PUT', url: `/threads/posts/${original.id}/like`, headers: ben.headers })
    await app.inject({ method: 'PUT', url: `/threads/posts/${original.id}/repost`, headers: ben.headers })
    await app.inject({ method: 'PUT', url: `/threads/mutes/${anna.id}`, headers: ben.headers })

    const org = await organisationUser(app, 'merchant')
    await app.inject({ method: 'PATCH', url: '/profile/merchant/public', headers: org.headers, payload: { displayName: 'Shop' } })

    const { rows: keys } = await app.pg.query('SELECT storage_key FROM assets')
    const { rows: [orgRow] } = await app.pg.query('SELECT legal_name, fee_tier FROM organisations WHERE id = $1', [org.organisationId])
    forbidden = [anna.email, '4917055512345', '1979-11-23', orgRow.legal_name, orgRow.fee_tier, ...keys.map((k) => k.storage_key)]

    const urls = [
      '/threads/feed?scope=all', '/threads/feed?scope=following',
      `/threads/posts/${original.id}`, `/threads/posts/${quote.id}`,
      `/threads/posts/${original.id}/quotes`, `/threads/posts/${original.id}/likes`,
      ...['threads', 'replies', 'media', 'reposts'].map((t) => `/threads/members/${anna.id}/posts?tab=${t}`),
      `/threads/members/${anna.id}/followers`, `/threads/members/${ben.id}/following`,
      '/threads/activity', '/threads/mutes', '/threads/blocks',
      `/profile/members/${anna.id}`, `/profile/handles/${anna.handle}`,
      `/profile/organisations/${org.slug}`,
    ]
    for (const url of urls) {
      const r = await get(app, ben, url)
      bodies.push({ url, body: r.body })
    }
    // Anna's own view of her Activity includes Ben as the actor.
    bodies.push({ url: '/threads/activity (anna)', body: (await get(app, anna, '/threads/activity')).body })
  })
  afterAll(async () => { await app.close() })

  it('reaches every route with a 200', async () => {
    expect(bodies.length).toBeGreaterThan(15)
    for (const { url, body } of bodies) expect(JSON.parse(body).status, url).toBeUndefined()
  })

  it('carries no email, mobile, birthday, legal name, fee tier or storage key', () => {
    for (const { url, body } of bodies) {
      for (const value of forbidden) expect(body, `${url} leaks ${value}`).not.toContain(value)
    }
  })

  it('counter-assertion: the scan would see those values if they were there', async () => {
    const own = await app.inject({ method: 'GET', url: '/profile/me', headers: (await member(app, 'Probe')).headers })
    expect(own.body).toContain('@test.invalid')
    expect(viewerOwnEmail).toContain('@test.invalid')
  })
})

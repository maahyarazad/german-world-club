import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, uploadPhoto, get, ABSENT, canonical } from '../threads/social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'
import type { Member } from '../threads/social-helpers.ts'

/** US3: avatar and links on your own profile (FR-012, FR-013). */
describe.skipIf(!hasDatabase)('avatar and links (US3)', () => {
  let app: GwcApp
  let anna: Member
  let ben: Member

  beforeAll(async () => { app = await buildSocialApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetSocial(app)
    anna = await member(app, 'Anna')
    ben = await member(app, 'Ben')
  })

  const setAvatar = (who: Member, assetId: string | null) =>
    app.inject({ method: 'PUT', url: '/profile/me/avatar', headers: who.headers, payload: { assetId } })
  const setLinks = (who: Member, links: unknown[]) =>
    app.inject({ method: 'PUT', url: '/profile/me/links', headers: who.headers, payload: { links } })

  it('sets an own, ready photo as the avatar and shows it wherever the member appears', async () => {
    const photo = await uploadPhoto(app, anna.headers)
    const response = await setAvatar(anna, photo.id)
    expect(response.statusCode).toBe(200)
    expect(response.json().avatar).toMatchObject({ assetId: photo.id, kind: 'image' })
    expect((await get(app, ben, `/profile/members/${anna.id}`)).json().avatar.assetId).toBe(photo.id)
    const created = (await app.inject({ method: 'POST', url: '/threads/posts', headers: anna.headers, payload: { body: 'Hi' } })).json()
    expect(created.author.avatar.assetId).toBe(photo.id)
    // Clearing it.
    expect((await setAvatar(anna, null)).json().avatar).toBeNull()
  })

  it('refuses a stranger\'s asset like an unknown one, and a processing one as retryable', async () => {
    const bens = await uploadPhoto(app, ben.headers)
    expect(canonical(await setAvatar(anna, bens.id))).toEqual(canonical(await setAvatar(anna, ABSENT)))
    const mine = await uploadPhoto(app, anna.headers)
    await app.pg.query(`UPDATE assets SET state = 'processing' WHERE id = $1`, [mine.id])
    expect((await setAvatar(anna, mine.id)).statusCode).toBe(400)
  })

  it('replaces links as a set, and a bad set leaves the old one intact', async () => {
    const good = [{ url: 'https://example.org/anna', label: 'Site' }, { url: 'https://instagram.com/anna', label: null }]
    expect((await setLinks(anna, good)).json().links).toEqual(good)

    for (const bad of [
      [...good, { url: 'javascript:alert(1)', label: null }],
      [{ url: 'http://plain.example', label: null }],
      [...good, { url: 'https://c.example', label: null }, { url: 'https://d.example', label: null }],
      [{ url: `https://example.org/${'x'.repeat(200)}`, label: null }],
    ]) {
      expect((await setLinks(anna, bad)).statusCode).toBe(400)
    }
    // Counter-assertion: the earlier set survives every refusal.
    expect((await get(app, anna, '/profile/me')).json().links).toEqual(good)
    expect((await get(app, ben, `/profile/members/${anna.id}`)).json().links).toEqual(good)
  })
})

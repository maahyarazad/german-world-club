import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, organisationUser, staff, ABSENT } from './social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * SC-003: every Threads and profile route × every principal kind.
 *
 * Asserts the *posture* (who is refused before any handler runs), which is the
 * part a route added under time pressure gets wrong. What each 2xx returns is
 * the feature suites' business. Anonymous is 401; a valid credential for the
 * wrong interface is 403 (plugins/10-auth.ts).
 */
type Kind = 'anonymous' | 'member' | 'merchant' | 'partner' | 'staff'

const MEMBER_ROUTES: [string, string][] = [
  ['GET', '/threads/feed'], ['POST', '/threads/posts'], ['GET', `/threads/posts/${ABSENT}`],
  ['GET', `/threads/posts/${ABSENT}/quotes`], ['GET', `/threads/posts/${ABSENT}/likes`],
  ['PUT', `/threads/posts/${ABSENT}/like`], ['DELETE', `/threads/posts/${ABSENT}`],
  ['GET', `/threads/members/${ABSENT}/posts?tab=media`], ['GET', `/threads/members/${ABSENT}/followers`],
  ['GET', `/threads/members/${ABSENT}/following`], ['PUT', `/threads/follows/${ABSENT}`],
  ['GET', '/threads/activity'], ['GET', '/threads/activity/unread'], ['POST', '/threads/activity/seen'],
  ['PUT', `/threads/blocks/${ABSENT}`], ['PUT', `/threads/mutes/${ABSENT}`], ['GET', '/threads/blocks'], ['GET', '/threads/mutes'],
  ['GET', '/profile/me'], ['PUT', '/profile/me/handle'], ['PUT', '/profile/me/avatar'], ['PUT', '/profile/me/links'],
  ['GET', '/profile/handles/someone/available'], ['GET', '/profile/handles/someone'],
  ['GET', `/profile/members/${ABSENT}`], ['GET', '/profile/organisations/some-slug'],
]

describe.skipIf(!hasDatabase)('access matrix for Threads and profiles (SC-003)', () => {
  let app: GwcApp
  const headers: Partial<Record<Kind, Record<string, string>>> = {}

  beforeAll(async () => {
    app = await buildSocialApp()
    await resetSocial(app)
    headers.member = (await member(app, 'Matrix')).headers
    headers.merchant = (await organisationUser(app, 'merchant')).headers
    headers.partner = (await organisationUser(app, 'partner')).headers
    headers.staff = (await staff(app, { members: true, threads_moderation: true })).headers
  })
  afterAll(async () => { await app.close() })

  const call = (kind: Kind, method: string, url: string) =>
    app.inject({ method: method as 'GET', url, headers: headers[kind] ?? {}, payload: method === 'GET' ? undefined : {} })
  const refusedBeforeHandler = (status: number) => status === 401 || status === 403

  it.each(MEMBER_ROUTES)('%s %s: members pass the gate, everybody else is refused', async (method, url) => {
    expect((await call('anonymous', method, url)).statusCode).toBe(401)
    for (const kind of ['merchant', 'partner', 'staff'] as const) {
      expect((await call(kind, method, url)).statusCode, kind).toBe(403)
    }
    // The member reaches the handler: whatever it answers, it is not a gate refusal.
    expect(refusedBeforeHandler((await call('member', method, url)).statusCode)).toBe(false)
  })

  it.each(['merchant', 'partner'] as const)('/profile/%s is its own audience only', async (kind) => {
    const other = kind === 'merchant' ? 'partner' : 'merchant'
    for (const [method, url] of [['GET', `/profile/${kind}`], ['PATCH', `/profile/${kind}/public`], ['POST', `/media/${kind}`]]) {
      expect((await call('anonymous', method!, url!)).statusCode).toBe(401)
      for (const wrong of ['member', other, 'staff'] as const) expect((await call(wrong, method!, url!)).statusCode, `${wrong} ${url}`).toBe(403)
      expect(refusedBeforeHandler((await call(kind, method!, url!)).statusCode), `${kind} ${url}`).toBe(false)
    }
  })

  it('staff-only designation and moderation routes refuse every non-staff kind', async () => {
    for (const [method, url] of [
      ['GET', `/admin/members/${ABSENT}/designations`], ['POST', `/admin/members/${ABSENT}/designations/influencer`],
      ['GET', `/admin/threads/posts/${ABSENT}`],
    ]) {
      expect((await call('anonymous', method!, url!)).statusCode).toBe(401)
      for (const wrong of ['member', 'merchant', 'partner'] as const) expect((await call(wrong, method!, url!)).statusCode).toBe(403)
      expect(refusedBeforeHandler((await call('staff', method!, url!)).statusCode)).toBe(false)
    }
  })
})

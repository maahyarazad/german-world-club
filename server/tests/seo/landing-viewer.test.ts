import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The landing pages for a signed-in visitor (feature 022).
 *
 * The server swaps the blocks between `gwc:` markers in the two landing
 * shells. A shell that lost a marker would silently turn the feature off for
 * that block, so the markers themselves are asserted first.
 */

const SHELLS = ['index.html', 'en.html']
const MARKERS = ['account', 'signin', 'footer']

describe('the landing shells carry the signed-in markers', () => {
  for (const file of SHELLS) {
    it(`${file} has each marker pair exactly once`, () => {
      const html = readFileSync(join(process.cwd(), '..', 'client', file), 'utf8')
      for (const name of MARKERS) {
        expect(html.split(`<!--gwc:${name}-->`).length - 1, `${file}: <!--gwc:${name}-->`).toBe(1)
        expect(html.split(`<!--/gwc:${name}-->`).length - 1, `${file}: <!--/gwc:${name}-->`).toBe(1)
        expect(html.indexOf(`<!--gwc:${name}-->`)).toBeLessThan(html.indexOf(`<!--/gwc:${name}-->`))
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Rendering for a signed-in visitor (US1, US2, US3)
// ---------------------------------------------------------------------------

import { beforeAll, afterAll, beforeEach } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, organisationUser, staff, uploadPhoto } from '../threads/social-helpers.ts'
import { PUBLIC_CACHE } from '../../src/modules/public/application/render-record.ts'
import type { GwcApp } from '../../src/app.ts'

/** The browser face carries the access token as a cookie; the helpers mint a bearer. */
const cookieFrom = (headers: Record<string, string>) => `gwc_at=${headers.authorization!.replace(/^Bearer /, '')}`

describe.skipIf(!hasDatabase)('the landing page for whoever is looking', () => {
  let app: GwcApp

  beforeAll(async () => { app = await buildSocialApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => { await resetSocial(app) })

  const landing = (url: '/' | '/en', cookie?: string) =>
    app.inject({ method: 'GET', url, headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) } })

  // Display names with spaces, as real ones have; no handle, which the social
  // helper would otherwise derive from the name (and spaces are not allowed).
  const person = (name: string) => member(app, name, { handle: null })

  const anonymousBody = async (url: '/' | '/en' = '/') => (await landing(url)).body
  const ANMELDEN = 'href="/konsole/anmelden"'

  // ---- The counter-assertion every case below leans on ---------------------

  it('serves anonymous visitors the page as it always was', async () => {
    const response = await landing('/')
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain(ANMELDEN)
    expect(response.body).not.toContain('class="account"')
    expect(response.headers['cache-control']).toBe(PUBLIC_CACHE)
    expect(String(response.headers.vary ?? '')).not.toMatch(/cookie/i)
  })

  // ---- US1: a member -------------------------------------------------------

  describe('a signed-in member', () => {
    it('sees their picture, linking to the console, and no sign-in link anywhere', async () => {
      const arian = await person('Arian Geissler')
      const photo = await uploadPhoto(app, arian.headers)
      const set = await app.inject({ method: 'PUT', url: '/profile/me/avatar', headers: arian.headers, payload: { assetId: photo.id } })
      expect(set.statusCode).toBe(200)

      const response = await landing('/', cookieFrom(arian.headers))
      expect(response.statusCode).toBe(200)
      const body = response.body
      expect(body).toContain('<a class="account" href="/konsole" aria-label="Zur Konsole – Arian Geissler">')
      const src = /<a class="account"[^>]*><img src="([^"]+)"/.exec(body)?.[1]
      expect(src, 'no avatar image in the masthead').toBeTruthy()
      // A derivative the console also uses — never the original upload.
      const variantUrls = (set.json().avatar.variants as Array<{ url: string }>).map((v) => v.url)
      expect(variantUrls).toContain(src!.replaceAll('&amp;', '&'))
      expect(body).toContain('<a class="btn btn-primary" href="/konsole">Zur Konsole</a>')
      expect(body).not.toContain(ANMELDEN)
      expect(body).not.toContain('/konsole/passwort')
      expect(body).not.toMatch(/<script/i)
    })

    it('sees their initials when they have no picture', async () => {
      const arian = await person('Arian Geissler')
      const body = (await landing('/', cookieFrom(arian.headers))).body
      expect(body).toContain('<span class="initials" aria-hidden="true">AG</span>')
      expect(body).not.toMatch(/<a class="account"[^>]*><img/)
    })

    it('gets English labels on /en', async () => {
      const arian = await person('Arian Geissler')
      const body = (await landing('/en', cookieFrom(arian.headers))).body
      expect(body).toContain('aria-label="Go to the console – Arian Geissler"')
      expect(body).toContain('<a class="btn btn-primary" href="/konsole">Go to the console</a>')
      expect(body).not.toContain(ANMELDEN)
    })

    it('has their name escaped, never interpreted', async () => {
      const evil = await person('<b>x</b> "Quote"')
      const body = (await landing('/', cookieFrom(evil.headers))).body
      expect(body).toContain('&lt;b&gt;x&lt;/b&gt; &quot;Quote&quot;')
      expect(body).not.toContain('<b>x</b>')
    })
  })

  // ---- US3: nobody else ever sees it ---------------------------------------

  describe('privacy', () => {
    it('marks a signed-in page private, no-store, varying on Cookie', async () => {
      const arian = await person('Arian Geissler')
      const response = await landing('/', cookieFrom(arian.headers))
      expect(response.headers['cache-control']).toBe('private, no-store')
      expect(String(response.headers.vary)).toMatch(/Cookie/)
    })

    it('leaves the anonymous page byte-for-byte as rendered without a viewer', async () => {
      const arian = await person('Arian Geissler')
      await landing('/', cookieFrom(arian.headers))
      // The shell as built, with only the per-response nonces removed: an
      // anonymous visitor gets exactly what they got before this feature.
      const stripNonces = (html: string) => html.replace(/ nonce="[^"]*"/g, '')
      // The same file the server prefers: the build when there is one.
      const built = join(process.cwd(), '..', 'client', 'dist', 'index.html')
      const shell = readFileSync(existsSync(built) ? built : join(process.cwd(), '..', 'client', 'index.html'), 'utf8')
      expect(stripNonces(await anonymousBody('/'))).toBe(stripNonces(shell))
    })

    const anonymous = async (cookie: string) => {
      const response = await landing('/', cookie)
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain(ANMELDEN)
      expect(response.body).not.toContain('class="account"')
      expect(response.headers['cache-control']).toBe(PUBLIC_CACHE)
    }

    it('treats a revoked session as anonymous', async () => {
      const arian = await person('Arian Geissler')
      await app.pg.query('UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1', [arian.headers.sessionId, 'logout'])
      await anonymous(cookieFrom(arian.headers))
    })

    it('treats a garbage cookie as anonymous', async () => {
      await anonymous('gwc_at=not-a-token')
    })

    it('treats an expired token as anonymous', async () => {
      const arian = await person('Arian Geissler')
      // Minted the app's own way, an hour in the past: well beyond its TTL.
      const { token: expired } = app.mintAccessToken({
        accountId: arian.id, sessionId: arian.headers.sessionId, audience: 'member', now: Date.now() - 3_600_000,
      })
      await anonymous(`gwc_at=${expired}`)
    })

    it('treats a locked member as anonymous', async () => {
      const locked = await person('Lena Locked')
      await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [locked.id])
      await anonymous(cookieFrom(locked.headers))
    })

    it('treats an applicant still waiting for approval as anonymous', async () => {
      const applicant = await person('Paula Pending')
      await app.pg.query(
        `INSERT INTO membership_applications (member_id, device_id, state, submitted_at) VALUES ($1, NULL, 'pending', now())`,
        [applicant.id],
      )
      await anonymous(cookieFrom(applicant.headers))
    })

    it('still recognises the same member when admissible — the counter-assertion', async () => {
      const arian = await person('Arian Geissler')
      expect((await landing('/', cookieFrom(arian.headers))).body).toContain('class="account"')
    })
  })

  // ---- US2: the other roles ------------------------------------------------

  describe('staff, merchant and partner users', () => {
    it('show their initials and link to the console', async () => {
      const admin = await staff(app)
      await app.pg.query(`UPDATE admin_users SET display_name = 'Sabine Team' WHERE id = $1`, [admin.id])
      const merchant = await organisationUser(app, 'merchant')
      const partner = await organisationUser(app, 'partner')

      const staffBody = (await landing('/', cookieFrom(admin.headers))).body
      expect(staffBody).toContain('<span class="initials" aria-hidden="true">ST</span>')
      expect(staffBody).toContain('aria-label="Zur Konsole – Sabine Team"')

      for (const who of [merchant, partner]) {
        const body = (await landing('/', cookieFrom(who.headers))).body
        expect(body).toContain('<a class="account" href="/konsole"')
        expect(body).toContain('<span class="initials" aria-hidden="true">OO</span>')
        expect(body).not.toContain(ANMELDEN)
      }
    })

    it('treats a user of a suspended organisation as anonymous', async () => {
      const suspended = await organisationUser(app, 'merchant', { status: 'suspended' })
      const response = await landing('/', cookieFrom(suspended.headers))
      expect(response.body).toContain(ANMELDEN)
      expect(response.body).not.toContain('class="account"')
    })
  })
})

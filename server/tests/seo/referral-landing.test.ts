import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, memberOwner, staffOwner, linkOf } from '../referrals/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The referral landing page's crawl and rendering posture (research R8):
 * public, never indexed, never in the sitemap, readable without JavaScript,
 * one language per URL (/r/<code>, /r/<code>/en).
 */
describe.skipIf(!hasDatabase)('/r/:code', () => {
  let app: GwcApp

  beforeAll(async () => { ({ app } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => { await resetAuthTables(app.pg) })

  async function livePage(path = '') {
    const owner = await memberOwner(app, { displayName: 'Rita Referrer' })
    const { link } = await linkOf(app, owner)
    return { link, page: await app.inject({ method: 'GET', url: `/r/${link.code.toLowerCase()}${path}` }) }
  }

  it('is noindex, never cached, sends no referrer, and needs no JavaScript', async () => {
    const { link, page } = await livePage()
    expect(page.statusCode).toBe(200)
    expect(page.headers['x-robots-tag']).toMatch(/noindex/)
    expect(page.headers['cache-control']).toBe('private, no-store')
    expect(page.headers['referrer-policy']).toBe('no-referrer')
    expect(page.headers['content-type']).toMatch(/text\/html/)
    expect(page.body).not.toMatch(/<script/i)
    // The content is in the first response: name, code, both ways forward.
    expect(page.body).toContain('Rita Referrer')
    expect(page.body).toContain(`${link.code.slice(0, 4)}-${link.code.slice(4)}`)
    expect(page.body).toContain(`/konsole/registrieren?ref=${link.code}`)
    expect(page.body).toContain(`germanworldclub://r/${link.code}`)
    expect(page.body).toMatch(/<meta property="og:title"[^>]*Rita Referrer/)
  })

  it('names staff as the club, never as a person', async () => {
    const owner = await staffOwner(app)
    const { link } = await linkOf(app, owner)
    const page = await app.inject({ method: 'GET', url: new URL(link.url).pathname })
    expect(page.statusCode).toBe(200)
    expect(page.body).not.toContain('Test Admin')
    expect(page.body).toContain('German World Club')
  })

  it('switches language by link, not by header', async () => {
    const { link } = await livePage()
    const path = new URL(link.url).pathname
    const de = await app.inject({ method: 'GET', url: path })
    const deWithEnglishHeader = await app.inject({ method: 'GET', url: path, headers: { 'accept-language': 'en' } })
    const en = await app.inject({ method: 'GET', url: `${path}/en` })

    expect(de.body).toMatch(/<html lang="de"/)
    expect(en.body).toMatch(/<html lang="en"/)
    const mask = (b: string) => b.replace(/nonce="[^"]*"/g, '')
    expect(mask(deWithEnglishHeader.body)).toBe(mask(de.body))
    expect(de.headers.vary ?? '').not.toMatch(/accept-language/i)
  })

  it('redirects a code typed in capitals to the one lower-case URL, which then answers', async () => {
    const { link } = await livePage()
    const shouted = await app.inject({ method: 'GET', url: `/r/${link.code.toUpperCase()}` })
    expect(shouted.statusCode).toBe(301)
    expect(new URL(shouted.headers.location as string).pathname).toBe(`/r/${link.code.toLowerCase()}`)
    expect(new URL(link.url).pathname).toBe(`/r/${link.code.toLowerCase()}`)
  })

  it('is not in the sitemap and not disallowed in robots.txt, while /konsole still is', async () => {
    const { link } = await livePage()
    const sitemap = await app.inject({ method: 'GET', url: '/sitemap.xml' })
    expect(sitemap.body).not.toContain('/r/')
    expect(sitemap.body).not.toContain(link.code)

    const robots = await app.inject({ method: 'GET', url: '/robots.txt' })
    expect(robots.body).not.toMatch(/Disallow:\s*\/r\b/)
    // Counter-assertion: robots.txt is being read, and gated surfaces are in it.
    expect(robots.body).toMatch(/Disallow:\s*\/konsole/)
  })
})

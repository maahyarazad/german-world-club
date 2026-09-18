import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import { RECORDS } from '../helpers/fixtures.ts'
import { BUCKETS, CRAWLER_ALLOWLIST } from '../../src/config/rate-limits.ts'
// The allowlist is config; the predicate that reads it belongs to the limiter.
import { isAllowlistedCrawler } from '../../src/plugins/07-rate-limit.ts'

/**
 * SC-014 — a normal-rate crawl over every public route sees **zero** 429s.
 *
 * This is the one place two of this feature's goals genuinely conflict. Rate
 * limiting exists to protect the server; §10 exists to keep partner pages
 * visible in search. A 429 served to Googlebot directly undermines the
 * visibility the club has *sold* to a paying partner — and unlike a slow page,
 * it can quietly drop the page from the index altogether.
 *
 * So `public-read` is deliberately generous and fails **open**, and verified
 * crawlers are allow-listed on top of that. SEO wins here, explicitly.
 */
let app

beforeAll(async () => {
  app = await buildApp({ contentSource: createFixtureContentSource(RECORDS) })
  await app.ready()
})

afterAll(async () => { await app.close() })

/** Every public surface a crawler would actually walk. */
const publicPaths = [
  '/', '/robots.txt', '/sitemap.xml',
  ...RECORDS.filter((r) => r.published && r.indexable).map((r) => {
    const prefix = {
      page: '', partner: '/partners', outlet: '/outlets',
      event: '/events', article: '/magazine', committee: '/committees',
    }[r.recordType]
    return `${prefix}/${r.slug}`
  }),
]

describe('the bucket is configured for a crawl, not against one', () => {
  it('fails OPEN, so a Redis outage cannot delist the club', () => {
    expect(BUCKETS['public-read'].skipOnError).toBe(true)
  })

  it('allows a rate no ordinary crawl approaches', () => {
    expect(BUCKETS['public-read'].max).toBeGreaterThanOrEqual(300)
    expect(BUCKETS['public-read'].timeWindow).toBe('1 minute')
  })

  it('is far more generous than the credential buckets, which is the point', () => {
    expect(BUCKETS['public-read'].max).toBeGreaterThan(BUCKETS['sign-in-ip'].max * 10)
  })
})

describe('verified crawlers are never throttled (FR-041)', () => {
  it('recognises the major search and preview bots', () => {
    for (const agent of ['Googlebot', 'bingbot', 'DuckDuckBot', 'Applebot']) {
      expect(isAllowlistedCrawler({ headers: { 'user-agent': `Mozilla/5.0 (compatible; ${agent}/2.1)` } })).toBe(true)
    }
  })

  /**
   * Preview bots matter as much as search crawlers: §10 is about how a link
   * looks when a member shares a partner in a WhatsApp group, and a 429 there
   * produces a bare grey box.
   */
  it('recognises the social preview bots too', () => {
    for (const agent of ['facebookexternalhit', 'Twitterbot', 'LinkedInBot', 'Slackbot', 'WhatsApp', 'TelegramBot']) {
      expect(isAllowlistedCrawler({ headers: { 'user-agent': agent } })).toBe(true)
    }
  })

  it('does not treat an ordinary browser as a crawler', () => {
    const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'
    expect(isAllowlistedCrawler({ headers: { 'user-agent': browser } })).toBe(false)
    expect(isAllowlistedCrawler({ headers: {} })).toBe(false)
  })

  it('reads its answer from the shared allowlist, not a second copy', () => {
    // A predicate with its own inline list would drift from the config, and the
    // drift would be silent until a crawler started seeing 429s.
    for (const agent of CRAWLER_ALLOWLIST) {
      expect(isAllowlistedCrawler({ headers: { 'user-agent': agent } }), agent).toBe(true)
    }
  })

  it('lists every allow-listed agent explicitly, never a wildcard', () => {
    expect(CRAWLER_ALLOWLIST.length).toBeGreaterThan(5)
    for (const agent of CRAWLER_ALLOWLIST) expect(agent).not.toContain('*')
  })
})

describe('a full crawl sees zero 429s (SC-014)', () => {
  it('walks every public route as Googlebot without a single refusal', async () => {
    const statuses = []
    for (const path of publicPaths) {
      const response = await app.inject({
        method: 'GET',
        url: path,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
      })
      statuses.push({ path, status: response.statusCode })
    }

    const refused = statuses.filter((s) => s.status === 429)
    expect(refused, `429s served to a crawler: ${JSON.stringify(refused)}`).toEqual([])
  })

  it('survives repeated passes, as a real crawler makes', async () => {
    const statuses = []
    for (let pass = 0; pass < 4; pass += 1) {
      for (const path of publicPaths) {
        const response = await app.inject({
          method: 'GET',
          url: path,
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        })
        statuses.push(response.statusCode)
      }
    }
    expect(statuses.filter((s) => s === 429)).toEqual([])
  })

  /**
   * The counter-assertion: the limiter is present and does refuse someone.
   * Without this, a server with rate limiting switched off entirely would pass
   * every test above.
   */
  it('still refuses an ordinary client hammering a credential endpoint', async () => {
    let refused = false
    for (let i = 0; i < BUCKETS['sign-in-ip'].max + 3; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/sign-in',
        remoteAddress: '198.51.100.44',
        payload: { email: `probe-${i}@test.invalid`, password: 'not-the-right-password' },
      })
      if (response.statusCode === 429) refused = true
    }
    expect(refused, 'the limiter must actually be running').toBe(true)
  })
})

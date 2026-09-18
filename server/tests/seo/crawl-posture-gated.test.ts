import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildAuthApp } from '../helpers/auth.ts'
import { SURFACES, disallowedPrefixes, postureFor } from '../../src/modules/seo/surfaces.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * SC-008, gated half — every gated surface is refused **and** marked
 * non-indexable.
 *
 * Both halves are needed, and for different reasons. Access control keeps the
 * content private; the crawl directives keep its *existence* private. A member
 * thread that 401s but is listed in search results still leaks its title, its
 * URL and the fact that it exists, which for an invite-only club is most of the
 * harm. Conversely a `noindex` header on an unguarded page protects nothing.
 *
 * So this file asserts the pair for each surface in the §10.1 table, and asserts
 * that the table itself still drives robots.txt — the mechanism that makes the
 * pair hold for surfaces nobody has built yet.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const GATED = SURFACES.filter((s) => !s.public)

/** A probe under each declared prefix, plus the prefix itself. */
const probes = GATED.flatMap((surface) =>
  surface.prefixes.map((prefix) => ({
    surface: surface.name,
    prefix,
    url: `${prefix}/probe`,
    // A gated surface whose prefix serves an empty client shell rather than
    // refusing. See the typedef in src/modules/seo/surfaces.js.
    shell: surface.shell === true,
  })),
)

describe('the §10.1 table declares every gated surface non-indexable', () => {
  it('has at least one gated surface to assert about', () => {
    expect(GATED.length).toBeGreaterThan(0)
  })

  it.each(GATED.map((s) => [s.name, s]))('%s is gated and not indexed', (_name, surface) => {
    expect(surface.public).toBe(false)
    expect(surface.indexed).toBe(false)
    expect(surface.why, 'every surface states why, so the table stays reviewable').toBeTruthy()
  })

  /**
   * The rule that protects surfaces that do not exist yet: an unmatched path
   * resolves to gated. Silence must never widen exposure.
   */
  it('treats an undeclared path as gated rather than public', () => {
    const posture = postureFor(undefined, '/some-surface-nobody-declared')
    expect(posture.public).toBe(false)
    expect(posture.indexed).toBe(false)
  })

  it('resolves a gated surface the same however the path is capitalised', () => {
    expect(postureFor(undefined, '/ADMIN/users').public).toBe(false)
    expect(postureFor(undefined, '/Portal').public).toBe(false)
  })
})

describe('robots.txt disallows every gated prefix (FR-024)', () => {
  let body

  beforeAll(async () => {
    const response = await app.inject({ method: 'GET', url: '/robots.txt' })
    expect(response.statusCode).toBe(200)
    body = response.body
  })

  it.each(disallowedPrefixes().map((p) => [p]))('disallows %s', (prefix) => {
    expect(body).toContain(`Disallow: ${prefix}`)
  })

  /**
   * `Disallow` and `noindex` do different jobs, and conflating them costs real
   * money here: disallowing /media would stop a crawler fetching the images
   * public partner pages reference, harming the visibility those partners pay
   * for. Public-but-unindexed surfaces stay fetchable and carry X-Robots-Tag.
   */
  it('does NOT disallow public-but-unindexed surfaces like /media', () => {
    expect(body).not.toMatch(/^Disallow: \/media$/m)
    expect(body).not.toMatch(/^Disallow: \/$/m)
  })

  it('is itself served but not indexed', async () => {
    const response = await app.inject({ method: 'GET', url: '/robots.txt' })
    expect(response.headers['x-robots-tag']).toMatch(/noindex/)
  })
})

describe('every gated surface is refused AND marked non-indexable (SC-008)', () => {
  const refusing = probes.filter((p) => !p.shell)
  const shells = probes.filter((p) => p.shell)

  it.each(refusing.map((p) => [`${p.surface} ${p.url}`, p]))('%s', async (_name, probe) => {
    const response = await app.inject({ method: 'GET', url: probe.url })

    // Refused: never a 200. A 404 is a legitimate refusal for a gated surface
    // with no route behind it — what matters is that content never comes back.
    expect(response.statusCode, `${probe.url} must not be served`).not.toBe(200)
    expect([401, 403, 404, 405]).toContain(response.statusCode)

    // Non-indexable: the header rides on the refusal too, so the URL cannot be
    // listed on the strength of the error page alone.
    expect(response.headers['x-robots-tag'], `${probe.url} must be noindex`).toMatch(/noindex/)
    expect(response.headers['x-robots-tag']).toMatch(/nofollow/)
  })

  /**
   * A `shell` surface answers 200 by design — a client-routed console must hand
   * the browser a document before any JavaScript can ask who the visitor is.
   *
   * That makes it the one gated surface this file cannot check by status code,
   * so it is checked by *content* instead, and more strictly: the document must
   * be provably empty of anything a refusal would have protected. If a future
   * change inlines a principal or a capability set into the shell to save a
   * round trip, the public declaration on that route becomes a disclosure and
   * this is what catches it (Principle VI).
   */
  it.each(shells.map((p) => [`${p.surface} ${p.url}`, p]))('%s serves an empty shell', async (_name, probe) => {
    const response = await app.inject({ method: 'GET', url: probe.url })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/text\/html/)

    // Still never indexed, exactly like every other gated surface.
    expect(response.headers['x-robots-tag']).toMatch(/noindex/)
    expect(response.headers['x-robots-tag']).toMatch(/nofollow/)

    // Nothing a refusal would have protected.
    expect(response.body).not.toMatch(/@/)
    expect(response.body).not.toMatch(/isSuperadmin|displayName|"modules"/)
    expect(response.body).not.toMatch(/\b(members|marketplace_moderation|mass_messages)\b/)

    // Counter-assertion: the body is real, so the assertions above pass because
    // the shell is clean rather than because there is nothing to scan.
    expect(response.body.length).toBeGreaterThan(200)
  })

  it('has at most one shell surface — the exception must not spread', () => {
    // Every additional shell surface is another prefix this file can no longer
    // check by status code. One is a considered trade; three would be a habit.
    expect(SURFACES.filter((s) => s.shell).map((s) => s.name)).toEqual(['console'])
  })

  it('never caches a gated response in a shared cache', async () => {
    for (const probe of probes) {
      const response = await app.inject({ method: 'GET', url: probe.url })
      expect(response.headers['cache-control'], `${probe.url}`).toMatch(/private/)
      expect(response.headers['cache-control']).toMatch(/no-store/)
    }
  })
})

describe('the gated posture survives a real gated route, not only a 404', () => {
  it('marks an authenticated-only endpoint noindex when it refuses', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(response.statusCode).toBe(401)
    expect(response.headers['x-robots-tag']).toMatch(/noindex, nofollow/)
    expect(response.headers['cache-control']).toMatch(/no-store/)
  })

  it('marks a staff endpoint the same way', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/seo/partner/00000000-0000-0000-0000-000000000000',
    })
    expect(response.statusCode).toBe(401)
    expect(response.headers['x-robots-tag']).toMatch(/noindex, nofollow/)
  })

  /**
   * The counter-assertion. Without it this file would pass just as well against
   * a server that marked *everything* noindex, which would quietly delist the
   * partner pages the club sells.
   */
  it('does NOT mark an indexed public page noindex', async () => {
    const response = await app.inject({ method: 'GET', url: '/' })
    expect(response.headers['x-robots-tag'] ?? '').not.toMatch(/noindex/)
  })
})

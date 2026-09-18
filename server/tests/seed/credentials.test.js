import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withSeededDatabase } from './helpers.js'
import { hasDatabase } from '../helpers/db.js'
import { CREDENTIALS, passwordCell } from '../../src/seed/credentials.js'
import { buildApp } from '../../src/app.js'
import { createFixtureContentSource } from '../../src/modules/public/content.js'

/**
 * SC-001 — every row in the printed table behaves as the table says.
 *
 * Driven from `CREDENTIALS` itself rather than from a copy, so a role that
 * stops working fails here instead of a duplicate of the truth quietly
 * agreeing with itself.
 *
 * Rows that are not meant to authenticate are the interesting ones — a legacy
 * credential, a locked member, a suspended organisation — and they are asserted
 * with the same rigour as the ones that are.
 */
describe.skipIf(!hasDatabase)('every credential does what the table says', () => {
  let db
  let app

  beforeAll(async () => {
    db = await withSeededDatabase('gwc_seed_credentials')
    process.env.DATABASE_URL = db.url
    app = await buildApp({ contentSource: createFixtureContentSource([]) })
    await app.ready()
  }, 180_000)

  afterAll(async () => {
    await app?.close()
    await db?.drop()
  })

  /**
   * One source address per credential.
   *
   * The sign-in limiter is IP-keyed and counts across the process, so driving
   * twenty-seven rows from one address trips it around the twentieth and the
   * rest fail as 429 — a rate limit masquerading as a broken credential. Each
   * row is a different person signing in, which is what the limiter models, so
   * giving each its own address measures what this suite claims to measure.
   */
  let addressCounter = 0
  const signIn = (email, password) =>
    app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email, password },
      remoteAddress: `10.0.${Math.floor(addressCounter / 250)}.${(addressCounter++ % 250) + 1}`,
    })

  it('has a row for every identity kind', () => {
    expect(new Set(CREDENTIALS.map((c) => c.kind))).toEqual(
      new Set(['member', 'staff', 'merchant', 'partner']),
    )
  })

  it('names a distinct email in every row', () => {
    const emails = CREDENTIALS.map((c) => c.email)
    expect(new Set(emails).size).toBe(emails.length)
  })

  const authenticating = CREDENTIALS.filter((c) => c.expect === 'authenticated')
  const refusing = CREDENTIALS.filter((c) => c.expect !== 'authenticated')

  it.each(authenticating.map((c) => [`${c.kind}: ${c.role}`, c]))(
    '%s signs in',
    async (_name, credential) => {
      const response = await signIn(credential.email, credential.password)
      expect(response.statusCode, `${credential.email}: ${response.body}`).toBe(200)
      expect(response.json().outcome).toBe('authenticated')
    },
  )

  it.each(refusing.map((c) => [`${c.kind}: ${c.role}`, c]))(
    '%s does NOT sign in, and the table says so',
    async (_name, credential) => {
      // The password column shows what happens instead of a password, so the
      // table is not lying about these accounts.
      expect(passwordCell(credential)).toMatch(/^\(/)

      const response = await signIn(credential.email, credential.password ?? 'irrelevant-but-long')

      if (credential.expect === 'password_reset_required' || credential.expect === 'profile_incomplete') {
        // A 200 carrying no session — the outcome a client must not mistake
        // for success.
        expect(response.statusCode).toBe(200)
        expect(response.json().outcome).toBe(credential.expect)
        expect(response.json().principal).toBeUndefined()
      } else {
        expect(response.statusCode).toBeGreaterThanOrEqual(401)
        expect(response.headers['content-type']).toMatch(/application\/problem\+json/)
      }
    },
  )

  it('covers all four kinds among the rows that DO sign in', () => {
    // Counter-assertion: if only members authenticated, the suite above would
    // still pass while half the credentials table was decorative.
    expect(new Set(authenticating.map((c) => c.kind))).toEqual(
      new Set(['member', 'staff', 'merchant', 'partner']),
    )
  })

  it('prints the same table on a second run', async () => {
    const before = db.stdout.slice(db.stdout.indexOf('CREDENTIALS'))
    const { runSeed } = await import('./helpers.js')
    const again = await runSeed({
      env: { DATABASE_URL: db.url, NODE_ENV: 'development' },
    })
    expect(again.code).toBe(0)
    expect(again.stdout.slice(again.stdout.indexOf('CREDENTIALS'))).toBe(before)
  }, 120_000)

  it('adds nothing on a second run', async () => {
    const counts = async () => {
      const { rows } = await db.pool.query(`
        SELECT (SELECT count(*)::int FROM members)             AS members,
               (SELECT count(*)::int FROM admin_users)         AS staff,
               (SELECT count(*)::int FROM organisation_users)  AS org_people,
               (SELECT count(*)::int FROM offers)              AS offers,
               (SELECT count(*)::int FROM events)              AS events`)
      return rows[0]
    }
    const before = await counts()
    const { runSeed } = await import('./helpers.js')
    await runSeed({ env: { DATABASE_URL: db.url, NODE_ENV: 'development' } })
    expect(await counts()).toEqual(before)
    // Counter-assertion: the first run created something, so "unchanged" is
    // not "empty both times".
    expect(before.members).toBeGreaterThan(0)
  }, 120_000)
})

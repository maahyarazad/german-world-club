import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { SCOPE } from '../../src/db/counters.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The listing quota, under real concurrency (FR-021, SC-005).
 *
 * **Why concurrent.** A sequential test passes against a quota with no lock at
 * all: read six, six is under twenty, write seven, repeat. The race only shows
 * when the reads overlap, which is exactly the shape a busy evening has. This
 * is CLAUDE.md's "a check without a lock is a race condition with extra steps",
 * asserted rather than asserted-to.
 *
 * **Why 422 and not 429.** A 429 means "retry later and it will work". A quota
 * means retrying changes nothing until the member withdraws something. A client
 * shown 429 for an exhausted quota retries forever.
 */

const TERMS = 'v1'
const QUOTA = 20

describe.skipIf(!hasDatabase)('the listing quota', () => {
  let app: GwcApp

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await app.pg.query('TRUNCATE marketplace_listings, marketplace_terms_acceptances CASCADE')
    await app.pg.query('DELETE FROM counters WHERE scope = $1', [SCOPE.MARKETPLACE_LISTINGS])
    await resetAuthTables(app.pg)
  })

  const poster = async () => {
    const row = await createMember(app.pg, { permissions: { marketplace_post: true } })
    await app.pg.query(
      'INSERT INTO marketplace_terms_acceptances (member_id, version) VALUES ($1, $2)',
      [row.id, TERMS],
    )
    return { row, headers: await bearerFor(app, { accountId: row.id, accountKind: 'member' }) }
  }

  const listing = (n: number) => ({
    category: 'general',
    mode: 'offer',
    title: `Listing number ${n}`,
    body: 'Long enough to pass the body length constraint without any trouble.',
    details: { kind: 'product' },
    termsVersion: TERMS,
  })

  const post = (headers: Record<string, string>, n: number) =>
    app.inject({ method: 'POST', url: '/marketplace/listings', headers, payload: listing(n) })

  it('admits exactly the allowance when the requests race', async () => {
    const { row, headers } = await poster()

    // Fire QUOTA + 5 simultaneously. Not in sequence — the whole point.
    const responses = await Promise.all(
      Array.from({ length: QUOTA + 5 }, (_, i) => post(headers, i)),
    )

    const created = responses.filter((r) => r.statusCode === 201).length
    const refused = responses.filter((r) => r.statusCode === 422).length

    expect(created, 'more listings were admitted than the quota allows').toBe(QUOTA)
    expect(refused).toBe(5)

    // The counter and the rows must agree. A quota that admitted the right
    // number while miscounting is still broken — the next request would be
    // judged against a wrong total.
    const { rows } = await app.pg.query(
      'SELECT count(*)::int AS n FROM marketplace_listings WHERE owner_id = $1',
      [row.id],
    )
    expect(rows[0].n).toBe(QUOTA)

    const { rows: counter } = await app.pg.query(
      'SELECT used FROM counters WHERE scope = $1 AND subject = $2',
      [SCOPE.MARKETPLACE_LISTINGS, row.id],
    )
    expect(Number(counter[0]?.used ?? 0)).toBe(QUOTA)
  })

  it('refuses with 422, never 429 — retrying cannot help', async () => {
    const { headers } = await poster()
    for (let i = 0; i < QUOTA; i += 1) await post(headers, i)

    const response = await post(headers, QUOTA)
    expect(response.statusCode).toBe(422)
    expect(response.json().type).toMatch(/quota-exceeded/)
    // Explicitly NOT a rate limit. The two live in the same feature and
    // flattening them together is the easy mistake.
    expect(response.statusCode).not.toBe(429)
  })

  it('STILL admits a listing below the quota — the counter-assertion', async () => {
    // Without this the suite passes against a server that refused everything
    // with 422, which would satisfy every assertion above except this one.
    const { headers } = await poster()
    expect((await post(headers, 0)).statusCode).toBe(201)
  })
})

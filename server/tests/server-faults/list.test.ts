import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { buildAuthApp, createAdmin, bearerFor, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase, resetServerFaults } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Story 3 (feature 012, contracts/server-faults-api.md): recent faults, newest
 * first, pageable without gaps, groupable by fingerprint and findable by the
 * client's own correlation id.
 */
describe.skipIf(!hasDatabase)('GET /admin/server-faults', () => {
  let app: GwcApp
  let superadmin: Record<string, string>
  const A = 'a'.repeat(64)
  const B = 'b'.repeat(64)

  // Seven faults, one minute apart, oldest first: five of fingerprint A.
  const seed = async () => {
    for (let i = 0; i < 7; i++) {
      await app.pg.query(
        `INSERT INTO server_faults (occurred_at, request_id, client_request_id, method, route, status,
                                    error_name, message, stack, fingerprint, instance_id)
         VALUES (now() - make_interval(mins => $1), $2, $3, 'GET', '/x', 500, 'Error', $4, 'stack', $5, 'test:1')`,
        [10 - i, `01J8Z3K2QX${String(i).padStart(16, '0')}`, i === 3 ? 'support-77' : null, `fault ${i}`, i < 5 ? A : B],
      )
    }
  }

  beforeAll(async () => {
    app = await buildAuthApp()
    await resetAuthTables(app.pg)
    const admin = await createAdmin(app.pg, { isSuperadmin: true })
    superadmin = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })
  })
  beforeEach(async () => { await resetServerFaults(app.pg); await seed() })
  afterAll(async () => { await resetServerFaults(app.pg); await app.close() })

  const list = (query = '') =>
    app.inject({ method: 'GET', url: `/admin/server-faults${query}`, headers: superadmin })

  it('lists newest first, without stacks', async () => {
    const r = await list()
    expect(r.statusCode).toBe(200)
    const { items, nextCursor } = r.json()
    expect(items.map((f: { message: string }) => f.message)).toEqual(
      ['fault 6', 'fault 5', 'fault 4', 'fault 3', 'fault 2', 'fault 1', 'fault 0'],
    )
    expect(items[0]).not.toHaveProperty('stack')
    expect(nextCursor).toBeNull()
  })

  it('pages with a cursor, with no gaps and no duplicates', async () => {
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const r = await list(`?limit=3${cursor ? `&before=${cursor}` : ''}`)
      expect(r.statusCode).toBe(200)
      seen.push(...r.json().items.map((f: { requestId: string }) => f.requestId))
      cursor = r.json().nextCursor
    } while (cursor)
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
  })

  it('filters by fingerprint and by client correlation id', async () => {
    const byA = (await list(`?fingerprint=${A}`)).json().items
    expect(byA).toHaveLength(5)
    const byClient = (await list('?clientRequestId=support-77')).json().items
    expect(byClient.map((f: { message: string }) => f.message)).toEqual(['fault 3'])
  })

  it('counts only the last 24 hours of suppressed faults', async () => {
    await app.pg.query(
      `INSERT INTO server_fault_suppressions (minute, instance_id, suppressed)
       VALUES (date_trunc('minute', now() - interval '1 hour'), 'test:1', 4),
              (date_trunc('minute', now() - interval '2 hours'), 'test:2', 3),
              (date_trunc('minute', now() - interval '25 hours'), 'test:1', 50)`,
    )
    // Counter-assertion built in: the 25-hour-old 50 must not be counted.
    expect((await list()).json().suppressedLast24h).toBe(7)
  })

  it('refuses a malformed cursor, fingerprint, client id or limit', async () => {
    for (const query of ['?before=%%%', '?fingerprint=xyz', '?clientRequestId=no spaces!', '?limit=0', '?limit=101']) {
      expect((await list(query)).statusCode, query).toBe(400)
    }
  })
})

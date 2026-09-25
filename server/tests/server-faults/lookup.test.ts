import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, createAdmin, createMember, bearerFor, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase, resetServerFaults } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Story 1 (feature 012, contracts/server-faults-api.md): the id a member reads
 * off an error screen finds that fault — for staff who hold server_faults.read,
 * and nobody else.
 */
describe.skipIf(!hasDatabase)('GET /admin/server-faults/by-request/:requestId', () => {
  let app: GwcApp
  let superadmin: Record<string, string>
  let requestId: string

  beforeAll(async () => {
    app = await buildAuthApp()
    await resetAuthTables(app.pg)
    const admin = await createAdmin(app.pg, { isSuperadmin: true })
    superadmin = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })
  })
  beforeEach(async () => {
    await resetServerFaults(app.pg)
    // Inserted directly: this suite is about reading. Recording through the
    // error handler is tests/server-faults/record.test.ts's job.
    const { rows } = await app.pg.query(
      `INSERT INTO server_faults (request_id, client_request_id, method, route, status, error_name, message, stack,
                                  fingerprint, instance_id)
       VALUES ('01J8Z3K2QXAAAAAAAAAAAAAAAA', 'support-77', 'POST', '/threads/posts', 500, 'TypeError',
               'Cannot read properties of undefined', 'TypeError: …\n    at x', repeat('b', 64), 'test:1')
       RETURNING request_id`,
    )
    requestId = rows[0].request_id
  })
  afterAll(async () => { await resetServerFaults(app.pg); await app.close() })

  const get = (id: string, headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: `/admin/server-faults/by-request/${id}`, headers })

  it('returns the full record to a superadmin', async () => {
    const r = await get(requestId, superadmin)
    expect(r.statusCode).toBe(200)
    expect(r.json().item).toMatchObject({
      requestId, clientRequestId: 'support-77', method: 'POST', route: '/threads/posts', status: 500,
      errorName: 'TypeError', message: 'Cannot read properties of undefined', fingerprint: 'b'.repeat(64),
      principalKind: null, principalId: null,
    })
    expect(r.json().item.stack).toContain('TypeError')
    expect(r.json().item.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('answers an unknown id with the ordinary 404', async () => {
    const r = await get('01J8Z3K2QXZZZZZZZZZZZZZZZZ', superadmin)
    expect(r.statusCode).toBe(404)
    expect(r.json().type).toBe(PROBLEMS.NOT_FOUND.type)
  })

  it('refuses a malformed id and a client correlation id as invalid (400)', async () => {
    expect((await get('not-a-ulid!', superadmin)).statusCode).toBe(400)
    // A client id is only ever a list filter, never a lookup key.
    expect((await get('support-77', superadmin)).statusCode).toBe(400)
  })

  it('refuses staff without server_faults.read, and members', async () => {
    const staff = await createAdmin(app.pg, { grants: { seo: { read: true } } })
    const staffBearer = await bearerFor(app, { accountId: staff.id, accountKind: 'admin' })
    expect((await get(requestId, staffBearer)).statusCode).toBe(403)

    const member = await createMember(app.pg)
    const memberBearer = await bearerFor(app, { accountId: member.id, accountKind: 'member' })
    expect([401, 403]).toContain((await get(requestId, memberBearer)).statusCode)

    // Counter-assertion: the same staff account granted read gets through.
    const reader = await createAdmin(app.pg, { grants: { server_faults: { read: true } } })
    const readerBearer = await bearerFor(app, { accountId: reader.id, accountKind: 'admin' })
    expect((await get(requestId, readerBearer)).statusCode).toBe(200)
  })

  it('offers no way to edit or delete a record', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
      const r = await app.inject({ method, url: `/admin/server-faults/by-request/${requestId}`, headers: superadmin })
      expect(r.statusCode, method).toBe(404)
    }
  })
})

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { REQUEST_ID } from '@gwc/contracts/request-id'
import { hasDatabase, resetServerFaults } from '../helpers/db.ts'
import { buildFaultApp, settled, faultRows } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Story 1 / FR-001, FR-002, FR-005 (feature 012): an unexpected fault leaves a
 * record keyed on the id the client received; a refusal or a deliberate 5xx
 * leaves nothing.
 */
describe.skipIf(!hasDatabase)('server faults are recorded', () => {
  let app: GwcApp
  beforeAll(async () => { app = await buildFaultApp(); await app.ready() })
  beforeEach(async () => { await resetServerFaults(app.pg) })
  afterAll(async () => { await resetServerFaults(app.pg); await app.close() })

  it('records an unexpected fault under the request id the client received', async () => {
    const r = await app.inject({ method: 'GET', url: '/probe/boom/42?member=anna' })
    expect(r.statusCode).toBe(500)
    await settled(app)

    const rows = await faultRows(app)
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row.request_id).toBe(r.json().requestId)
    expect(row.request_id).toMatch(REQUEST_ID)
    // The pattern, never the URL: neither the path value nor the query survives.
    expect(row.route).toBe('/probe/boom/:id')
    expect(JSON.stringify(row)).not.toContain('member=anna')
    expect(row).toMatchObject({ method: 'GET', status: 500, error_name: 'Error', message: 'boom' })
    expect(row.stack).toContain('boom')
    expect(row.principal_kind).toBeNull()
    expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(row.client_request_id).toBeNull()
  })

  it('keeps a client correlation id beside, never instead of, the request id', async () => {
    const r = await app.inject({ method: 'GET', url: '/probe/boom/1', headers: { 'x-request-id': 'client-abc-123' } })
    await settled(app)
    const [row] = await faultRows(app)
    expect(row.client_request_id).toBe('client-abc-123')
    expect(row.request_id).toBe(r.headers['x-request-id'])
    expect(row.request_id).not.toBe('client-abc-123')
  })

  it('records nothing for refusals and deliberate 5xx answers', async () => {
    // Counter-assertion for the test above: a recorder storing every error
    // response would pass it too.
    const answers = await Promise.all([
      app.inject({ method: 'GET', url: '/no/such/route' }),
      app.inject({ method: 'GET', url: '/probe/validated?n=not-a-number' }),
      app.inject({ method: 'GET', url: '/probe/refused/403' }),
      app.inject({ method: 'GET', url: '/probe/refused/404' }),
      app.inject({ method: 'GET', url: '/probe/refused/429' }),
      app.inject({ method: 'GET', url: '/probe/deadline' }),
      app.inject({ method: 'GET', url: '/probe/breaker-open' }),
    ])
    expect(answers.map((a) => a.statusCode)).toEqual([404, 400, 403, 404, 429, 503, 503])
    await settled(app)
    expect(await faultRows(app)).toHaveLength(0)
  })
})

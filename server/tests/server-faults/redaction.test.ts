import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { hasDatabase, resetServerFaults } from '../helpers/db.ts'
import { buildFaultApp, settled, faultRows } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * SC-002 / FR-003 (feature 012): no credential, token, one-time code, contact
 * detail, body or query string reaches a fault record — whether it arrives in
 * the request or inside the error's own message.
 */
describe.skipIf(!hasDatabase)('fault records carry no secrets (SC-002)', () => {
  let app: GwcApp
  beforeAll(async () => { app = await buildFaultApp(); await app.ready() })
  beforeEach(async () => { await resetServerFaults(app.pg) })
  afterAll(async () => { await resetServerFaults(app.pg); await app.close() })

  const inRequest = {
    authorization: 'Bearer eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJyZXF1ZXN0In0.cmVxdWVzdC1zaWduYXR1cmU',
    cookie: 'tracking=cookie-secret-value-123',
    password: 'correct-horse-battery-staple',
    code: '482913',
    refreshToken: 'rt_supersecret_refresh_value_0042',
    email: 'member.private@example.de',
    mobile: '+4915112345678',
    query: 'queryonly-secret-token',
  }

  it('stores none of the request\'s sensitive values', async () => {
    await app.inject({
      method: 'POST',
      url: `/probe/secret-body?token=${inRequest.query}`,
      headers: { authorization: inRequest.authorization, cookie: inRequest.cookie },
      payload: {
        password: inRequest.password, code: inRequest.code, refreshToken: inRequest.refreshToken,
        email: inRequest.email, mobile: inRequest.mobile,
      },
    })
    await settled(app)
    const rows = await faultRows(app)
    expect(rows).toHaveLength(1)
    const stored = JSON.stringify(rows)
    for (const [field, value] of Object.entries(inRequest)) expect(stored, field).not.toContain(value)
    // Counter-assertion: the record exists and still says what failed.
    expect(rows[0].message).toBe('failed while saving the form')
  })

  it('scrubs secrets out of the error message and never copies driver detail', async () => {
    await app.inject({ method: 'GET', url: '/probe/secret' })
    await settled(app)
    const [row] = await faultRows(app)
    const stored = JSON.stringify(row)
    for (const value of [
      'anna.schmidt@example.de', '+49 151 2345-6789',
      'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl',
      'a3f9c2e81b7d4056a3f9c2e81b7d4056a3f9c2e8', 'Key (email)',
    ]) expect(stored, value).not.toContain(value)
    // Counter-assertion: the non-sensitive part and the code survive.
    expect(row.message).toContain('lookup failed for')
    expect(row.error_code).toBe('E_PROBE')
  })
})

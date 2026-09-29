import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { REQUEST_ID } from '@gwc/contracts/request-id'
import { buildApp } from '../../src/app.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * SC-007 (feature 012, research R10): no request id recorded anywhere was
 * chosen by a client. A client's own id survives only as `clientRequestId` —
 * next to the real one in every log line, never in its place.
 */
const CLIENT_ID = 'support-ticket-42'

let app: GwcApp
const lines: Record<string, unknown>[] = []

beforeAll(async () => {
  app = await buildApp({
    logger: { level: 'info', stream: { write: (s: string) => lines.push(JSON.parse(s)) } },
  })
  await app.ready()
})
afterAll(async () => { await app.close() })

describe('request ids are the server\'s (SC-007)', () => {
  it('binds the client id next to the server id on every line of the request', async () => {
    lines.length = 0
    const r = await app.inject({ method: 'GET', url: '/robots.txt', headers: { 'x-request-id': CLIENT_ID } })
    const requestId = r.headers['x-request-id']
    expect(requestId).toMatch(REQUEST_ID)

    const ours = lines.filter((l) => l.requestId === requestId)
    // Fastify's own lines, which a hook rebinding request.log would miss.
    expect(ours.map((l) => l.msg)).toEqual(expect.arrayContaining(['incoming request', 'request completed']))
    for (const line of ours) expect(line.clientRequestId).toBe(CLIENT_ID)
    expect(lines.some((l) => l.requestId === CLIENT_ID)).toBe(false)
  })

  it('adds no clientRequestId when the client sent none', async () => {
    // Counter-assertion: binding a constant would pass the test above.
    lines.length = 0
    const r = await app.inject({ method: 'GET', url: '/robots.txt' })
    const ours = lines.filter((l) => l.requestId === r.headers['x-request-id'])
    expect(ours.length).toBeGreaterThan(0)
    for (const line of ours) expect(line).not.toHaveProperty('clientRequestId')
  })

  it('gives two requests carrying the same client id different, increasing ids', async () => {
    const a = await app.inject({ method: 'GET', url: '/robots.txt', headers: { 'x-request-id': CLIENT_ID } })
    const b = await app.inject({ method: 'GET', url: '/robots.txt', headers: { 'x-request-id': CLIENT_ID } })
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id'])
    expect(String(a.headers['x-request-id']) < String(b.headers['x-request-id'])).toBe(true)
  })

  it.skipIf(!hasDatabase)('keys audit_log on the server id, never the client one', async () => {
    // Unique per run: audit_log outlives this suite until an auth suite resets
    // it, and a row left by an older server that *did* adopt client ids must
    // not be mistaken for one written now.
    const clientId = `audit-probe-${Date.now()}`
    const r = await app.inject({
      method: 'POST', url: '/auth/sign-in',
      headers: { 'x-request-id': clientId },
      payload: { email: 'nobody-request-id@test.invalid', password: 'password123' },
    })
    const requestId = r.headers['x-request-id']
    const { rows } = await app.pg.query(
      'SELECT request_id FROM audit_log WHERE request_id = ANY($1)',
      [[requestId, clientId]],
    )
    expect(rows.map((row: { request_id: string }) => row.request_id)).toEqual([requestId])
  })
})

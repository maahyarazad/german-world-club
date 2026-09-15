import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/app.js'

/**
 * FR-049 / FR-017: one machine-readable envelope for every failure, and a real
 * 404 for anything that does not exist.
 *
 * §12.15 — one rule set, three clients — extends to failures: if the web
 * client parses {error} and mobile parses {message}, error handling diverges
 * on day one.
 */
let app
beforeAll(async () => {
  app = await buildApp()
  app.get('/boom', { config: { auth: { audience: 'public' } } }, async () => {
    throw new Error('internal detail that must not reach the client: SELECT * FROM members')
  })
  app.get('/teapot', { config: { auth: { audience: 'public' } } }, async (req, reply) => {
    return reply.code(409).send({ ok: false })
  })
  await app.ready()
})
afterAll(async () => { await app.close() })

describe('problem+json envelope (FR-049)', () => {
  it('uses application/problem+json with the documented fields', async () => {
    const r = await app.inject({ method: 'GET', url: '/boom' })
    expect(r.statusCode).toBe(500)
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/)
    const b = r.json()
    expect(b).toMatchObject({ status: 500, instance: '/boom' })
    expect(b.type).toMatch(/\/problems\//)
    expect(b.title).toBeTruthy()
    expect(b.requestId).toBeTruthy()
  })

  it('never leaks an internal cause in detail', async () => {
    const b = (await app.inject({ method: 'GET', url: '/boom' })).json()
    expect(b.detail).toBe('An internal error occurred.')
    expect(JSON.stringify(b)).not.toContain('SELECT')
    expect(JSON.stringify(b)).not.toContain('members')
  })

  it('returns the same requestId that the response header carries (FR-047)', async () => {
    const r = await app.inject({ method: 'GET', url: '/boom' })
    expect(r.json().requestId).toBe(r.headers['x-request-id'])
  })

  it('reuses a validly-shaped client-supplied request id', async () => {
    const r = await app.inject({ method: 'GET', url: '/boom', headers: { 'x-request-id': 'client-supplied-1234' } })
    expect(r.headers['x-request-id']).toBe('client-supplied-1234')
  })

  it('ignores a malformed client-supplied request id', async () => {
    const r = await app.inject({ method: 'GET', url: '/boom', headers: { 'x-request-id': 'no spaces allowed!' } })
    expect(r.headers['x-request-id']).not.toBe('no spaces allowed!')
  })
})

describe('real 404s (FR-017, §12.13)', () => {
  const badPaths = ['/nonsense', '/wp-login.php', '/.env', '/index.php', '/partners/deleted', '/NONSENSE']

  it.each(badPaths)('returns 404 for %s, never a 200 shell', async (path) => {
    const r = await app.inject({ method: 'GET', url: path })
    expect(r.statusCode).toBe(404)
  })

  it('answers an API 404 with problem+json', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/missing', headers: { accept: 'application/json' } })
    expect(r.statusCode).toBe(404)
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/)
    expect(r.json().type).toMatch(/not-found/)
  })

  it('answers an HTML 404 with a rendered, non-indexable page', async () => {
    const r = await app.inject({ method: 'GET', url: '/nope', headers: { accept: 'text/html' } })
    expect(r.statusCode).toBe(404)
    expect(r.headers['content-type']).toMatch(/text\/html/)
    expect(r.headers['x-robots-tag']).toBe('noindex, nofollow')
    // Real content in the first response, not an empty shell.
    expect(r.body).toContain('Page not found')
    expect(r.body).toContain('noindex')
  })

  it('passes a non-5xx status through with its own envelope', async () => {
    const r = await app.inject({ method: 'GET', url: '/teapot' })
    expect(r.statusCode).toBe(409)
  })
})

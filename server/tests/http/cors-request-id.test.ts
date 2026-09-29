import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { loadEnv } from '../../src/config/env.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 012, research R9: the Expo web build is cross-origin, and a browser
 * hides any response header CORS does not expose — so without this its
 * development log would show no request id on a successful request.
 */
const ORIGIN = 'http://localhost:8081'

let app: GwcApp
beforeAll(async () => {
  app = await buildApp({ env: { ...loadEnv(), CORS_ORIGINS: [ORIGIN] } })
  await app.ready()
})
afterAll(async () => { await app.close() })

describe('request ids are readable cross-origin', () => {
  it('exposes both the request id and the client correlation id', async () => {
    const r = await app.inject({ method: 'GET', url: '/robots.txt', headers: { origin: ORIGIN } })
    const exposed = String(r.headers['access-control-expose-headers'] ?? '').toLowerCase().split(/\s*,\s*/)
    expect(exposed).toEqual(expect.arrayContaining(['x-request-id', 'x-client-request-id']))
  })

  it('still answers only the allowlisted origin, never *', async () => {
    // Counter-assertion: exposing headers must not have loosened who may read them.
    const ok = await app.inject({ method: 'GET', url: '/robots.txt', headers: { origin: ORIGIN } })
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN)
    const other = await app.inject({ method: 'GET', url: '/robots.txt', headers: { origin: 'https://evil.example' } })
    expect(other.headers['access-control-allow-origin']).toBeUndefined()
  })
})

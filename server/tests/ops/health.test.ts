import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/app.ts'

/**
 * FR-050: liveness and readiness are separate. A liveness probe that fails on
 * a database blip causes a restart loop, turning a transient dependency
 * problem into an outage.
 */
let app
beforeAll(async () => { app = await buildApp(); await app.ready() })
afterAll(async () => { await app.close() })

describe('health endpoints (FR-050)', () => {
  it('reports liveness from the process alone, with no dependency checks', async () => {
    const r = await app.inject({ method: 'GET', url: '/health/live' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ status: 'ok' })
  })

  it('reports readiness per dependency, by name', async () => {
    const r = await app.inject({ method: 'GET', url: '/health/ready' })
    expect(r.statusCode).toBe(200)
    const b = r.json()
    expect(b.status).toBe('ready')
    expect(b.dependencies).toHaveProperty('database.ok', true)
    expect(b.dependencies).toHaveProperty('redis.ok', true)
    expect(b.dependencies).toHaveProperty('migrations.ok', true)
  })

  it('stays live but reports not-ready once draining begins (FR-046)', async () => {
    app.beginDraining()
    const live = await app.inject({ method: 'GET', url: '/health/live' })
    const ready = await app.inject({ method: 'GET', url: '/health/ready' })
    // Readiness must fail BEFORE the drain, or the balancer keeps routing work
    // into a process that has stopped accepting it.
    expect(live.statusCode).toBe(200)
    expect(ready.statusCode).toBe(503)
    expect(ready.json()).toMatchObject({ status: 'not-ready', draining: true })
  })

  it('declares a posture on both routes, so the startup gate passes', async () => {
    const postures = app.routePostures()
    for (const url of ['/health/live', '/health/ready']) {
      const route = postures.find((r) => r.url === url)
      expect(route?.auth?.audience).toBe('public')
    }
  })

  it('marks health non-indexable — it is an operational endpoint, not content', async () => {
    const r = await app.inject({ method: 'GET', url: '/health/live' })
    expect(r.headers['x-robots-tag']).toBe('noindex, nofollow')
  })
})

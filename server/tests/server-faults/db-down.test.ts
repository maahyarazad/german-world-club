import { describe, it, expect, afterEach } from 'vitest'
import { buildFaultApp, settled } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * SC-003 / FR-004 / FR-011 (feature 012): recording a fault can never change
 * the answer. When the store hangs or refuses, the client still gets the same
 * problem at once, and the fault is still logged.
 */
const snapshot = (app: GwcApp) =>
  (app.metrics as { snapshot(): { serverFaults: { stored: number; failed: number } } }).snapshot().serverFaults

describe('a failing fault store never touches the response', () => {
  const apps: GwcApp[] = []
  afterEach(async () => { while (apps.length) await apps.pop()!.close() })

  async function appWith(insert: () => Promise<void>) {
    const lines: Record<string, unknown>[] = []
    const app = await buildFaultApp({
      serverFaults: { insert },
      logger: { level: 'info', stream: { write: (s: string) => lines.push(JSON.parse(s)) } },
    })
    await app.ready()
    apps.push(app)
    return { app, lines }
  }

  it('answers at once while the insert never returns', async () => {
    const { app } = await appWith(() => new Promise(() => {}))
    const started = Date.now()
    const r = await app.inject({ method: 'GET', url: '/probe/boom/1' })
    // An awaited insert would never resolve; any answer at all proves it is not.
    expect(Date.now() - started).toBeLessThan(1000)
    expect(r.statusCode).toBe(500)
    expect(r.json()).toMatchObject({
      type: expect.stringMatching(/\/internal$/), status: 500, detail: 'An internal error occurred.',
      requestId: r.headers['x-request-id'],
    })
  })

  it('answers identically, counts the failure and still logs when the insert rejects', async () => {
    const { app, lines } = await appWith(() => Promise.reject(new Error('connection refused')))
    const r = await app.inject({ method: 'GET', url: '/probe/boom/1' })
    await settled(app)

    const body = r.json()
    expect(Object.keys(body).sort()).toEqual(['detail', 'instance', 'requestId', 'status', 'title', 'type'])
    expect(snapshot(app)).toMatchObject({ stored: 0, failed: 1 })
    const logged = lines.find((l) => l.msg === 'request failed')
    expect(logged).toMatchObject({ requestId: body.requestId })
  })

  it('counts a stored record when the insert succeeds', async () => {
    // Counter-assertion: a recorder that never inserted would pass the tests
    // above, which only look at what did not happen.
    let inserted = 0
    const { app } = await appWith(async () => { inserted += 1 })
    await app.inject({ method: 'GET', url: '/probe/boom/1' })
    await settled(app)
    expect(inserted).toBe(1)
    expect(snapshot(app)).toMatchObject({ stored: 1, failed: 0 })
  })
})

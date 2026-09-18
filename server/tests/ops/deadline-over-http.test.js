import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/app.js'
import { createFixtureContentSource } from '../../src/public/content.js'
import { loadEnv } from '../../src/config/env.js'

/**
 * The deadline, over a real socket.
 *
 * Every other suite in this repository uses `app.inject`, which is the right
 * default: it is fast, it needs no port, and it exercises the whole plugin
 * chain. But it is not HTTP. It never opens a socket and never emits the
 * lifecycle events Node's `IncomingMessage` emits, and one of those events was
 * hiding a defect that made the API unusable.
 *
 * `12-deadline.js` composed its signal as `AbortSignal.any([timeout,
 * request.signal])`, on the reasonable-sounding grounds that `request.signal`
 * aborts when the client disconnects. It does — but it also aborts when the
 * request body has simply finished being read, which happens *before* the
 * handler runs. So over real HTTP every POST carrying a JSON body aborted its
 * own deadline instantly and answered 503: sign-in, password reset, every
 * write in the API. Under `inject`, all 740 tests passed.
 *
 * This file exists so that class of defect cannot hide again. It listens on a
 * real ephemeral port and uses `fetch`.
 */
let app
let origin

/**
 * Listen on an ephemeral port, and tell the app that port IS its canonical
 * origin.
 *
 * Without this the canonical-origin plugin does its job correctly and 301s
 * every GET to `http://localhost:3000`, which nothing in this test is
 * listening on — so `fetch` follows the redirect into a connection refusal and
 * the failure looks like a deadline problem rather than a redirect. Two
 * listens: one to learn a free port, then the real app configured for it.
 */
async function listenOnFreePort(build) {
  const probe = await buildApp({ contentSource: createFixtureContentSource([]) })
  await probe.listen({ port: 0, host: '127.0.0.1' })
  const { port } = probe.server.address()
  await probe.close()

  const instance = await build(`http://127.0.0.1:${port}`)
  await instance.listen({ port, host: '127.0.0.1' })
  return { instance, origin: `http://127.0.0.1:${port}` }
}

beforeAll(async () => {
  const started = await listenOnFreePort(async (canonical) =>
    buildApp({
      env: loadEnv({ ...process.env, CANONICAL_ORIGIN: canonical }),
      contentSource: createFixtureContentSource([]),
    }),
  )
  app = started.instance
  origin = started.origin
})

afterAll(async () => { await app.close() })

const post = (path, body) =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('a request body that finishes arriving is not a cancelled request', () => {
  /**
   * The regression. Any status is acceptable here EXCEPT the deadline 503:
   * these credentials are wrong, so 401 is the expected answer and 429 is a
   * legitimate one if the limiter has been exercised. 503 means the handler
   * never got to decide.
   */
  it.each([
    ['sign-in', '/auth/sign-in', { email: 'nobody@test.invalid', password: 'irrelevant-but-long' }],
    ['password reset request', '/auth/password-reset/request', { email: 'nobody@test.invalid' }],
    ['password reset confirm', '/auth/password-reset/confirm', { token: 'x'.repeat(64), password: 'irrelevant-but-long' }],
    ['refresh', '/auth/refresh', {}],
  ])('POST %s reaches its handler instead of timing out', async (_name, path, body) => {
    const response = await post(path, body)

    expect(
      response.status,
      `${path} answered 503 — the deadline aborted before the handler ran`,
    ).not.toBe(503)
    expect(response.status).toBeLessThan(500)
  })

  it('answers a genuinely wrong credential with a refusal, not a timeout', async () => {
    const response = await post('/auth/sign-in', {
      email: 'definitely-nobody@test.invalid',
      password: 'a-password-long-enough-to-pass-validation',
    })

    // Counter-assertion for the suite: the route is really being exercised —
    // it returns the refusal its handler produces, so the tests above are
    // passing because the handler ran, not because the route is missing.
    expect([401, 429]).toContain(response.status)
    const problem = await response.json()
    expect(problem.type).toMatch(/invalid-credentials|rate-limited/)
  })

  it('still serves GET routes, which never had the problem', async () => {
    // GET requests carry no body, so their raw stream does not end early and
    // the original composition never misfired on them. Included so a future
    // change that breaks GETs instead is caught here too.
    const response = await fetch(`${origin}/robots.txt`).catch((error) => {
      throw new Error(`GET /robots.txt failed: ${error.cause?.message ?? error.message}`)
    })
    expect(response.status).toBe(200)
  })

  it('carries a body large enough to arrive in more than one chunk', async () => {
    // A small body can be delivered with the headers in a single packet. A
    // large one forces the stream to emit data events and end separately,
    // which is the shape that exposed the defect most reliably.
    const response = await post('/auth/sign-in', {
      email: 'nobody@test.invalid',
      password: 'p'.repeat(200),
    })
    expect(response.status).not.toBe(503)
  })
})

describe('the budget itself still applies over HTTP', () => {
  /**
   * The counter-assertion that matters most.
   *
   * Fixing the composition above must not have disabled the deadline. A route
   * that genuinely overruns its budget must still be cut off — otherwise this
   * change traded one defect for a worse one, silently.
   */
  it('still refuses a handler that overruns its budget', async () => {
    const started = await listenOnFreePort(async (canonical) => {
      const slow = await buildApp({
        env: loadEnv({ ...process.env, CANONICAL_ORIGIN: canonical }),
        contentSource: createFixtureContentSource([]),
      })
      slow.get('/deliberately-slow', {
        config: { auth: { audience: 'public' }, budget: 'public-page', produces: 'text/plain' },
        // 'public-page' allows far less than this.
      }, async () => new Promise((resolve) => setTimeout(() => resolve('zu spät'), 30_000)))
      return slow
    })

    try {
      const response = await fetch(`${started.origin}/deliberately-slow`)
      expect(response.status).toBe(503)
      expect((await response.json()).type).toMatch(/request-deadline-exceeded/)
    } finally {
      await started.instance.close()
    }
  }, 40_000)
})

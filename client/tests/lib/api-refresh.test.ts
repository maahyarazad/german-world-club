import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { ApiError, clearCsrfToken, get, post, refreshSession, upload } from '../../src/lib/api'
import { installFakeXhr, FakeXhr } from '../helpers/fake-xhr'

/**
 * The console renews its session from the refresh cookie (feature 029).
 *
 * Each rule has its counter-assertion: renewing happens for an expired access
 * token and for nothing else; it happens once however many requests need it
 * (a replayed refresh token revokes the whole session); and it never loops.
 */
const problem = (p: { type: string; status: number; title: string }) =>
  new Response(JSON.stringify({ ...p, detail: 'x' }), { status: p.status, headers: { 'content-type': 'application/problem+json' } })
const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

type Handler = (call: { path: string; method: string; n: number }) => Response | Promise<Response>

/** A fake server; `calls` records every request in order. */
function server(handler: Handler) {
  const calls: Array<{ path: string; method: string }> = []
  const counts = new Map<string, number>()
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, options: RequestInit = {}) => {
    const path = String(url)
    const method = options.method ?? 'GET'
    if (path === '/auth/csrf') return ok({ csrfToken: 'csrf' })
    calls.push({ path, method })
    const key = `${method} ${path}`
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    return handler({ path, method, n })
  }))
  const count = (path: string, method = 'GET') => calls.filter((c) => c.path === path && c.method === method).length
  return { calls, count }
}

beforeEach(() => {
  clearCsrfToken()
  try { localStorage.clear() } catch { /* not available */ }
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('an expired access token', () => {
  it('is renewed from the refresh cookie and the request is sent again', async () => {
    const s = server(({ path, n }) => {
      if (path === '/auth/refresh') return ok({ expiresIn: 86400 })
      return n === 1 ? problem(PROBLEMS.UNAUTHENTICATED) : ok({ hello: 'world' })
    })
    await expect(get('/profile/me')).resolves.toEqual({ hello: 'world' })
    expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /profile/me', 'POST /auth/refresh', 'GET /profile/me'])
  })

  it('renews once for any number of simultaneous requests (a replayed refresh token ends the session)', async () => {
    let refreshed = false
    const s = server(async ({ path }) => {
      if (path === '/auth/refresh') {
        await new Promise((r) => setTimeout(r, 20))
        refreshed = true
        return ok({ expiresIn: 86400 })
      }
      return refreshed ? ok({ path }) : problem(PROBLEMS.UNAUTHENTICATED)
    })
    const results = await Promise.all([get('/a'), get('/b'), get('/c'), post('/d', {})])
    expect(results).toHaveLength(4)
    expect(s.count('/auth/refresh', 'POST')).toBe(1)
  })

  it('uses the lock when the browser has Web Locks, so two tabs take turns', async () => {
    const held: string[] = []
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: { request: async (name: string, cb: () => Promise<boolean>) => { held.push(name); return cb() } },
    })
    const s = server(({ path, n }) => (path === '/auth/refresh' ? ok({}) : n === 1 ? problem(PROBLEMS.UNAUTHENTICATED) : ok()))
    await get('/x')
    expect(held).toEqual(['gwc-refresh-session'])
    expect(s.count('/auth/refresh', 'POST')).toBe(1)
  })

  it('skips the refresh when another tab renewed a moment ago, and just sends the request again', async () => {
    localStorage.setItem('gwc.refreshedAt', String(Date.now() - 1000))
    const s = server(({ path, n }) => (path === '/auth/refresh' ? ok({}) : n === 1 ? problem(PROBLEMS.UNAUTHENTICATED) : ok({ fresh: true })))
    await expect(get('/x')).resolves.toEqual({ fresh: true })
    expect(s.count('/auth/refresh', 'POST')).toBe(0)
  })

  it('does refresh when the last renewal was long ago (counter-assertion for the skip)', async () => {
    localStorage.setItem('gwc.refreshedAt', String(Date.now() - 60_000))
    const s = server(({ path, n }) => (path === '/auth/refresh' ? ok({}) : n === 1 ? problem(PROBLEMS.UNAUTHENTICATED) : ok()))
    await get('/x')
    expect(s.count('/auth/refresh', 'POST')).toBe(1)
  })

  it('records the renewal for other tabs', async () => {
    server(({ path, n }) => (path === '/auth/refresh' ? ok({}) : n === 1 ? problem(PROBLEMS.UNAUTHENTICATED) : ok()))
    await get('/x')
    expect(Date.now() - Number(localStorage.getItem('gwc.refreshedAt'))).toBeLessThan(5000)
  })
})

describe('what must NOT be renewed', () => {
  it('a revoked session stays a 401 and is never refreshed', async () => {
    const s = server(() => problem(PROBLEMS.SESSION_REVOKED))
    await expect(get('/profile/me')).rejects.toMatchObject({ status: 401 })
    expect(s.count('/auth/refresh', 'POST')).toBe(0)
    expect(s.count('/profile/me')).toBe(1)
  })

  it('a wrong password at sign-in is not an expired token', async () => {
    const s = server(() => problem(PROBLEMS.INVALID_CREDENTIALS))
    await expect(post('/auth/sign-in', { email: 'a@b.c', password: 'x' })).rejects.toBeInstanceOf(ApiError)
    expect(s.count('/auth/refresh', 'POST')).toBe(0)
  })

  it('a 403 is never refreshed', async () => {
    const s = server(() => problem(PROBLEMS.INSUFFICIENT_PERMISSION))
    await expect(get('/admin/x')).rejects.toMatchObject({ status: 403 })
    expect(s.count('/auth/refresh', 'POST')).toBe(0)
  })
})

describe('when renewing fails', () => {
  it('surfaces the ORIGINAL 401 so the console asks for a sign-in, once, with no loop', async () => {
    const s = server(({ path }) => (path === '/auth/refresh' ? problem(PROBLEMS.INVALID_REFRESH_TOKEN) : problem(PROBLEMS.UNAUTHENTICATED)))
    const error = (await get('/profile/me').catch((e: unknown) => e)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.needsSignIn).toBe(true)
    expect(error.problem.type).toBe(PROBLEMS.UNAUTHENTICATED.type)
    expect(s.count('/auth/refresh', 'POST')).toBe(1)
    expect(s.count('/profile/me')).toBe(1) // not retried: there was nothing to retry with
  })

  it('does not loop when the renewed token is refused again', async () => {
    const s = server(({ path }) => (path === '/auth/refresh' ? ok({}) : problem(PROBLEMS.UNAUTHENTICATED)))
    await expect(get('/profile/me')).rejects.toMatchObject({ status: 401 })
    expect(s.count('/auth/refresh', 'POST')).toBe(1)
    expect(s.count('/profile/me')).toBe(2) // the original and exactly one retry
  })

  it('a network failure while renewing leaves the original 401', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let first = true
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/auth/csrf') return ok({ csrfToken: 'c' })
      if (path === '/auth/refresh') throw new TypeError('offline')
      if (first) { first = false; return problem(PROBLEMS.UNAUTHENTICATED) }
      return ok()
    }))
    await expect(get('/x')).rejects.toMatchObject({ status: 401 })
  })

  it('refreshSession reports false when there is nothing to renew with', async () => {
    server(() => problem(PROBLEMS.INVALID_REFRESH_TOKEN))
    await expect(refreshSession()).resolves.toBe(false)
  })
})

describe('an upload that starts after the token expired', () => {
  it('renews and sends the same form again', async () => {
    installFakeXhr()
    const s = server(({ path }) => (path === '/auth/refresh' ? ok({}) : ok()))
    const pending = upload('/media/member', new FormData())

    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1))
    const first = FakeXhr.instances[0]!
    first.respond(401, JSON.stringify({ ...PROBLEMS.UNAUTHENTICATED, detail: 'x' }), 'application/problem+json')

    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(2))
    FakeXhr.instances[1]!.respond(200, '{"id":"a"}', 'application/json')
    await expect(pending).resolves.toEqual({ id: 'a' })
    expect(s.count('/auth/refresh', 'POST')).toBe(1)
  })
})

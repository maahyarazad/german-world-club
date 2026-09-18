import { describe, it, expect, afterEach, vi } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { ApiError } from '../src/lib/api'
import {
  describeProblem,
  isRetryable,
  invalidatesCapabilities,
  requiresReauthentication,
  RETRY,
} from '../src/lib/problems'

/**
 * SC-003 — every refusal surfaces as a refusal, never as a broken screen.
 *
 * The distinction that matters most here is FR-019's: a 429 means "retry later
 * and it will work", a quota means "retrying changes nothing until state does".
 * A console that flattened them would send a staff member round a loop that
 * cannot terminate, which is worse than refusing plainly.
 */

afterEach(() => vi.unstubAllGlobals())

const response = (status, headers = {}) => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
})

describe('a rate limit and a quota are not the same refusal', () => {
  it('offers a retry for a rate limit', () => {
    const error = new ApiError(PROBLEMS.RATE_LIMITED, response(429, { 'retry-after': '30' }))
    expect(error.retryable).toBe(true)
    expect(error.retryAfter).toBe(30)
    expect(describeProblem(PROBLEMS.RATE_LIMITED).retry).toBe(RETRY.AFTER_WAIT)
  })

  /**
   * The counter-assertion, and the reason the two problem types exist
   * separately on the server. If this ever reports `retryable: true`, the
   * console will offer a button that cannot succeed.
   */
  it('offers NO retry for a business quota', () => {
    const error = new ApiError(PROBLEMS.QUOTA_EXCEEDED, response(422))
    expect(error.retryable).toBe(false)
    expect(describeProblem(PROBLEMS.QUOTA_EXCEEDED).retry).toBe(RETRY.NEVER)
    // And the copy must not suggest waiting, which would be the same defect
    // expressed in prose.
    expect(describeProblem(PROBLEMS.QUOTA_EXCEEDED).body).not.toMatch(/warten|später/i)
  })

  it('offers a retry for a deadline, which is a timeout and not a validation failure', () => {
    expect(isRetryable(PROBLEMS.REQUEST_DEADLINE_EXCEEDED)).toBe(true)
  })
})

describe('a refusal tells the console what to do next', () => {
  it('treats a missing grant as a stale capability snapshot', () => {
    // A grant can be revoked between the sidebar rendering and the click that
    // follows it. The refusal is the signal that our copy is out of date.
    expect(invalidatesCapabilities(PROBLEMS.INSUFFICIENT_PERMISSION)).toBe(true)
    expect(new ApiError(PROBLEMS.INSUFFICIENT_PERMISSION, response(403)).capabilitiesStale).toBe(true)
  })

  it('does NOT treat a rate limit or a not-found as stale capabilities', () => {
    // Counter-assertion: if everything invalidated the snapshot, the console
    // would re-fetch it on every hiccup and the signal would mean nothing.
    expect(invalidatesCapabilities(PROBLEMS.RATE_LIMITED)).toBe(false)
    expect(invalidatesCapabilities(PROBLEMS.NOT_FOUND)).toBe(false)
    expect(invalidatesCapabilities(PROBLEMS.VALIDATION_FAILED)).toBe(false)
  })

  it('sends the user back to sign-in when the session was ended elsewhere', () => {
    // At most one session per account is active, so this is the expected result
    // of signing in on another device — not an error the user caused.
    expect(requiresReauthentication(PROBLEMS.SESSION_REVOKED)).toBe(true)
    expect(new ApiError(PROBLEMS.SESSION_REVOKED, response(401)).needsSignIn).toBe(true)
  })

  it('does NOT send the user to sign-in for a wrong-audience refusal', () => {
    // 403 because the credential is valid and simply not for this interface.
    // Re-authenticating cannot help, so offering it would be a loop.
    expect(requiresReauthentication(PROBLEMS.INSUFFICIENT_PERMISSION)).toBe(false)
  })

  it('shows the server remedy for an account-state refusal and invents none', () => {
    expect(describeProblem(PROBLEMS.ACCOUNT_INACTIVE).body).toMatch(/Passwort zurück/i)
    expect(describeProblem(PROBLEMS.ACCOUNT_LOCKED).body).toMatch(/Support/i)
    expect(describeProblem(PROBLEMS.MEMBERSHIP_ENDED).retry).toBe(RETRY.NEVER)
  })
})

describe('branching is on type, never on detail', () => {
  it('renders the same way regardless of what detail says', () => {
    const a = { ...PROBLEMS.INSUFFICIENT_PERMISSION, detail: 'Requires read on module seo.' }
    const b = { ...PROBLEMS.INSUFFICIENT_PERMISSION, detail: 'Etwas völlig anderes.' }
    expect(describeProblem(a)).toEqual(describeProblem(b))
  })

  it('does not distinguish a missing record from one that is not yours', () => {
    // FR-007: an authorization refusal must not reveal whether the resource
    // exists. The server does not distinguish them, so the console must not
    // render a distinction either.
    const refusal = describeProblem(PROBLEMS.INSUFFICIENT_PERMISSION)
    expect(refusal.body).not.toMatch(/existiert nicht|nicht gefunden/i)
  })

  /**
   * The server may add a problem type at any time. A console that threw on an
   * unknown one would break on a deploy it had nothing to do with.
   */
  it('renders an unknown problem type using the title the server sent', () => {
    const unknown = { type: 'https://example.test/problems/brand-new', title: 'Ganz neu', status: 409 }
    const described = describeProblem(unknown)
    expect(described.title).toBe('Ganz neu')
    expect(described.known).toBe(false)
  })

  it('renders something sensible for a problem with no type at all', () => {
    expect(describeProblem(null).title).toBeTruthy()
    expect(describeProblem(undefined).title).toBeTruthy()
  })
})

describe('the api layer parses refusals rather than throwing on them', () => {
  it('raises an ApiError carrying the parsed problem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(PROBLEMS.INSUFFICIENT_PERMISSION), {
            status: 403,
            headers: { 'content-type': 'application/problem+json' },
          }),
      ),
    )
    const { get } = await import('../src/lib/api')
    await expect(get('/admin/anything')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
    })
  })

  it('still raises a usable ApiError when the refusal body does not parse', async () => {
    // A refusal whose body is broken is still a refusal. Callers must not have
    // to distinguish "refused" from "refused unparseably".
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>gateway</html>', {
            status: 502,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )
    const { get } = await import('../src/lib/api')
    await expect(get('/admin/anything')).rejects.toMatchObject({ name: 'ApiError', status: 502 })
  })

  it('sends cookies — the browser face authenticates by cookie', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const { get } = await import('../src/lib/api')
    await get('/auth/session')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' })
  })
})

/**
 * CSRF, the double-submit half of the cookie face.
 *
 * The server holds a secret in a cookie the page cannot read and expects the
 * matching token in `x-csrf-token`. Nothing minted one before `GET /auth/csrf`
 * existed, so every cookie-borne write was refused with "Missing csrf secret" —
 * the check working correctly against a client that had no way to satisfy it.
 */
describe('state-changing requests carry a CSRF token', () => {
  const stub = () => {
    const calls = { csrf: 0, writes: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options = {}) => {
        if (String(url) === '/auth/csrf') {
          calls.csrf += 1
          return new Response(JSON.stringify({ csrfToken: `token-${calls.csrf}` }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        calls.writes.push({ url: String(url), options })
        return new Response(null, { status: 204 })
      }),
    )
    return calls
  }

  it('fetches a token and sends it on a POST', async () => {
    const calls = stub()
    const { post, clearCsrfToken } = await import('../src/lib/api')
    clearCsrfToken()

    await post('/auth/staff/sign-out')

    expect(calls.csrf).toBe(1)
    expect(calls.writes[0].options.headers['x-csrf-token']).toBe('token-1')
  })

  it('does NOT fetch or send one on a GET', async () => {
    // Counter-assertion: a safe method needs no token, and requiring one would
    // add a round trip to every read for no security.
    const calls = stub()
    const { get, clearCsrfToken } = await import('../src/lib/api')
    clearCsrfToken()

    await get('/auth/session')

    expect(calls.csrf).toBe(0)
    expect(calls.writes[0].options.headers['x-csrf-token']).toBeUndefined()
  })

  it('reuses one token across several writes', async () => {
    // Each mint replaces the secret cookie, so minting per request would
    // invalidate the request before it arrived.
    const calls = stub()
    const { post, clearCsrfToken } = await import('../src/lib/api')
    clearCsrfToken()

    await Promise.all([post('/push/campaigns', {}), post('/push/campaigns', {}), post('/push/campaigns', {})])

    expect(calls.csrf).toBe(1)
    expect(calls.writes).toHaveLength(3)
  })

  it('refreshes a stale token once and retries, without surfacing it', async () => {
    let served = 0
    let csrfCalls = 0
    const attempts = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options = {}) => {
        if (String(url) === '/auth/csrf') {
          csrfCalls += 1
          return new Response(JSON.stringify({ csrfToken: `token-${csrfCalls}` }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        attempts.push(options.headers['x-csrf-token'])
        served += 1
        // The first attempt is rejected as stale; the retry succeeds.
        if (served === 1) {
          return new Response(JSON.stringify(PROBLEMS.CSRF_TOKEN_INVALID), {
            status: 403,
            headers: { 'content-type': 'application/problem+json' },
          })
        }
        return new Response(null, { status: 204 })
      }),
    )

    const { post, clearCsrfToken } = await import('../src/lib/api')
    clearCsrfToken()

    // Resolves rather than throwing: the staleness is mechanical and the user
    // can do nothing about it, so it is fixed rather than reported.
    await expect(post('/auth/staff/sign-out')).resolves.toBeNull()
    expect(attempts).toEqual(['token-1', 'token-2'])
  })

  it('gives up after ONE retry rather than looping', async () => {
    // Counter-assertion: retrying a write forever is how a double submit
    // becomes a double booking.
    let writes = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url) === '/auth/csrf') {
          return new Response(JSON.stringify({ csrfToken: 'token' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        writes += 1
        return new Response(JSON.stringify(PROBLEMS.CSRF_TOKEN_INVALID), {
          status: 403,
          headers: { 'content-type': 'application/problem+json' },
        })
      }),
    )

    const { post, clearCsrfToken } = await import('../src/lib/api')
    clearCsrfToken()

    await expect(post('/auth/staff/sign-out')).rejects.toMatchObject({ name: 'ApiError', status: 403 })
    expect(writes).toBe(2)
  })

  it('does not retry a permission refusal — that is not a CSRF problem', async () => {
    // The two used to share INSUFFICIENT_PERMISSION, which is exactly why
    // CSRF_TOKEN_INVALID exists as a type of its own: a client cannot tell them
    // apart without branching on `detail`, and retrying a real refusal is noise.
    let writes = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url) === '/auth/csrf') {
          return new Response(JSON.stringify({ csrfToken: 'token' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        writes += 1
        return new Response(JSON.stringify(PROBLEMS.INSUFFICIENT_PERMISSION), {
          status: 403,
          headers: { 'content-type': 'application/problem+json' },
        })
      }),
    )

    const { post, clearCsrfToken } = await import('../src/lib/api')
    clearCsrfToken()

    await expect(post('/admin/anything', {})).rejects.toMatchObject({ status: 403 })
    expect(writes).toBe(1)
  })
})

/**
 * Refusals in both languages, from the same problem `type`.
 *
 * This is the clearest payoff of the "clients branch on `type`, never on
 * `detail`" rule: the server sends English `detail` strings the console never
 * renders, so a second language costs a second copy table and **no server
 * change at all** (FR-019, and SC-010 proves the server side of it).
 */
describe('a problem renders in the selected language', () => {
  it.each([
    [PROBLEMS.ACCOUNT_LOCKED],
    [PROBLEMS.INSUFFICIENT_PERMISSION],
    [PROBLEMS.QUOTA_EXCEEDED],
    [PROBLEMS.INVALID_RESET_TOKEN],
    [PROBLEMS.RATE_LIMITED],
  ])('translates %#', (problem) => {
    const de = describeProblem(problem, 'de')
    const en = describeProblem(problem, 'en')

    expect(de.title).toBeTruthy()
    expect(en.title).toBeTruthy()
    // Counter-assertion: an `en` catalogue copied from `de` would give the same
    // string and satisfy every "is truthy" check above.
    expect(en.title, `${problem.type} was not translated`).not.toBe(de.title)
  })

  it('keeps the RETRY policy identical across languages', () => {
    // What the console DOES about a refusal must not depend on which language
    // it happens to be showing.
    for (const problem of [PROBLEMS.QUOTA_EXCEEDED, PROBLEMS.RATE_LIMITED, PROBLEMS.SESSION_REVOKED]) {
      expect(describeProblem(problem, 'en').retry).toBe(describeProblem(problem, 'de').retry)
    }
    expect(isRetryable(PROBLEMS.QUOTA_EXCEEDED)).toBe(false)
    expect(isRetryable(PROBLEMS.RATE_LIMITED)).toBe(true)
  })

  it('does not suggest waiting for a quota, in either language', () => {
    // The copy must not contradict the retry policy in either language.
    expect(describeProblem(PROBLEMS.QUOTA_EXCEEDED, 'de').body).not.toMatch(/warten|später/i)
    expect(describeProblem(PROBLEMS.QUOTA_EXCEEDED, 'en').body).not.toMatch(/\bwait\b|\blater\b/i)
  })

  it('falls back to German for a locale it does not have', () => {
    expect(describeProblem(PROBLEMS.ACCOUNT_LOCKED, 'fr')).toEqual(
      describeProblem(PROBLEMS.ACCOUNT_LOCKED, 'de'),
    )
  })

  it('uses the server title for an unknown type, in both', () => {
    const unknown = { type: 'https://example.test/problems/new', title: 'Brand new', status: 409 }
    // The fallback IS the server's string, so it is the same in every language.
    expect(describeProblem(unknown, 'de').title).toBe('Brand new')
    expect(describeProblem(unknown, 'en').title).toBe('Brand new')
  })
})

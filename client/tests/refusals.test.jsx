import { describe, it, expect, afterEach, vi } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { ApiError } from '../src/lib/api.js'
import {
  describeProblem,
  isRetryable,
  invalidatesCapabilities,
  requiresReauthentication,
  RETRY,
} from '../src/lib/problems.js'

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
    const { get } = await import('../src/lib/api.js')
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
    const { get } = await import('../src/lib/api.js')
    await expect(get('/admin/anything')).rejects.toMatchObject({ name: 'ApiError', status: 502 })
  })

  it('sends cookies — the browser face authenticates by cookie', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const { get } = await import('../src/lib/api.js')
    await get('/auth/session')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' })
  })
})

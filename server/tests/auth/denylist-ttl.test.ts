import { describe, it, expect, vi, afterEach } from 'vitest'
import { ACCESS_TOKEN_TTL_SECONDS } from '@gwc/contracts/auth'
import { createDenylist, DENYLIST_TTL_SECONDS } from '../../src/modules/auth/sessions.ts'

/**
 * A revoked session's access token must never outlive its denylist entry.
 *
 * The entry lifetime used to be a second constant (600) that happened to equal
 * the token lifetime; changing one without the other would silently let a
 * revoked token work again once the entry expired. It is now derived, and this
 * pins both the derivation and the behaviour.
 */
afterEach(() => vi.useRealTimers())

describe('the session denylist lifetime', () => {
  it('is the access token lifetime, not a second number', () => {
    expect(DENYLIST_TTL_SECONDS).toBe(ACCESS_TOKEN_TTL_SECONDS)
  })

  it('holds an entry for the whole token lifetime and not past it', async () => {
    vi.useFakeTimers()
    const denylist = createDenylist(null)
    await denylist.add('sid-1')

    vi.advanceTimersByTime((ACCESS_TOKEN_TTL_SECONDS - 1) * 1000)
    expect(await denylist.has('sid-1')).toBe(true)

    // Counter-assertion: it does expire (the in-memory fallback must not grow forever).
    vi.advanceTimersByTime(2000)
    expect(await denylist.has('sid-1')).toBe(false)
  })
})

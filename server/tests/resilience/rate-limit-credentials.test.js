import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildAuthApp, createMember, resetAuthTables } from '../helpers/auth.js'
import { hasDatabase } from '../helpers/db.js'
import { BUCKETS } from '../../src/config/rate-limits.js'

/**
 * SC-013 — credential limits must refuse in **both** directions.
 *
 * Neither bucket is sufficient alone, and the reason each fails is different:
 *
 *   - Per-address only is defeated by a botnet. A thousand hosts each making
 *     three attempts against one account never trips a per-address limit, and
 *     three thousand guesses against one password is a real attack.
 *   - Per-account only lets a single address walk the member list one attempt
 *     at a time, enumerating an invite-only club. It is also an account-lockout
 *     weapon: anyone can lock any member out by failing against them.
 *
 * So both are checked on every sign-in, and this file asserts each direction
 * separately — a single combined assertion would pass with one bucket missing.
 */
let app
beforeAll(async () => {
  app = await buildAuthApp()
  if (hasDatabase) await resetAuthTables(app.pg)
})
afterAll(async () => { await app.close() })

/** Distinct addresses, so the per-address bucket is never the thing that trips. */
const addressFor = (n) => `10.0.${Math.floor(n / 256) % 256}.${n % 256}`

const attempt = (email, remoteAddress) =>
  app.inject({
    method: 'POST',
    url: '/auth/sign-in',
    remoteAddress,
    payload: { email, password: 'not-the-right-password' },
  })

/** A refusal has to tell the caller when to come back, or it is just a wall. */
const expectRetryAfter = (response) => {
  expect(response.statusCode).toBe(429)
  expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
  expect(response.json().type).toMatch(/rate-limited/)
}

describe('the buckets are configured to fail CLOSED', () => {
  it('never lets a Redis outage silently disable a credential limit (FR-044)', () => {
    for (const name of ['sign-in-ip', 'sign-in-account', 'otp-send', 'otp-verify', 'password-reset', 'refresh']) {
      expect(BUCKETS[name].skipOnError, `${name} must fail closed`).toBe(false)
    }
  })

  it('keys the SMS bucket on the phone number, because each send costs money', () => {
    expect(BUCKETS['otp-send'].dimension).toBe('phone')
  })
})

describe.skipIf(!hasDatabase)('many addresses against ONE account (SC-013)', () => {
  it('refuses once the per-account bucket is spent, however many addresses are used', async () => {
    const member = await createMember(app.pg)
    const max = BUCKETS['sign-in-account'].max

    // Each attempt from its own address, so the per-address bucket (10 per 15
    // minutes) cannot be what refuses — this has to be the account bucket.
    for (let i = 0; i < max; i += 1) {
      const response = await attempt(member.email, addressFor(i))
      expect(response.statusCode, `attempt ${i + 1} should still be judged on credentials`).toBe(401)
    }

    const refused = await attempt(member.email, addressFor(max))
    expectRetryAfter(refused)
  })

  it('leaves a DIFFERENT account reachable from the same spread of addresses', async () => {
    const target = await createMember(app.pg)
    const bystander = await createMember(app.pg)
    const max = BUCKETS['sign-in-account'].max

    for (let i = 0; i < max + 1; i += 1) await attempt(target.email, addressFor(100 + i))
    expect((await attempt(target.email, addressFor(200))).statusCode).toBe(429)

    // The limit is scoped to the account under attack. If it were not, an
    // attacker could lock the whole club out by spraying one address.
    const other = await attempt(bystander.email, addressFor(300))
    expect(other.statusCode).toBe(401)
  })
})

describe.skipIf(!hasDatabase)('one address against MANY accounts (SC-013)', () => {
  it('refuses once the per-address bucket is spent, however many accounts are tried', async () => {
    const attacker = '203.0.113.77'
    const max = BUCKETS['sign-in-ip'].max

    // A fresh address per account each time, so no account bucket is spent
    // more than once — this has to be the address bucket that refuses.
    for (let i = 0; i < max; i += 1) {
      const response = await attempt(`victim-${randomUUID()}@test.invalid`, attacker)
      expect(response.statusCode, `attempt ${i + 1} should still be judged on credentials`).toBe(401)
    }

    const refused = await attempt(`victim-${randomUUID()}@test.invalid`, attacker)
    expectRetryAfter(refused)
  })

  it('leaves an innocent address unaffected', async () => {
    const attacker = '203.0.113.88'
    for (let i = 0; i < BUCKETS['sign-in-ip'].max + 1; i += 1) {
      await attempt(`victim-${randomUUID()}@test.invalid`, attacker)
    }
    expect((await attempt(`victim-${randomUUID()}@test.invalid`, attacker)).statusCode).toBe(429)

    const innocent = await attempt(`someone-${randomUUID()}@test.invalid`, '198.51.100.10')
    expect(innocent.statusCode).toBe(401)
  })
})

describe.skipIf(!hasDatabase)('a refusal carries the headers a client needs', () => {
  it('advertises the limit, the remainder and the reset alongside Retry-After (FR-042)', async () => {
    const attacker = '203.0.113.99'
    let refused
    for (let i = 0; i < BUCKETS['sign-in-ip'].max + 2; i += 1) {
      refused = await attempt(`victim-${randomUUID()}@test.invalid`, attacker)
    }

    // The draft-spec spelling (`RateLimit-*`, no `X-`), which is what
    // `enableDraftSpec` advertises and what FR-042 names.
    expectRetryAfter(refused)
    expect(refused.headers['ratelimit-limit']).toBeDefined()
    expect(refused.headers['ratelimit-remaining']).toBe('0')
    expect(refused.headers['ratelimit-reset']).toBeDefined()
  })

  it('answers in problem+json, like every other refusal on this server', async () => {
    const attacker = '203.0.113.111'
    let refused
    for (let i = 0; i < BUCKETS['sign-in-ip'].max + 2; i += 1) {
      refused = await attempt(`victim-${randomUUID()}@test.invalid`, attacker)
    }
    const body = refused.json()
    expect(body).toMatchObject({ status: 429, title: expect.any(String), instance: '/auth/sign-in' })
    expect(body.requestId).toBeTruthy()
  })
})

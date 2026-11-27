import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { BUCKETS } from '../../src/config/rate-limits.ts'
import { createMember, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildOnboardingApp, nextAddress, uniqueMobile } from '../onboarding/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 043: how often a reset code may be asked for.
 *
 * Three codes an hour per NUMBER (each code is an SMS that costs money and a fresh set of
 * five guesses at an account), and twenty an hour per ADDRESS (so one address cannot spray
 * many identifiers, each of which would otherwise have a budget of its own).
 *
 * The number's budget is keyed on the member's number however they were identified, so
 * asking by email, by number and asking again all spend the same three. For an identifier
 * that matches nobody the key is the identifier itself, which is what makes the limit
 * identical for a real account and a made-up one: a limit that applied only to real accounts
 * would be a way to find them.
 *
 * Each test uses numbers and addresses of its own. The limiter is in memory and per app (the
 * suite runs with Redis off), so tests are separated by key, not by rebuilding the app.
 */
const DEVICE = 'device-limits-test'

let app: GwcApp
let sms: { mobile: string; code: string }[]

beforeAll(async () => {
  if (!hasDatabase) return
  ;({ app, sms } = await buildOnboardingApp())
})
afterAll(async () => { await app?.close() })
beforeEach(async () => {
  if (!hasDatabase) return
  await resetAuthTables(app.pg)
  sms.length = 0
})

const ask = (identifier: { email: string } | { mobile: string }, remoteAddress = nextAddress()) =>
  app.inject({
    method: 'POST', url: '/auth/password-reset/code', payload: { ...identifier, deviceId: DEVICE }, remoteAddress,
  })

const settle = () => new Promise((resolve) => setTimeout(resolve, 80))

/** A verified member and the two ways of naming them. */
const memberWithNumber = async () => {
  const mobile = uniqueMobile()
  const member = await createMember(app.pg, { mobile, mobileVerified: true })
  return { id: member.id, byEmail: { email: member.email }, byNumber: { mobile } }
}

/** What a response says, without what varies per request by construction. */
const comparable = (r: { statusCode: number; json(): Record<string, unknown>; headers: Record<string, unknown> }) => {
  const body = { ...r.json(), instance: null, requestId: null } as Record<string, unknown>
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (typeof body.challengeId === 'string' && uuid.test(body.challengeId)) body.challengeId = '<uuid>'
  return {
    status: r.statusCode,
    body,
    headers: Object.fromEntries(Object.entries(r.headers).filter(([k]) =>
      !['x-request-id', 'x-client-request-id', 'date', 'content-length', 'content-security-policy', 'etag'].includes(k)
      && !/^(retry-after|x-?ratelimit.*|ratelimit.*)$/i.test(k))),
  }
}

describe('the limits are declared as documented', () => {
  it('is three an hour per number and twenty an hour per address, both failing closed', () => {
    expect(BUCKETS['password-reset-sms']).toMatchObject({ dimension: 'phone', max: 3, timeWindow: '1 hour', skipOnError: false })
    expect(BUCKETS['password-reset-ip']).toMatchObject({ dimension: 'ip', max: 20, timeWindow: '1 hour', skipOnError: false })
  })
})

describe.skipIf(!hasDatabase)('asking for a reset code, too often (feature 043)', () => {
  it.each([
    ['by email every time', (m: Awaited<ReturnType<typeof memberWithNumber>>) => [m.byEmail, m.byEmail, m.byEmail, m.byEmail]],
    ['by number every time', (m: Awaited<ReturnType<typeof memberWithNumber>>) => [m.byNumber, m.byNumber, m.byNumber, m.byNumber]],
    ['by a mix of email and number', (m: Awaited<ReturnType<typeof memberWithNumber>>) => [m.byEmail, m.byNumber, m.byEmail, m.byNumber]],
  ])('refuses the fourth ask in an hour, %s', async (_label, identifiers) => {
    const member = await memberWithNumber()
    const [first, second, third, fourth] = identifiers(member)

    for (const identifier of [first, second, third]) {
      expect((await ask(identifier!)).statusCode).toBe(202)
    }
    await vi.waitFor(() => expect(sms).toHaveLength(3))

    const refused = await ask(fourth!)

    expect(refused.statusCode).toBe(429)
    expect(refused.json().type).toBe(PROBLEMS.RATE_LIMITED.type)
    expect(refused.headers['retry-after']).toBeDefined()
    // And it sent nothing: three texts, not four.
    await settle()
    expect(sms).toHaveLength(3)
  })

  it('refuses an identifier that matches nobody after exactly three asks too, in the same words', async () => {
    const real = await memberWithNumber()
    const fakeEmail = { email: `nobody-${Date.now()}@test.invalid` }
    const realAnswers: Awaited<ReturnType<typeof ask>>[] = []
    const fakeAnswers: Awaited<ReturnType<typeof ask>>[] = []
    for (let n = 0; n < 4; n += 1) {
      realAnswers.push(await ask(real.byEmail))
      fakeAnswers.push(await ask(fakeEmail))
    }

    expect(realAnswers.map((r) => r.statusCode)).toEqual([202, 202, 202, 429])
    expect(fakeAnswers.map((r) => r.statusCode)).toEqual([202, 202, 202, 429])
    // Every answer, the refusal included, is the same for the made-up identifier as for the real one.
    realAnswers.forEach((answer, n) => expect(comparable(fakeAnswers[n]!)).toEqual(comparable(answer)))
  })

  it('keeps two numbers apart: one being at its limit does not limit another', async () => {
    const busy = await memberWithNumber()
    const other = await memberWithNumber()
    for (let n = 0; n < 3; n += 1) await ask(busy.byEmail)
    expect((await ask(busy.byEmail)).statusCode).toBe(429)

    expect((await ask(other.byEmail)).statusCode).toBe(202)
  })

  // Asking again is how the app "resends", and a resend of a reset challenge sends nothing (it is
  // answered like an unknown id, research R17), so it uses none of the three.
  it('a resend of a reset challenge sends nothing and uses none of the budget', async () => {
    const member = await memberWithNumber()
    const first = await ask(member.byEmail)
    await vi.waitFor(() => expect(sms).toHaveLength(1))
    const challengeId = first.json().challengeId as string
    // Past the 60-second cooldown, so an ordinary resend WOULD send a code now.
    await app.pg.query(`UPDATE otp_challenges SET created_at = now() - interval '120 seconds' WHERE id = $1`, [challengeId])

    for (let n = 0; n < 2; n += 1) {
      const resent = await app.inject({ method: 'POST', url: '/auth/otp/resend', payload: { challengeId } })
      expect(resent.statusCode).toBe(202)
    }
    await settle()
    expect(sms, 'the resends sent a text').toHaveLength(1)

    // One ask and two resends so far: exactly two more asks fit, and then the limit.
    expect((await ask(member.byEmail)).statusCode).toBe(202)
    expect((await ask(member.byEmail)).statusCode).toBe(202)
    expect((await ask(member.byEmail)).statusCode).toBe(429)
  })

  it('limits one address to twenty asks an hour, however many numbers it names', async () => {
    const address = nextAddress()
    for (let n = 1; n <= 20; n += 1) {
      const answer = await ask({ mobile: uniqueMobile() }, address)
      expect(answer.statusCode, `ask ${n}`).toBe(202)
    }

    const twentyFirst = await ask({ mobile: uniqueMobile() }, address)

    expect(twentyFirst.statusCode).toBe(429)
    expect(twentyFirst.json().type).toBe(PROBLEMS.RATE_LIMITED.type)
    // The counter-assertion: another address is not affected.
    expect((await ask({ mobile: uniqueMobile() }, nextAddress())).statusCode).toBe(202)
  })
})

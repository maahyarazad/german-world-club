import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { PASSWORD, createMember, resetAuthTables, signIn } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildOnboardingApp, nextAddress, uniqueMobile } from '../onboarding/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 043, research R17: the challenge id an ask hands back must reveal nothing about
 * the identifier it was asked for.
 *
 * Asking is answered identically for a member and for an identifier that matches nobody, and
 * the one thing that differs between them is hidden inside that answer: the id. For a member
 * it points at a real challenge; for anyone else it is a random uuid that no row has. If ANY
 * endpoint that accepts a challenge id treats a real one differently from a made-up one, the
 * caller has an account-existence oracle, one request or five away.
 *
 * So this test takes the id from a real ask and from a made-up one and does everything a
 * caller could do with it, side by side:
 *   - resend it (`/auth/otp/resend`);
 *   - present it where a SIGN-IN code is redeemed (`/auth/verify-otp`) and where a MOBILE
 *     code is (`/onboarding/verify-mobile`), six times each;
 *   - try it at the reset itself (`/auth/password-reset/code/confirm`) with six wrong codes
 *     and then the right one (the fifth wrong try kills a real challenge, and the caller must
 *     not be able to see that).
 * and requires every answer to be the same, step for step, for the real member and the
 * made-up identifier.
 */
const DEVICE = 'device-chain-test'
const NEW_PASSWORD = 'ein-ganz-neues-passwort'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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

const comparable = (r: { statusCode: number; json(): Record<string, unknown>; headers: Record<string, unknown> }) => {
  const body = { ...r.json(), instance: null, requestId: null } as Record<string, unknown>
  if (typeof body.challengeId === 'string' && UUID.test(body.challengeId)) body.challengeId = '<uuid>'
  return {
    status: r.statusCode,
    body,
    headers: Object.fromEntries(Object.entries(r.headers).filter(([k]) =>
      !['x-request-id', 'x-client-request-id', 'date', 'content-length', 'content-security-policy', 'etag'].includes(k)
      && !/^(retry-after|x-?ratelimit.*|ratelimit.*)$/i.test(k))),
  }
}

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, payload, remoteAddress: nextAddress() })

const ask = (identifier: { email: string }) => post('/auth/password-reset/code', { ...identifier, deviceId: DEVICE })

/** What a caller can do with a challenge id, in order, answered by the server. */
const walk = async (challengeId: string) => {
  const steps: { step: string; answer: ReturnType<typeof comparable> }[] = []
  const record = async (step: string, response: Awaited<ReturnType<typeof post>>) => {
    steps.push({ step, answer: comparable(response) })
  }

  await record('resend', await post('/auth/otp/resend', { challengeId }))
  for (let n = 1; n <= 6; n += 1) {
    await record(`verify-otp #${n}`, await post('/auth/verify-otp', { challengeId, code: '0000', deviceId: DEVICE }))
  }
  for (let n = 1; n <= 6; n += 1) {
    await record(`verify-mobile #${n}`, await post('/onboarding/verify-mobile', { challengeId, code: '0000', deviceId: DEVICE }))
  }
  // Six wrong codes: for a real challenge the fifth ends it. The sixth and the seventh must look the same.
  for (let n = 1; n <= 6; n += 1) {
    await record(`confirm wrong #${n}`, await post('/auth/password-reset/code/confirm', {
      challengeId, code: '000000', deviceId: DEVICE, password: NEW_PASSWORD,
    }))
  }
  return steps
}

describe.skipIf(!hasDatabase)('a reset challenge id, followed everywhere it can be presented (research R17)', () => {
  it('behaves identically for a member and for an identifier that matches nobody', async () => {
    const member = await createMember(app.pg, { mobile: uniqueMobile(), mobileVerified: true })
    const real = await ask({ email: member.email })
    const fake = await ask({ email: `nobody-${Date.now()}@test.invalid` })
    expect(real.statusCode).toBe(202)
    expect(fake.statusCode).toBe(202)
    // Sanity: the real ask really did create a challenge and the fake one did not (so the
    // comparison below is between a real row and a made-up id, not between two made-up ones).
    await vi.waitFor(() => expect(sms).toHaveLength(1))
    const rows = (await app.pg.query(`SELECT id FROM otp_challenges WHERE account_id = $1`, [member.id])).rows
    expect(rows.map((r) => r.id)).toEqual([real.json().challengeId])
    expect((await app.pg.query(`SELECT 1 FROM otp_challenges WHERE id = $1`, [fake.json().challengeId])).rowCount).toBe(0)
    const code = sms[0]!.code

    const realSteps = await walk(real.json().challengeId)
    const fakeSteps = await walk(fake.json().challengeId)

    expect(realSteps.map((s) => s.step)).toEqual(fakeSteps.map((s) => s.step))
    for (let i = 0; i < realSteps.length; i += 1) {
      expect(realSteps[i]!.answer, realSteps[i]!.step).toEqual(fakeSteps[i]!.answer)
    }
    // And what they all say is the one refusal (apart from the resend, which is a 202).
    for (const { step, answer } of realSteps.filter((s) => s.step !== 'resend')) {
      expect(answer.status, step).toBe(401)
      expect(answer.body.type, step).toBe(PROBLEMS.INVALID_OTP.type)
    }

    // After five wrong tries the real challenge is dead: even the right code is refused,
    // with the same answer a made-up id gets.
    const dead = await post('/auth/password-reset/code/confirm', {
      challengeId: real.json().challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD,
    })
    const unknown = await post('/auth/password-reset/code/confirm', {
      challengeId: fake.json().challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD,
    })
    expect(comparable(dead)).toEqual(comparable(unknown))
    // The member's password never moved.
    expect((await signIn(app, member.email, PASSWORD)).body.outcome).toBe('authenticated')
  })

  // The counter-assertion: the chain is not vacuous. Everything above would also hold if the
  // real ask never produced a usable code, so a fresh real ask whose code is presented first
  // must actually change the password.
  it('while a real code, presented first, does reset the password', async () => {
    const member = await createMember(app.pg, { mobile: uniqueMobile(), mobileVerified: true })
    const real = await ask({ email: member.email })
    await vi.waitFor(() => expect(sms).toHaveLength(1))

    const done = await post('/auth/password-reset/code/confirm', {
      challengeId: real.json().challengeId, code: sms[0]!.code, deviceId: DEVICE, password: NEW_PASSWORD,
    })

    expect(done.statusCode).toBe(200)
    expect((await signIn(app, member.email, NEW_PASSWORD)).body.outcome).toBe('authenticated')
  })
})

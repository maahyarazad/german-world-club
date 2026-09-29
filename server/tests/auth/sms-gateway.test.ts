import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { loadEnv } from '../../src/config/env.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildOnboardingApp, register, applicant } from '../onboarding/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The SMS gateway (decorators/send-otp.ts): the one path to the provider, with
 * the country policy in front of it.
 */

const SRC = join(import.meta.dirname, '../../src')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : []
  })

describe('there is exactly one way to send an SMS', () => {
  it('only the gateway calls sendCode, and only sms.ts touches the SDK', () => {
    const callers = (pattern: RegExp) =>
      files(SRC).filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f)).sort()
    // A new call site that skipped the gateway would skip the country policy.
    expect(callers(/\.sendCode\(/)).toEqual(['decorators/send-otp.ts'])
    expect(callers(/\.sms\.send\(|from 'smsglobal'/)).toEqual(['integrations/sms.ts'])
    // Counter-assertion: the scan actually reads files (a broken glob passes the above vacuously).
    expect(files(SRC).length).toBeGreaterThan(50)
  })
})

describe.skipIf(!hasDatabase)('the gateway enforces the country policy', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]
  const lines: Record<string, unknown>[] = []

  beforeAll(async () => {
    ({ app, sms } = await buildOnboardingApp({
      logger: { level: 'info', stream: { write: (s: string) => lines.push(JSON.parse(s)) } },
    }))
  })
  afterAll(async () => { await app.close() })

  it('refuses a registration to a sanctioned country before writing anything, and logs it masked', async () => {
    const details = applicant({ mobile: '+8501912345678' })
    lines.length = 0
    const r = await register(app, details)

    expect(r.statusCode).toBe(422)
    expect(r.json().type).toBe(PROBLEMS.SMS_DESTINATION_NOT_ALLOWED.type)
    expect(sms).toHaveLength(0)
    const { rows } = await app.pg.query('SELECT 1 FROM members WHERE email = $1', [details.email])
    expect(rows).toHaveLength(0)

    const refusal = lines.find((l) => l.msg === 'SMS_BLOCKED_COUNTRY')
    expect(refusal).toMatchObject({ route: 'onboarding.register', dialingCode: '850', reason: 'country_blocked' })
    expect(JSON.stringify(lines)).not.toContain('8501912345678')
    expect(refusal!.destination).toBe('*********5678')
  })

  it('refuses a Canadian +1 number, which shares a dialing code with the approved USA', async () => {
    const r = await register(app, applicant({ mobile: '+14165550100' }))
    expect(r.statusCode).toBe(422)
    expect(r.json().type).toBe(PROBLEMS.SMS_DESTINATION_NOT_ALLOWED.type)
  })

  it('sends to an approved number, through the same path', async () => {
    // Counter-assertion: a gateway refusing everything would pass the tests above.
    const before = sms.length
    const r = await register(app, applicant())
    expect(r.statusCode).toBe(202)
    expect(sms).toHaveLength(before + 1)
  })

  it('refuses at the gateway itself, for every caller', async () => {
    const before = sms.length
    await expect(app.sendOtp({ mobile: '+98 912 345 6789', code: '1234', route: 'test' }))
      .rejects.toMatchObject({ problem: PROBLEMS.SMS_DESTINATION_NOT_ALLOWED })
    expect(sms).toHaveLength(before)
  })

  it('never gates verification: a code sent before the allowlist narrowed still redeems', async () => {
    const details = applicant()
    const registered = await register(app, details)
    const { challengeId } = registered.json()
    const code = sms.at(-1)!.code

    // A second process whose policy now blocks Germany, sharing the database.
    const { app: narrowed } = await buildOnboardingApp({ env: { ...loadEnv(), SMS_BLOCKED_COUNTRIES: '49' } })
    try {
      expect(() => narrowed.assertSmsDestination(details.mobile as string, 'test')).toThrow()
      const verified = await narrowed.inject({
        method: 'POST', url: '/onboarding/verify-mobile', payload: { challengeId, code, deviceId: details.deviceId },
      })
      expect(verified.statusCode).toBe(200)
    } finally {
      await narrowed.close()
    }
  })
})

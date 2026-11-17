import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { loadEnv } from '../../src/config/env.ts'
import { createSmsClient } from '../../src/integrations/sms.ts'
import type { SmsGlobalFactory } from '../../src/integrations/sms.ts'
import { buildApp } from '../../src/app.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import { createMember, resetAuthTables, signIn } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * `SMS_DEV_LOG` (feature 027, US4): in development the code is printed in the
 * terminal AND the real SMS is still sent, and a provider refusal no longer
 * blocks sign-in. On by default in development.
 *
 * Every case has its counter-assertion. The apps below have NO SMSGlobal
 * credentials, so a server that did not use the sink answers 503 — which is what
 * the "flag off" and "test environment" cases assert. (A sink that ignored the
 * environment would fail those two.)
 */
const DEVICE = 'phone-sink'
const MOBILE = '+971501234567'

const appWith = (overrides: Record<string, unknown>) =>
  buildApp({
    contentSource: createFixtureContentSource([]),
    env: { ...loadEnv(), SMSGLOBAL_API_KEY: undefined, SMSGLOBAL_API_SECRET: undefined, ...overrides },
  }).then(async (app) => { await app.ready(); return app })

describe('the environment refuses the flag in production', () => {
  const production = {
    NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/x', CANONICAL_ORIGIN: 'https://example.test',
    TRUST_PROXY: '1', REDIS_URL: 'redis://localhost', REDIS_ENABLED: 'true', EXPO_ACCESS_TOKEN: 'x',
    JWT_PRIVATE_KEY: 'k', JWT_PUBLIC_KEY: 'k',
  }
  it('names SMS_DEV_LOG and refuses to boot', () => {
    expect(() => loadEnv({ ...production, SMS_DEV_LOG: 'true' })).toThrow(/SMS_DEV_LOG/)
  })
  it('boots with the same settings when the flag is off (counter-assertion)', () => {
    expect(() => loadEnv({ ...production })).not.toThrow()
    expect(() => loadEnv({ ...production, SMS_DEV_LOG: 'false' })).not.toThrow()
  })
  it('is ON by default in development, off in test, and can be switched off', () => {
    const base = { DATABASE_URL: 'postgres://localhost/x' }
    expect(loadEnv({ ...base, NODE_ENV: 'development' }).SMS_DEV_LOG).toBe(true)
    expect(loadEnv({ ...base }).SMS_DEV_LOG).toBe(true) // NODE_ENV defaults to development
    expect(loadEnv({ ...base, NODE_ENV: 'development', SMS_DEV_LOG: 'false' }).SMS_DEV_LOG).toBe(false)
    // Counter-assertion: the default is not "always on".
    expect(loadEnv({ ...base, NODE_ENV: 'test' }).SMS_DEV_LOG).toBe(false)
  })
})

describe('the development behaviour of the SMS client', () => {
  /** A fake SDK, so nothing leaves the machine; `send` decides what SMSGlobal "answers". */
  const sdk = (send: (m: unknown) => Promise<{ data: unknown }>) => {
    const sent: unknown[] = []
    const factory = (() => ({ sms: { send: async (m: unknown) => { sent.push(m); return send(m) } } })) as unknown as SmsGlobalFactory
    return { sent, factory }
  }
  const creds = { apiKey: 'k', apiSecret: 's', origin: 'B P' }

  it('prints the code AND sends the real SMS', async () => {
    const lines: string[] = []
    const { sent, factory } = sdk(async () => ({ data: { id: 1 } }))
    const client = createSmsClient({ ...creds, sdkFactory: factory, development: { write: (l) => lines.push(l) } })
    const result = await client.sendCode({ mobile: '+971501234567', code: '4821' })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ destination: '971501234567', message: expect.stringContaining('4821') })
    expect(result.delivered).toBe(true)
    expect(lines).toEqual(['SMS (development) code 4821 for ********4567'])
  })

  it('still succeeds, and says why, when the provider refuses', async () => {
    const lines: string[] = []
    const { factory } = sdk(async () => { throw { statusCode: 400, data: { errors: { destination: 'invalid' } } } })
    const client = createSmsClient({ ...creds, sdkFactory: factory, development: { write: (l) => lines.push(l) } })
    const result = await client.sendCode({ mobile: '+10000000000', code: '1111' })
    expect(result.delivered).toBe(false) // did not throw: sign-in carries on with the terminal code
    expect(lines[0]).toContain('code 1111')
    expect(lines.join('\n')).toMatch(/refused .*status 400.*destination/)
    expect(lines.join('\n')).not.toContain('+10000000000')
  })

  it('only prints when there is no provider configured, and never touches the SDK', async () => {
    const lines: string[] = []
    const { sent, factory } = sdk(async () => { throw new Error('must not be called') })
    await createSmsClient({ sdkFactory: factory, development: { write: (l) => lines.push(l) } })
      .sendCode({ mobile: '+971501234567', code: '2222' })
    expect(sent).toHaveLength(0)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/not configured/)
  })

  it('outside development a provider refusal still propagates (counter-assertion)', async () => {
    const { factory } = sdk(async () => { throw { statusCode: 400, data: 'nope' } })
    await expect(createSmsClient({ ...creds, sdkFactory: factory }).sendCode({ mobile: '+971501234567', code: '3333' }))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

describe.skipIf(!hasDatabase)('sign-in on a new phone with the development sink', () => {
  let app: GwcApp | null = null
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined) })
  afterEach(async () => { warn.mockRestore(); await app?.close(); app = null })

  const printed = () => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('SMS (development'))

  async function member(mobile = MOBILE) {
    await resetAuthTables(app!.pg)
    return createMember(app!.pg, { mobile, mobileVerified: true })
  }

  it('prints the code and lets the member finish signing in with it, with no provider configured', async () => {
    app = await appWith({ NODE_ENV: 'development', SMS_DEV_LOG: true })
    const m = await member()
    const first = await signIn(app, m.email, undefined, { deviceId: DEVICE })
    expect(first.body.outcome).toBe('otp_required')

    const lines = printed()
    const line = lines.find((l) => /code \d{4} for/.test(l))!
    const code = line.match(/code (\d{4}) for/)![1]!
    expect(line).toContain('4567') // masked destination, last four only
    expect(lines.join('\n')).not.toContain('971501234567')

    const verified = await app.inject({
      method: 'POST', url: '/auth/verify-otp',
      payload: { challengeId: first.body.challengeId, code, deviceId: DEVICE },
    })
    expect(verified.statusCode).toBe(200)
    expect(verified.json().accessToken).toBeTruthy()
  })

  it('does not print the code anywhere in the structured log', async () => {
    const lines: string[] = []
    app = await buildApp({
      contentSource: createFixtureContentSource([]),
      logger: { level: 'info', stream: { write: (s: string) => lines.push(s) } },
      env: { ...loadEnv(), NODE_ENV: 'development', SMS_DEV_LOG: true, SMSGLOBAL_API_KEY: undefined, SMSGLOBAL_API_SECRET: undefined },
    })
    await app.ready()
    const m = await member()
    await signIn(app, m.email, undefined, { deviceId: DEVICE })
    const code = printed().find((l) => /code \d{4} for/.test(l))!.match(/code (\d{4}) for/)![1]!
    expect(lines.join('')).not.toContain(`"code":"${code}"`)
    expect(lines.join('').includes(`code ${code} for`)).toBe(false)
  })

  it('answers 503 when the flag is off (counter-assertion: this is what the sink replaces)', async () => {
    app = await appWith({ NODE_ENV: 'development', SMS_DEV_LOG: false })
    const m = await member()
    const { statusCode, body } = await signIn(app, m.email, undefined, { deviceId: DEVICE })
    expect(statusCode).toBe(503)
    expect(body.type).toBe(PROBLEMS.SERVICE_UNAVAILABLE.type)
    expect(printed()).toHaveLength(0)
  })

  it('is ignored outside development, even with the flag set', async () => {
    app = await appWith({ NODE_ENV: 'test', SMS_DEV_LOG: true })
    const m = await member()
    const { statusCode } = await signIn(app, m.email, undefined, { deviceId: DEVICE })
    expect(statusCode).toBe(503)
    expect(printed()).toHaveLength(0)
  })

  it('still refuses a sanctioned destination while the sink is on', async () => {
    app = await appWith({ NODE_ENV: 'development', SMS_DEV_LOG: true })
    const m = await member('+8501912345678')
    const { statusCode, body } = await signIn(app, m.email, undefined, { deviceId: DEVICE })
    expect(statusCode).toBe(422)
    expect(body.type).toBe(PROBLEMS.SMS_DESTINATION_NOT_ALLOWED.type)
    expect(printed()).toHaveLength(0)
  })
})

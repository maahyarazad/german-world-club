import { z } from 'zod'
import { describe, it, expect } from 'vitest'
import { REDACT_PATHS, loggerOptions, maskSearchQuery } from '../../src/plugins/01-logging.ts'
import { buildApp } from '../../src/app.ts'
import { loadEnv } from '../../src/config/env.ts'
import { sanitizeDetail } from '../../src/ops/audit.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetAuthTables } from '../helpers/auth.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import { dispatchDue } from '../../src/modules/push/application/dispatch.ts'
import { createLoggingTransport } from '../../src/modules/push/providers.ts'
import { resetPush, memberWithDevice, insertNotification } from '../push/helpers.ts'

/**
 * SC-016 / FR-048: no credential, token, one-time code, or member contact
 * detail reaches a log line.
 *
 * This is a data-protection control, not tidiness — the club holds member PII.
 */
describe('log redaction (SC-016)', () => {
  it('captures a request carrying every sensitive field without emitting any of them', async () => {
    const lines = []
    const env = { ...loadEnv(), LOG_LEVEL: 'info' }
    const app = await buildApp({
      env,
      logger: {
        level: 'info',
        redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
        stream: { write: (s) => lines.push(s) },
      },
    })
    app.post('/probe', {
      config: { auth: { audience: 'public' } },
      schema: { response: { 200: z.object({ ok: z.boolean() }) } },
    }, async (request) => {
      request.log.info({ body: request.body }, 'probe')
      return { ok: true }
    })
    await app.ready()

    const secrets = {
      password: 'correct-horse-battery-staple',
      code: '4821',
      otp: '4821',
      refreshToken: 'rt_supersecret_value',
      accessToken: 'eyJhbGciOiJFZERTQSJ9.payload.sig',
      token: 'tok_secret',
      email: 'member@example.test',
      mobile: '+971500000000',
    }
    await app.inject({
      method: 'POST',
      url: '/probe',
      payload: secrets,
      headers: { authorization: 'Bearer eyJhbGciOiJFZERTQSJ9.leak.sig', cookie: 'gwc_at=leaky' },
    })
    await app.close()

    const output = lines.join('\n')
    expect(output.length).toBeGreaterThan(0)
    for (const [field, value] of Object.entries(secrets)) {
      expect(output, `${field} leaked into the log`).not.toContain(value)
    }
    expect(output).not.toContain('leaky')
    expect(output).not.toContain('eyJhbGciOiJFZERTQSJ9.leak.sig')
  })

  it('redacts every documented path', () => {
    for (const p of ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', '*.refreshToken', '*.password_hash']) {
      expect(REDACT_PATHS).toContain(p)
    }
  })

  it('disables logging entirely at the silent level rather than emitting unredacted output', () => {
    expect(loggerOptions({ LOG_LEVEL: 'silent' })).toBe(false)
  })

  it('drops audit detail keys that are not on the allowlist', () => {
    const detail = sanitizeDetail({ module: 'members', flag: 'edit', password: 'leak', email: 'a@b.test' })
    expect(detail).toEqual({ module: 'members', flag: 'edit' })
  })

  it('returns null rather than an empty object when nothing is safe to keep', () => {
    expect(sanitizeDetail({ password: 'leak' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Push tokens (feature 011, T027). A push token is a credential for addressing
// somebody's phone: it may be stored in push_devices.token and nowhere else.
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabase)('push dispatch logs no token (FR-029)', () => {
  it('neither the logging transport nor a failing one writes a token to a log line or the history', async () => {
    const lines: string[] = []
    const app = await buildApp({
      env: { ...loadEnv(), LOG_LEVEL: 'info' },
      contentSource: createFixtureContentSource([]),
      logger: {
        level: 'info',
        redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
        stream: { write: (s: string) => lines.push(s) },
      },
    })
    await app.ready()
    try {
      await resetPush(app.pg)
      await resetAuthTables(app.pg)
      const member = await memberWithDevice(app)

      // 1. Development's logging transport, which logs every "would send".
      await insertNotification(app.pg)
      await dispatchDue(app, { transport: createLoggingTransport(app.log), pauseMs: 0 })

      // 2. A provider whose errors quote the token, and one that throws with it.
      const quoting = await insertNotification(app.pg)
      await dispatchDue(app, {
        pauseMs: 0,
        transport: {
          send: async (_p, messages) => messages.map((m) => ({
            status: 'failed', permanent: false, error: `"${m.token}" is not a registered push notification recipient`,
          })),
          receipts: async () => ({}),
        },
      })
      const throwing = await insertNotification(app.pg)
      await dispatchDue(app, {
        pauseMs: 0,
        transport: {
          send: async (_p, messages) => { throw new Error(`socket closed while sending to ${messages[0]!.token}`) },
          receipts: async () => ({}),
        },
      })

      const output = lines.join('\n')
      // Counter-assertion: the logging transport really logged the send.
      expect(output).toContain('would send')
      expect(output).not.toContain(member.token)
      expect(output).not.toContain('ExponentPushToken[')

      const { rows } = await app.pg.query(
        `SELECT error_message FROM push_deliveries WHERE notification_id = ANY($1::uuid[])`,
        [[quoting, throwing]],
      )
      expect(rows).toHaveLength(2)
      for (const { error_message } of rows) {
        expect(error_message).toContain('[token]')
        expect(error_message).not.toContain(member.token)
      }
    } finally {
      await app.close()
    }
  })
})

/**
 * Feature 042, FR-025, research R15: the typed text of a search is private.
 *
 * The request serializer logs `req.url`, query string included, so a person who
 * searches for a name, an email address or a phone number would have it written
 * to every request log line. The value of `q` is masked centrally, in the
 * serializer, so it holds for routes not yet written. Every other parameter is
 * still logged: a mask that ate the whole query string would hide the
 * category a failing request used.
 */
describe('search text in the request log (FR-025)', () => {
  it('captures a real request without the typed text, and still logs the other parameters', async () => {
    const lines: string[] = []
    const env = { ...loadEnv(), LOG_LEVEL: 'info' as const }
    // The real serializers, in the production shape (no file transport) so the lines can be captured.
    const options = loggerOptions({ ...loadEnv(), LOG_LEVEL: 'info' as const, isProduction: true })
    const app = await buildApp({ env, logger: { ...(options as object), stream: { write: (s: string) => lines.push(s) } } as never })
    app.get('/probe-search', {
      config: { auth: { audience: 'public' } },
      schema: { response: { 200: z.object({ ok: z.boolean() }) } },
    }, async () => ({ ok: true }))
    await app.ready()

    await app.inject({ method: 'GET', url: '/probe-search?q=zzprivate%20needle&categoryId=abc' })
    await app.close()

    const output = lines.join('\n')
    expect(output).toContain('/probe-search')
    expect(output).not.toContain('zzprivate')
    expect(output).not.toContain('needle')
    expect(output).toContain('q=[redacted]')
    // Counter-assertion: the rest of the query string is still there.
    expect(output).toContain('categoryId=abc')
  })

  it.each([
    ['/member/offers?q=zzprivate&categoryId=abc', '/member/offers?q=[redacted]&categoryId=abc'],
    ['/marketplace/listings?mode=offer&q=x%20y', '/marketplace/listings?mode=offer&q=[redacted]'],
    ['/member/offers?q=', '/member/offers?q=[redacted]'],
    ['/member/offers?q=a&q=b', '/member/offers?q=[redacted]&q=[redacted]'],
  ])('masks the value of q: %s', (url, expected) => {
    expect(maskSearchQuery(url)).toBe(expected)
  })

  it.each([
    '/member/offers',
    '/member/offers?categoryId=abc&cursor=xyz',
    '/member/offers?query=zzprivate&qq=zzprivate',
    '/auth/refresh',
  ])('leaves a URL with no q alone: %s', (url) => {
    expect(maskSearchQuery(url)).toBe(url)
  })

  it('copes with something that is not a URL', () => {
    expect(maskSearchQuery(undefined as never)).toBeUndefined()
    expect(maskSearchQuery('')).toBe('')
  })
})

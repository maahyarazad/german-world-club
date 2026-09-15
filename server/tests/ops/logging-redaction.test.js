import { describe, it, expect } from 'vitest'
import { REDACT_PATHS, loggerOptions } from '../../src/plugins/01-logging.js'
import { buildApp } from '../../src/app.js'
import { loadEnv } from '../../src/config/env.js'
import { sanitizeDetail } from '../../src/ops/audit.js'

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
    app.post('/probe', { config: { auth: { audience: 'public' } } }, async (request) => {
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

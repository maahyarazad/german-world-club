import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadEnv } from '../../src/config/env.ts'
import { buildApp } from '../../src/app.ts'
import { REDACT_PATHS } from '../../src/plugins/01-logging.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The email verification code is printed in the terminal in development, like the
 * SMS code: a plain console line carrying the code, and nothing in the structured
 * log. Each case has its counter-assertion: the flag off, and any other
 * environment, print nothing, and the mail is still sent where a client exists.
 *
 * `sendMailInstantly` needs no database, so this suite runs everywhere.
 */
let app: GwcApp | null = null
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined) })
afterEach(async () => { warn.mockRestore(); await app?.close(); app = null })

const printed = () => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('Email (development'))

async function appWith(overrides: Record<string, unknown>, logLines: string[] = []) {
  const sent: unknown[] = []
  app = await buildApp({
    contentSource: createFixtureContentSource([]),
    // The app's own redaction paths: a hand-made logger would not redact, and the test would show nothing real.
    logger: { level: 'info', stream: { write: (s: string) => logLines.push(s) }, redact: { paths: [...REDACT_PATHS], censor: '[redacted]' } },
    env: { ...loadEnv(), ...overrides },
    integrations: {
      mail: { name: 'mail', configured: true, send: async (m: unknown) => { sent.push(m); return { delivered: true } } },
      sms: { configured: true, sendCode: async () => ({ delivered: true }) },
    },
  } as never)
  await app.ready()
  return { app, sent }
}

const send = (a: GwcApp, variables: Record<string, unknown>) =>
  a.sendMailInstantly({ to: 'anna@example.test', template: 'onboarding.email-code', subjectKey: 'c-1', variables })

describe('the email code in the development terminal', () => {
  it('prints the code, and still sends the mail', async () => {
    const { app: a, sent } = await appWith({ NODE_ENV: 'development', SMS_DEV_LOG: true })
    await send(a, { code: '482913', name: 'Anna' })
    expect(printed()).toEqual(['Email (development) code 482913 for anna@example.test'])
    expect(sent).toHaveLength(1)
  })

  it('never writes the code to the structured log', async () => {
    const lines: string[] = []
    const { app: a } = await appWith({ NODE_ENV: 'development', SMS_DEV_LOG: true }, lines)
    await send(a, { code: '482913', name: 'Anna' })
    expect(printed()).toHaveLength(1)
    // Counter-assertion: the structured log did record the mail, with the code redacted,
    // so the terminal line is the only place the developer can read it.
    expect(lines.join('')).toContain('mail sent instantly')
    expect(lines.join('')).not.toContain('482913')
  })

  it('prints nothing when SMS_DEV_LOG is off (counter-assertion)', async () => {
    const { app: a, sent } = await appWith({ NODE_ENV: 'development', SMS_DEV_LOG: false })
    await send(a, { code: '482913' })
    expect(printed()).toHaveLength(0)
    expect(sent).toHaveLength(1)
  })

  it('prints nothing outside development, even with the flag set (counter-assertion)', async () => {
    const { app: a } = await appWith({ NODE_ENV: 'test', SMS_DEV_LOG: true })
    await send(a, { code: '482913' })
    expect(printed()).toHaveLength(0)
  })

  it('prints nothing for a mail that carries no code', async () => {
    const { app: a } = await appWith({ NODE_ENV: 'development', SMS_DEV_LOG: true })
    await send(a, { name: 'Anna' })
    expect(printed()).toHaveLength(0)
  })
})

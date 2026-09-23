import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import { deliverDueMail } from '../../src/decorators/mail.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The mail outbox (021_mail_outbox.sql): enqueue is idempotent, delivery
 * clears what it carried, and a failure waits and retries instead of being
 * lost or sent twice.
 */
describe.skipIf(!hasDatabase)('the mail outbox', () => {
  let app: GwcApp
  const sent: { to: string; template: string }[] = []
  let failing = false

  beforeAll(async () => {
    app = await buildApp({
      contentSource: createFixtureContentSource([]),
      integrations: {
        mail: {
          send: async (message: { to: string; template: string }) => {
            if (failing) throw Object.assign(new Error('mail provider down'), { statusCode: 503 })
            sent.push(message)
            return { delivered: true }
          },
        },
      },
    })
    await app.ready()
  })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await app.pg.query('TRUNCATE mail_outbox')
    sent.length = 0
    failing = false
  })

  const message = { to: 'someone@test.invalid', template: 'onboarding.email-code', subjectKey: 'challenge-1', variables: { code: '123456' } }

  it('queues a message once, however often it is enqueued', async () => {
    await app.enqueueMail(message)
    await app.enqueueMail(message)
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM mail_outbox')
    expect(rows[0].n).toBe(1)
  })

  it('delivers what is due and clears the variables it carried', async () => {
    await app.enqueueMail(message)
    expect((await deliverDueMail(app)).itemsProcessed).toBe(1)
    expect(sent.map((m) => m.template)).toEqual(['onboarding.email-code'])

    const { rows } = await app.pg.query('SELECT sent_at, variables FROM mail_outbox')
    expect(rows[0].sent_at).not.toBeNull()
    // A verification code must not outlive its delivery in the table.
    expect(rows[0].variables).toEqual({})

    // Delivered mail is not delivered again.
    expect((await deliverDueMail(app)).itemsProcessed).toBe(0)
    expect(sent).toHaveLength(1)
  })

  it('keeps a failed message, backs off, and delivers it once the provider recovers', async () => {
    await app.enqueueMail(message)
    failing = true
    expect((await deliverDueMail(app)).itemsProcessed).toBe(0)

    const { rows } = await app.pg.query('SELECT attempts, last_error, next_attempt_at > now() AS waiting FROM mail_outbox')
    expect(rows[0]).toMatchObject({ attempts: 1, waiting: true })
    expect(rows[0].last_error).toBeTruthy()

    // Not due yet: nothing is sent early.
    failing = false
    expect((await deliverDueMail(app)).itemsProcessed).toBe(0)

    await app.pg.query('UPDATE mail_outbox SET next_attempt_at = now()')
    expect((await deliverDueMail(app)).itemsProcessed).toBe(1)
    expect(sent).toHaveLength(1)
  })
})

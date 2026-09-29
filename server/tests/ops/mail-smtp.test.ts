import { describe, it, expect } from 'vitest'
import nodemailer from 'nodemailer'
import { createMailClient } from '../../src/integrations/mail.ts'
import { renderMail } from '../../src/integrations/mail-templates.ts'

/**
 * Mail over SMTP (integrations/mail.ts). nodemailer's jsonTransport builds the
 * complete message without a network, so this checks what would really leave.
 */
const origin = 'https://club.test'
const client = () => createMailClient({
  transport: nodemailer.createTransport({ jsonTransport: true }),
  user: 'noreply@club.test',
  origin,
})
const sentMessage = async (template: string, variables: Record<string, unknown> = {}) => {
  const transport = nodemailer.createTransport({ jsonTransport: true })
  let captured: { message: string } | undefined
  const spy = { ...transport, sendMail: async (m: object) => (captured = await transport.sendMail(m) as unknown as { message: string }) }
  const mail = createMailClient({ transport: spy as never, user: 'noreply@club.test', origin })
  await mail.send({ to: 'anna@test.invalid', template, subjectKey: 'k', variables })
  return JSON.parse(captured!.message) as { from: { address: string }; to: { address: string }[]; subject: string; text: string; messageId: string }
}

describe('mail over SMTP', () => {
  it('sends the email code from SMTP_USER, with the code in subject and body', async () => {
    const m = await sentMessage('onboarding.email-code', { code: '482913', name: 'Anna' })
    expect(m.from.address).toBe('noreply@club.test')
    expect(m.to[0]!.address).toBe('anna@test.invalid')
    expect(m.subject).toContain('482913')
    expect(m.text).toContain('482913')
    expect(m.text).toContain('Hallo Anna')
    expect(m.text).toContain('Hello Anna')
    expect(m.messageId).toMatch(/@german-world-club>$/)
  })

  it('links the password reset to the console on the canonical origin', async () => {
    const m = await sentMessage('auth.password-reset', { token: 'tok en/1' })
    expect(m.text).toContain(`${origin}/konsole/passwort?token=tok%20en%2F1`)
  })

  it('has text for every template the server queues', () => {
    for (const template of ['onboarding.email-code', 'auth.password-reset', 'onboarding.address-in-use', 'onboarding.approved', 'onboarding.denied']) {
      const { subject, text } = renderMail(template, { code: '1', token: 't', name: 'A', reason: 'r' }, { origin })
      expect(subject, template).toBeTruthy()
      expect(text, template).toContain('German World Club')
    }
    expect(renderMail('onboarding.denied', { name: 'A', reason: 'Incomplete' }, { origin }).text).toContain('Incomplete')
  })

  it('refuses rather than sending half a mail', async () => {
    // Counter-assertions: an unknown template and a missing SMTP_HOST both
    // throw, so the outbox keeps the row and records why.
    await expect(client().send({ to: 'a@test.invalid', template: 'no.such.template', subjectKey: 'k' })).rejects.toThrow(/no mail text/)
    await expect(createMailClient().send({ to: 'a@test.invalid', template: 'onboarding.email-code', subjectKey: 'k' }))
      .rejects.toThrow(/SMTP is not configured/)
    expect(createMailClient({ host: 'smtp.test' }).configured).toBe(true)
  })
})

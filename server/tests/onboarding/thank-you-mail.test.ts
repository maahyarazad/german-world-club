import { describe, it, expect } from 'vitest'
import { renderMail } from '../../src/integrations/mail-templates.ts'

describe('onboarding.thank-you mail', () => {
  const mail = renderMail('onboarding.thank-you', { name: 'Anna' }, { origin: 'https://example.test' })

  it('greets by name and promises up to 48 hours, in German and English', () => {
    expect(mail.text).toContain('Hallo Anna,')
    expect(mail.text).toContain('Hello Anna,')
    expect(mail.text).toContain('48 Stunden')
    expect(mail.text).toContain('48 hours')
    expect(mail.subject).toContain('Thank you')
  })

  it('still renders without a name', () => {
    const anonymous = renderMail('onboarding.thank-you', {}, { origin: 'https://example.test' })
    expect(anonymous.text).toContain('Hallo,')
  })
})

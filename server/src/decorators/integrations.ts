import { createPaymentsClient } from '../integrations/payments.ts'
import { createSmsClient } from '../integrations/sms.ts'
import { createMailClient } from '../integrations/mail.ts'
import { createGeocodingClient } from '../integrations/geocoding.ts'
import type { GwcApp } from '../app.ts'

/**
 * Outbound dependencies, each behind its own breaker and its own `undici`
 * dispatcher. Injectable as a whole, so a resilience suite can drive a hung
 * or failing dependency without a network.
 */
export function registerIntegrations(app: GwcApp, { integrations, env } = {}) {
  app.decorate('integrations', integrations ?? {
    payments: createPaymentsClient(),
    sms: createSmsClient({
      apiKey: env.SMSGLOBAL_API_KEY,
      apiSecret: env.SMSGLOBAL_API_SECRET,
      origin: env.SMSGLOBAL_ORIGIN,
    }),
    mail: createMailClient({
      host: env.SMTP_HOST || undefined,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.MAIL_FROM || undefined,
      origin: env.canonicalOrigin,
    }),
    geocoding: createGeocodingClient(),
  })
}

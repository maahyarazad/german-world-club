import { createPaymentsClient } from '../integrations/payments.ts'
import { createSmsClient } from '../integrations/sms.ts'
import { createMailClient } from '../integrations/mail.ts'
import { createGeocodingClient } from '../integrations/geocoding.ts'

/**
 * Outbound dependencies, each behind its own breaker and its own `undici`
 * dispatcher. Injectable as a whole, so a resilience suite can drive a hung
 * or failing dependency without a network.
 */
export function registerIntegrations(app, { integrations, env } = {}) {
  app.decorate('integrations', integrations ?? {
    payments: createPaymentsClient(),
    sms: createSmsClient({
      apiKey: env.SMSGLOBAL_API_KEY,
      apiSecret: env.SMSGLOBAL_API_SECRET,
      origin: env.SMSGLOBAL_ORIGIN,
    }),
    mail: createMailClient(),
    geocoding: createGeocodingClient(),
  })
}

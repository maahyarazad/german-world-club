import { createPushTransport, createLoggingTransport } from '../modules/push/providers.ts'
import type { PushTransport } from '../modules/push/providers.ts'
import type { GwcApp } from '../app.ts'

/**
 * The push transport the `push.deliver` and `push.receipts` jobs send through
 * (feature 011, research R8).
 *
 * A decorator, like `notifyMessage`, so a suite can replace it with a stub and
 * watch exactly what would have been sent. Read by the job handlers at call
 * time, never captured at boot, so that replacement takes effect.
 *
 * Outside production, with no Expo token and no FCM set, it is the logging
 * transport: "would send" lines and deliveries marked `sent`. The same bargain
 * queued mail makes in development, and the reason a test run can never reach
 * a real phone. Production cannot get here without EXPO_ACCESS_TOKEN — env.ts
 * refuses to boot.
 */
export function registerPush(app: GwcApp, { pushTransport }: { pushTransport?: PushTransport } = {}) {
  const env = app.env as Record<string, unknown> & { isProduction: boolean }
  const config = {
    expoAccessToken: env.EXPO_ACCESS_TOKEN as string | undefined,
    fcmProjectId: env.FCM_PROJECT_ID as string | undefined,
    fcmClientEmail: env.FCM_CLIENT_EMAIL as string | undefined,
    fcmPrivateKey: env.FCM_PRIVATE_KEY as string | undefined,
  }
  const hasCredentials = Boolean(config.expoAccessToken || config.fcmProjectId)

  const transport = pushTransport ?? (
    !env.isProduction && !hasCredentials
      ? createLoggingTransport(app.log)
      : createPushTransport({ config, breakers: app.breakers })
  )
  app.decorate('pushTransport', transport)
}

import { closeDispatchers } from '../integrations/http-client.ts'
import type { GwcApp } from '../app.ts'

/** Closes every outbound `undici` dispatcher on server shutdown. */
export function registerShutdownHook(app: GwcApp) {
  app.addHook('onClose', async () => {
    await closeDispatchers()
  })
}

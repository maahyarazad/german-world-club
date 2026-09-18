import { closeDispatchers } from '../integrations/http-client.ts'

/** Closes every outbound `undici` dispatcher on server shutdown. */
export function registerShutdownHook(app) {
  app.addHook('onClose', async () => {
    await closeDispatchers()
  })
}

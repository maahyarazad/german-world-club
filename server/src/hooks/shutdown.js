import { closeDispatchers } from '../integrations/http-client.js'

/** Closes every outbound `undici` dispatcher on server shutdown. */
export function registerShutdownHook(app) {
  app.addHook('onClose', async () => {
    await closeDispatchers()
  })
}

import { createStorage } from '../modules/media/storage.js'
import { createInlineQueue } from '../modules/media/queue.js'

/**
 * Media storage and the video work queue.
 *
 * Both are seams the suites inject through, for the same reason
 * `contentSource` is: derivative and delivery assertions should be about the
 * pipeline and the routes, not about whether an object store is reachable.
 * The inline queue is the default when no PostgreSQL-backed queue is
 * configured, so a single-host install still transcodes.
 */
export function registerMediaDecorators(app, { storage, jobQueue, env } = {}) {
  app.decorate('mediaStorage', storage ?? createStorage(env))
  app.decorate('jobQueue', jobQueue ?? createInlineQueue())
}

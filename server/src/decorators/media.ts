import { createStorage } from '../modules/media/storage.ts'
import { createInlineQueue } from '../modules/media/queue.ts'
import type { GwcApp } from '../app.ts'

/**
 * Media storage and the video work queue.
 *
 * Both are seams the suites inject through, for the same reason
 * `contentSource` is: derivative and delivery assertions should be about the
 * pipeline and the routes, not about whether an object store is reachable.
 * The inline queue is the default when no PostgreSQL-backed queue is
 * configured, so a single-host install still transcodes.
 */
export function registerMediaDecorators(app: GwcApp, { storage, jobQueue, env } = {}) {
  const queue = jobQueue ?? createInlineQueue()
  app.decorate('mediaStorage', storage ?? createStorage(env))
  app.decorate('jobQueue', queue)
  /**
   * The same queue under the name the push outbox uses (feature 011, T018).
   * One instance, exposed once: a second PgBoss would be a second set of
   * connections and a second maintenance loop over the same schema.
   */
  app.decorate('boss', queue)
}

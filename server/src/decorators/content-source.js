import { createDbContentSource } from '../modules/public/content.js'

/** The public-page content resolver — injectable so delivery suites can test rendering without SQL. */
export function registerContentSource(app, { contentSource } = {}) {
  app.decorate('contentSource', contentSource ?? createDbContentSource(app.pg))
}

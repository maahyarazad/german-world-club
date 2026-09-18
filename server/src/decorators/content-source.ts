import { createDbContentSource } from '../modules/public/content.ts'
import type { GwcApp } from '../app.ts'

/** The public-page content resolver — injectable so delivery suites can test rendering without SQL. */
export function registerContentSource(app: GwcApp, { contentSource } = {}) {
  app.decorate('contentSource', contentSource ?? createDbContentSource(app.pg))
}

import { up } from '../src/db/migrate.js'
import { probeDatabase } from './helpers/db.js'

/**
 * Applies migrations to the scratch test database once, before any suite.
 *
 * When no usable database is reachable the run continues and the SQL-backed
 * suites skip themselves (see tests/helpers/db.js). A missing local database
 * must not stop a developer running the pure units, but it must never pass
 * silently either — hence the warning rather than a quiet success.
 */
export default async function globalSetup() {
  const connectionString = process.env.DATABASE_URL ?? 'postgres://localhost:5432/gwc_test'
  if (!(await probeDatabase(connectionString))) {
    console.warn('\n  ⚠  globalSetup: no usable PostgreSQL at DATABASE_URL — migrations not applied.\n')
    return
  }
  await up({ connectionString, log: () => {} })
}

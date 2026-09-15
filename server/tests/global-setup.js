import { up } from '../src/db/migrate.js'

/** Applies migrations to the scratch test database once, before any suite. */
export default async function globalSetup() {
  const connectionString = process.env.DATABASE_URL ?? 'postgres://localhost:5432/gwc_test'
  await up({ connectionString, log: () => {} })
}

import pg from 'pg'

/**
 * Whether a usable PostgreSQL is reachable for this run.
 *
 * A TCP probe is not enough: a server can accept the connection and then refuse
 * the credentials, which is a miss for our purposes. So this opens a real
 * session and closes it.
 *
 * Suites that exercise SQL skip themselves when this is false, so the pure
 * units — the metadata resolver, the budget and posture gates, the structured
 * data documents — still run on a machine with no database. The skip is
 * announced loudly rather than silently: a green run that tested nothing is
 * worse than a red one.
 */
export async function probeDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) return false
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    await client.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    try {
      await client.end()
    } catch {
      // Already unusable; nothing to release.
    }
  }
}

export const hasDatabase = await probeDatabase()

if (!hasDatabase) {
  console.warn(
    '\n  ⚠  No usable PostgreSQL at DATABASE_URL — SQL-backed suites are SKIPPED.\n' +
      '     Set DATABASE_URL in server/.env and re-run to exercise them.\n',
  )
}

/**
 * Empty the fault tables between tests (feature 012).
 *
 * TRUNCATE on purpose: it fires no row triggers, so it bypasses the 30-day
 * delete floor that stops anything else — including an ad-hoc DELETE — from
 * removing a fresh record. This helper is the only place allowed to do that.
 */
export async function resetServerFaults(pool: { query(sql: string): Promise<unknown> }) {
  await pool.query('TRUNCATE server_faults, server_fault_suppressions')
}

/**
 * Empty the referral tables between tests (feature 018).
 *
 * TRUNCATE on purpose, for the same reason as above: referrals, XP entries and
 * rates refuse UPDATE and DELETE by trigger (FR-014), and TRUNCATE fires no row
 * triggers. This and resetAuthTables are the only callers.
 *
 * The rate table is emptied too — a test that set a rate must not leak it into
 * the next — and the migration's initial 100 XP row put back, because every
 * award reads "the rate in force" and there must always be one.
 */
export async function resetReferrals(pool: { query(sql: string): Promise<unknown> }) {
  await pool.query('TRUNCATE xp_entries, referrals, referral_links, referral_xp_rates RESTART IDENTITY CASCADE')
  await pool.query(`INSERT INTO referral_xp_rates (xp, set_by, reason) VALUES (100, NULL, 'initial rate')`)
}

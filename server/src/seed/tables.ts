/**
 * Every table, and whether the demo seed writes to it.
 *
 * "Seed all the tables" is only a checkable claim if there is one list saying
 * what "all" is. `tests/seed/table-manifest.test.js` compares this against the
 * live schema, so a table added later cannot quietly go unseeded — the failure
 * mode this file exists to prevent.
 *
 * Three categories, because two would force a wrong answer for the middle one.
 */

/**
 * Configuration and domain state. Seeded freely — these rows describe what *is*,
 * and inventing them is the whole point of a demo database.
 */
export const SEEDED = Object.freeze([
  'members',
  'admin_users',
  'admin_permissions',
  'organisations',
  'organisation_users',
  'merchant_locations',
  'offers',
  'redemptions',
  'redemption_feedback',
  'events',
  'event_registrations',
  'assets',
  'asset_variants',
  'seo_metadata',
  'legacy_redirects',
  'push_devices',
  'push_campaigns',
  'push_test_recipients',
  'job_definitions',
  'device_approvals',
])

/**
 * History. Seeded, but under one rule.
 *
 * These tables record what happened. Filling them with invented events would
 * make the audit log — the one table nobody may edit — the one table full of
 * fiction, and would leave job runs describing jobs that never ran.
 *
 * **The rule: an entry only where a seeded fact implies one, at that fact's own
 * timestamp.** A member whose status is `locked` gets the entry that locked
 * them, stamped `status_changed_at`. A campaign that exists gets the delivery
 * receipts its recipient count implies. Nothing else.
 */
export const HISTORY = Object.freeze([
  'audit_log',
  'job_runs',
  'push_campaign_recipients',
  'counters',
])

/**
 * Never written. Each of these holds a live credential.
 *
 * A seeded session is a valid credential that nobody authenticated for, and a
 * seeded reset token is a working password-reset link sitting in a table. That
 * is a security hazard rather than a question of taste, which is why it is a
 * list with a test behind it rather than a convention.
 *
 * They fill themselves the moment somebody signs in, which is the only way they
 * should ever fill.
 */
export const NEVER_SEEDED = Object.freeze({
  sessions: 'a live session — created by signing in, never by a seeder',
  refresh_tokens: 'a live credential that outlives the browser session',
  otp_challenges: 'live one-time codes',
  password_reset_tokens: 'live single-use reset links',
})

/** Every table this manifest accounts for. */
export const ALL_TABLES = Object.freeze([
  ...SEEDED,
  ...HISTORY,
  ...Object.keys(NEVER_SEEDED),
])

/** Tables the seed is allowed to write. */
export const WRITABLE = Object.freeze([...SEEDED, ...HISTORY])

export const isWritable = (table) => WRITABLE.includes(table)
export const isForbidden = (table) => Object.hasOwn(NEVER_SEEDED, table)

/**
 * Bookkeeping tables the manifest deliberately ignores.
 *
 * `schema_migrations` is the migration runner's own ledger. Seeding it would
 * tell the runner that migrations had been applied when they had not, which is
 * the worst available lie to tell a migration system.
 */
export const NOT_APPLICATION_DATA = Object.freeze(['schema_migrations'])

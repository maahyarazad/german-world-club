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
  'push_test_recipients',
  'job_definitions',
  'device_approvals',

  // --- Messaging (018) -------------------------------------------------------
  // Content, not credentials. A seeded conversation is a demo inbox that is not
  // empty; nothing here authenticates anybody, so none of it belongs in
  // NEVER_SEEDED.
  'conversations',
  'conversation_participants',
  'messages',

  // --- Marketplace (019) -----------------------------------------------------
  'marketplace_listings',
  'marketplace_vehicle_details',
  'marketplace_property_details',
  'marketplace_job_details',
  'marketplace_general_details',
  'vehicle_features',
  'marketplace_vehicle_features',
  'marketplace_listing_media',
  'marketplace_reports',
  // A record of what a member agreed to, not a credential — so it is seedable.
  // The listing's own terms_version is what pins the version they posted under.
  'marketplace_terms_acceptances',

  // --- Onboarding and threads (009) -----------------------------------------
  'membership_applications',
  'thread_posts',
  'thread_likes',
  'thread_reposts',
  'member_follows',
  'thread_reports',

  // --- Profiles and threads, completed (010) ---------------------------------
  // Content, not credentials. The designation's audit entry follows the
  // history rule (stamped `granted_at`); the row itself is domain state.
  'member_links',
  'member_avatars',
  'member_designations',
  'organisation_profiles',
  'thread_post_media',
  'thread_post_mentions',
  // Not seeded, but writable in principle: no seeded fact implies a block, a
  // mute or where somebody stopped reading Activity, so the demo leaves them
  // empty (data-model §6). They hold no credential, so NEVER_SEEDED is wrong.
  'member_blocks',
  'member_mutes',
  'member_activity_cursor',

  // --- Push notifications (011) ----------------------------------------------
  // Not seeded: no seeded fact implies a member chose anything, and no row
  // means "both on". Holds no credential, so NEVER_SEEDED would be wrong.
  'member_push_preferences',
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
 * them, stamped `status_changed_at`. Nothing else.
 */
export const HISTORY = Object.freeze([
  'audit_log',
  'job_runs',
  'counters',
  // Feature 011: renamed from push_campaigns / push_campaign_recipients. The
  // seed writes neither. A notification is queued work — a seeded one would
  // be *sent* by the next push.deliver tick — and a delivery is a send that
  // happened, which no seeded fact implies (seed/operations.ts).
  'push_notifications',
  'push_deliveries',
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
  // Queued mail carries reset links and email codes until it is delivered.
  mail_outbox: 'queued mail holding live reset links and verification codes',
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

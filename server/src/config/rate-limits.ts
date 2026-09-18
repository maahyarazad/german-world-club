/**
 * Named rate-limit buckets (contracts/resilience.md §3).
 *
 * A table of named buckets, not one global limit: these differ by two orders of
 * magnitude, so any single limit is either too tight for a crawler or too loose
 * for a credential endpoint.
 *
 * `skipOnError` is @fastify/rate-limit's fail-open switch and is set
 * EXPLICITLY on every bucket (FR-044). Permissive where availability outweighs
 * the control; restrictive on every credential path, where an unmeasurable
 * limit is no limit at all.
 *
 * Business quotas are NOT here (FR-043). Invitation quotas, coupon counters,
 * event capacity, and bulk-send pacing live in PostgreSQL under transactions:
 * they are correctness-critical, must survive a Redis flush, must be auditable,
 * and must be reportable to staff. Conflating them is how a member exceeds
 * their invitation quota by racing two requests.
 */

/** @typedef {{ dimension: string, max: number, timeWindow: string, skipOnError: boolean, why: string }} Bucket */

/** @type {Record<string, Bucket>} */
export const BUCKETS = Object.freeze({
  // A 429 to a crawler would directly undermine the partner visibility the club
  // has sold, so this is generous and fails open (FR-041, SC-014).
  'public-read': { dimension: 'ip', max: 300, timeWindow: '1 minute', skipOnError: true, why: 'Public pages, sitemap, robots' },

  // Both directions are required (SC-013). Per-address alone is defeated by a
  // botnet spraying one account; per-account alone lets one address enumerate
  // the member base and is itself an account-lockout weapon.
  'sign-in-ip': { dimension: 'ip', max: 10, timeWindow: '15 minutes', skipOnError: false, why: 'Credential stuffing from one address' },
  'sign-in-account': { dimension: 'account', max: 5, timeWindow: '15 minutes', skipOnError: false, why: 'Credential stuffing against one account' },

  // Keyed on the phone number, not the address: each send costs real money and
  // an address-keyed limit is trivially bypassed.
  'otp-send': { dimension: 'phone', max: 3, timeWindow: '1 hour', skipOnError: false, why: 'SMS costs money per send' },
  'otp-verify': { dimension: 'challenge', max: 5, timeWindow: '10 minutes', skipOnError: false, why: 'A 4-digit code is only 10,000 possibilities' },
  'password-reset': { dimension: 'account', max: 3, timeWindow: '1 hour', skipOnError: false, why: 'Reset-mail flooding' },
  refresh: { dimension: 'session', max: 60, timeWindow: '1 hour', skipOnError: false, why: 'Rotation abuse' },

  'member-api': { dimension: 'account', max: 600, timeWindow: '1 minute', skipOnError: true, why: 'Normal member traffic' },
  'admin-api': { dimension: 'account', max: 1200, timeWindow: '1 minute', skipOnError: true, why: 'Staff console traffic' },
  'write-heavy': { dimension: 'account', max: 60, timeWindow: '1 minute', skipOnError: false, why: 'Member writes and uploads' },
  upload: { dimension: 'account', max: 30, timeWindow: '1 hour', skipOnError: false, why: 'Media ingest is CPU- and storage-expensive' },
})

/** Crawlers that must never be throttled (FR-041). Verified by reverse DNS in production. */
export const CRAWLER_ALLOWLIST = Object.freeze([
  'Googlebot', 'bingbot', 'DuckDuckBot', 'Applebot',
  'facebookexternalhit', 'Twitterbot', 'LinkedInBot', 'Slackbot', 'WhatsApp', 'TelegramBot',
])

/**
 * @throws if any bucket omits `skipOnError`. Called at startup so an
 * inherited default can never decide failure behaviour (FR-044).
 */
export function assertBuckets(buckets = BUCKETS) {
  const problems = []
  for (const [name, b] of Object.entries(buckets)) {
    if (typeof b.skipOnError !== 'boolean') {
      problems.push(`bucket "${name}" does not set skipOnError explicitly`)
    }
    if (typeof b.max !== 'number' || b.max <= 0) problems.push(`bucket "${name}" has an invalid max`)
    if (!b.timeWindow) problems.push(`bucket "${name}" has no timeWindow`)
    if (!b.dimension) problems.push(`bucket "${name}" has no dimension`)
  }
  if (problems.length > 0) {
    throw new Error(`Rate-limit configuration invalid (FR-044):\n${problems.map((p) => `  ${p}`).join('\n')}`)
  }
}

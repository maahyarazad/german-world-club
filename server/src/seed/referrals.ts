import { REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from '@gwc/contracts/referrals'
import type { Pool } from 'pg'
import type { Faker } from './faker.ts'
import type { SeedOptions } from './options.ts'

/**
 * Referral links and XP for the demo population (feature 018, research R18).
 *
 * The consistent-history rule, applied:
 *   - a referral exists only for a seeded member whose mobile is verified —
 *     verification IS the moment a referral is recorded (research R1) — and it
 *     is stamped at that member's own `mobile_verified_at`;
 *   - its referrer's link was created before it, so no referral predates the
 *     link it came through;
 *   - each referral has exactly one award, at the same timestamp, at the rate
 *     the migration wrote (the only rate there has ever been in a fresh demo
 *     database, and the one in force for all of its history);
 *   - no reversals and no disabled links: no seeded fact implies a staff
 *     member found fraud;
 *   - the audit trail gets the two rows a real recording writes, at the same
 *     timestamp, and nothing else.
 *
 * Codes come from the seeded faker, not from crypto: SC-003 (two runs, one
 * database) has to hold for these rows too.
 *
 * Additive and idempotent like every generator here: a database that already
 * has demo-owned links is left alone.
 */

/** How many people refer, per kind. Small: a demo needs a populated Refer & earn, not a growth curve. */
const REFERRERS = { member: 8, merchant: 1, partner: 1, admin: 1 } as const
/** The share of verified demo members who arrived through somebody's link. */
const REFERRED_SHARE = 0.3

export async function seedReferrals(pool: Pool, faker: Faker, _options: SeedOptions) {
  const counts = { referral_links: 0, referrals: 0, xp_entries: 0, audit_log: 0 }

  const { rows: already } = await pool.query(
    `SELECT 1 FROM referral_links l
       LEFT JOIN members m ON m.id = l.owner_id
       LEFT JOIN admin_users a ON a.id = l.owner_id
       LEFT JOIN organisation_users u ON u.id = l.owner_id
      WHERE coalesce(m.email, a.email, u.email)::text LIKE '%demo.invalid'
      LIMIT 1`,
  )
  if (already.length > 0) return counts

  // Referrers: active accounts that can sign in, chosen by email so the choice
  // is the same in every run.
  const referrers: { kind: 'member' | 'merchant' | 'partner' | 'admin'; id: string }[] = []
  const pick = async (kind: keyof typeof REFERRERS, sql: string) => {
    const { rows } = await pool.query(sql, [REFERRERS[kind]])
    for (const row of rows) referrers.push({ kind, id: String(row.id) })
  }
  await pick('member', `SELECT id FROM members WHERE email::text LIKE '%@demo.invalid' AND status = 'active'
                         AND password_hash IS NOT NULL ORDER BY email LIMIT $1`)
  await pick('merchant', `SELECT u.id FROM organisation_users u JOIN organisations o ON o.id = u.organisation_id
                           WHERE o.kind = 'merchant' AND o.status = 'active' AND u.status = 'active'
                             AND u.email::text LIKE '%demo.invalid' ORDER BY u.email LIMIT $1`)
  await pick('partner', `SELECT u.id FROM organisation_users u JOIN organisations o ON o.id = u.organisation_id
                          WHERE o.kind = 'partner' AND o.status = 'active' AND u.status = 'active'
                            AND u.email::text LIKE '%demo.invalid' ORDER BY u.email LIMIT $1`)
  await pick('admin', `SELECT id FROM admin_users WHERE is_active AND email::text LIKE '%demo.invalid' ORDER BY email LIMIT $1`)
  if (referrers.length === 0) return counts

  // Referees: verified demo members who are not themselves referrers.
  const referrerIds = new Set(referrers.map((r) => r.id))
  const { rows: verified } = await pool.query(
    `SELECT id, mobile_verified_at FROM members
      WHERE email::text LIKE '%@demo.invalid' AND mobile_verified_at IS NOT NULL
      ORDER BY email`,
  )
  const assigned = new Map<string, { id: string; at: Date }[]>()
  for (const row of verified) {
    if (referrerIds.has(String(row.id))) continue
    if (!faker.datatype.boolean({ probability: REFERRED_SHARE })) continue
    const referrer = faker.helpers.arrayElement(referrers)
    const key = `${referrer.kind}:${referrer.id}`
    assigned.set(key, [...(assigned.get(key) ?? []), { id: String(row.id), at: new Date(row.mobile_verified_at) }])
  }

  const { rows: [rate] } = await pool.query(
    'SELECT id, xp FROM referral_xp_rates ORDER BY effective_from, id LIMIT 1',
  )

  const code = () =>
    Array.from({ length: REFERRAL_CODE_LENGTH }, () => faker.helpers.arrayElement([...REFERRAL_CODE_ALPHABET])).join('')

  for (const referrer of referrers) {
    const referees = assigned.get(`${referrer.kind}:${referrer.id}`) ?? []
    const earliest = referees.reduce<Date | null>((min, r) => (!min || r.at < min ? r.at : min), null)
    // A day before the first person came through it; a referrer nobody used
    // yet opened Refer & earn some time in the last year.
    const linkCreated = earliest ? new Date(earliest.getTime() - 86_400_000) : faker.date.past({ years: 1 })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows: [link] } = await client.query(
        `INSERT INTO referral_links (owner_kind, owner_id, code, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
        [referrer.kind, referrer.id, code(), linkCreated],
      )
      counts.referral_links++

      for (const referee of referees) {
        const { rows: [referral] } = await client.query(
          `INSERT INTO referrals (link_id, referrer_kind, referrer_id, referee_member_id, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (referee_member_id) DO NOTHING
           RETURNING id`,
          [link.id, referrer.kind, referrer.id, referee.id, referee.at],
        )
        if (!referral) continue
        counts.referrals++
        const { rows: [entry] } = await client.query(
          `INSERT INTO xp_entries (owner_kind, owner_id, kind, amount, referral_id, rate_id, reason, created_at)
           VALUES ($1, $2, 'award', $3, $4, $5, 'referral', $6) RETURNING id`,
          [referrer.kind, referrer.id, rate.xp, referral.id, rate.id, referee.at],
        )
        counts.xp_entries++
        // The two audit rows a real recording writes (attribution.ts), at its own moment.
        await client.query(
          `INSERT INTO audit_log (occurred_at, actor_id, actor_kind, action, target_type, target_id, outcome, detail)
           VALUES ($1, $2, 'member', 'referral_recorded', 'referral', $3, 'allowed', $4),
                  ($1, NULL, NULL, 'xp_awarded', 'xp_entry', $5, 'allowed', $6)`,
          [referee.at, referee.id, referral.id, { linkId: link.id }, entry.id, { xp: rate.xp, referralId: referral.id }],
        )
        counts.audit_log += 2
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  return counts
}

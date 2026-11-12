import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withSeededDatabase } from './helpers.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { SeededDatabase } from './helpers.ts'

/**
 * Feature 018's demo corpus under the consistent-history rule (research R18):
 * a referral only where a verified member implies one, at that verification's
 * own moment, with exactly one award at the rate in force — and nothing that
 * no seeded fact implies.
 */
describe.skipIf(!hasDatabase)('the demo seed: referrals and XP', () => {
  let db: SeededDatabase

  beforeAll(async () => { db = await withSeededDatabase('gwc_seed_referrals') }, 300_000)
  afterAll(async () => { await db?.drop() })

  const one = async (sql: string) => (await db.pool.query(sql)).rows[0]

  it('seeds links, referrals and awards', async () => {
    // Counter-assertion: the history checks below are not passing over empty tables.
    expect((await one('SELECT count(*)::int AS n FROM referrals')).n).toBeGreaterThan(0)
    expect((await one('SELECT count(*)::int AS n FROM referral_links')).n).toBeGreaterThan(1)
  })

  it('gives every referral exactly one award, at the referral\'s moment and the rate in force', async () => {
    const row = await one(`
      SELECT count(*) FILTER (WHERE awards <> 1)::int AS wrong_count,
             count(*) FILTER (WHERE NOT same_time)::int AS wrong_time,
             count(*) FILTER (WHERE NOT same_rate)::int AS wrong_rate
        FROM (
          SELECT r.id,
                 (SELECT count(*) FROM xp_entries e WHERE e.referral_id = r.id AND e.kind = 'award') AS awards,
                 bool_and(e.created_at = r.created_at) AS same_time,
                 bool_and(e.amount = x.xp AND e.rate_id = x.id) AS same_rate
            FROM referrals r
            JOIN xp_entries e ON e.referral_id = r.id
            JOIN referral_xp_rates x ON x.id = e.rate_id
           GROUP BY r.id) s`)
    expect(row).toEqual({ wrong_count: 0, wrong_time: 0, wrong_rate: 0 })
  })

  it('stamps each referral at its referee\'s mobile verification, after the link existed', async () => {
    const row = await one(`
      SELECT count(*) FILTER (WHERE r.created_at <> m.mobile_verified_at)::int AS not_at_verification,
             count(*) FILTER (WHERE r.created_at <= l.created_at)::int AS before_link
        FROM referrals r
        JOIN members m ON m.id = r.referee_member_id
        JOIN referral_links l ON l.id = r.link_id`)
    expect(row).toEqual({ not_at_verification: 0, before_link: 0 })
  })

  it('invents no reversal, no disabled link and no rate change', async () => {
    expect((await one(`SELECT count(*)::int AS n FROM xp_entries WHERE kind = 'reversal'`)).n).toBe(0)
    expect((await one(`SELECT count(*)::int AS n FROM referral_links WHERE state <> 'active'`)).n).toBe(0)
    expect((await one('SELECT count(*)::int AS n FROM referral_xp_rates')).n).toBe(1)
  })

  it('writes the two audit rows a real recording writes, at the referral\'s own moment', async () => {
    const row = await one(`
      SELECT count(*)::int AS referrals,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM audit_log a WHERE a.action = 'referral_recorded' AND a.target_id = r.id AND a.occurred_at = r.created_at
             ))::int AS recorded
        FROM referrals r`)
    expect(row.recorded).toBe(row.referrals)
  })

  it('never refers anybody to themselves', async () => {
    expect((await one(`SELECT count(*)::int AS n FROM referrals WHERE referrer_id = referee_member_id`)).n).toBe(0)
  })
})

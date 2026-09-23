import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withSeededDatabase } from './helpers.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { SeededDatabase } from '../seed/helpers.ts'

/**
 * SC-002 — the population covers every state, and is not uniform.
 *
 * The second half is the one that matters. A suite asserting "there are members"
 * passes against a seed that inserted two hundred identical active rows, which
 * is exactly the demo database that teaches a reviewer nothing.
 */
describe.skipIf(!hasDatabase)('the seeded population spans every state', () => {
  let db: SeededDatabase
  beforeAll(async () => { db = await withSeededDatabase('gwc_seed_coverage') }, 120_000)
  afterAll(async () => { await db?.drop() })

  const demo = "email LIKE '%@demo.invalid'"

  it('covers every member status', async () => {
    const { rows } = await db.pool.query(
      `SELECT status, count(*)::int AS n FROM members WHERE ${demo} GROUP BY status`,
    )
    const present = rows.map((r) => r.status).sort()
    expect(present).toEqual(['active', 'ended', 'inactive', 'locked'])
    // Counter-assertion: the population is NOT uniform. Without this, a seed
    // of 200 identical active members would satisfy "there are members".
    expect(rows.filter((r) => r.status !== 'active').reduce((s, r) => s + r.n, 0)).toBeGreaterThan(0)
  })

  it('covers every credential state', async () => {
    const { rows } = await db.pool.query(`
      SELECT count(*) FILTER (WHERE password_hash ~ '^[0-9a-f]{32}$')      AS legacy,
             count(*) FILTER (WHERE password_hash IS NULL)                  AS none,
             count(*) FILTER (WHERE password_hash LIKE '$argon2%')          AS usable
        FROM members WHERE ${demo}`)
    // A legacy MD5 is treated as already public and forces a reset — the one
    // sign-in outcome that is a 200 carrying no session.
    expect(Number(rows[0].legacy)).toBeGreaterThan(0)
    expect(Number(rows[0].none)).toBeGreaterThan(0)
    expect(Number(rows[0].usable)).toBeGreaterThan(0)
  })

  it('covers every contact state', async () => {
    const { rows } = await db.pool.query(`
      SELECT count(*) FILTER (WHERE email_confirmed_at IS NULL)   AS unconfirmed,
             count(*) FILTER (WHERE mobile IS NULL)                AS no_mobile,
             count(*) FILTER (WHERE mobile_verified_at IS NOT NULL) AS verified,
             count(*) FILTER (WHERE email_suppressed)              AS suppressed,
             count(*) FILTER (WHERE inactivity_exempt)             AS exempt
        FROM members WHERE ${demo}`)
    for (const [field, n] of Object.entries(rows[0])) {
      expect(Number(n), `no members with ${field}`).toBeGreaterThan(0)
    }
  })

  it('suppresses only members that actually bounced', async () => {
    // The states have to agree with each other, or the member screen shows a
    // suppression with no cause.
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS n FROM members WHERE ${demo} AND email_suppressed AND email_bounce_count < 5`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('gives every staff account a different permission matrix', async () => {
    const { rows } = await db.pool.query(`
      SELECT a.email,
             coalesce(string_agg(p.module || ':' || p.can_read || p.can_write || p.can_edit ||
                                 p.can_delete || p.can_status, ',' ORDER BY p.module), '') AS shape,
             a.is_superadmin
        FROM admin_users a
        LEFT JOIN admin_permissions p ON p.admin_user_id = a.id
       WHERE a.email LIKE '%@staff.demo.invalid'
       GROUP BY a.email, a.is_superadmin`)

    expect(rows.length).toBeGreaterThanOrEqual(10)
    const shapes = rows.map((r) => r.shape)
    expect(new Set(shapes).size, 'two staff accounts share a matrix').toBe(shapes.length)
  })

  it('includes a superadmin, a single-module account and an inactive one', async () => {
    const { rows } = await db.pool.query(`
      SELECT count(*) FILTER (WHERE is_superadmin)  AS supers,
             count(*) FILTER (WHERE NOT is_active)  AS inactive
        FROM admin_users WHERE email LIKE '%@staff.demo.invalid'`)
    expect(Number(rows[0].supers)).toBeGreaterThan(0)
    expect(Number(rows[0].inactive)).toBeGreaterThan(0)

    const { rows: single } = await db.pool.query(`
      SELECT admin_user_id FROM admin_permissions GROUP BY admin_user_id HAVING count(*) = 1`)
    expect(single.length).toBeGreaterThan(0)
  })

  it('creates both organisation kinds, with an owner each', async () => {
    const { rows } = await db.pool.query(
      `SELECT kind, count(*)::int AS n FROM organisations GROUP BY kind ORDER BY kind`,
    )
    expect(rows.map((r) => r.kind)).toEqual(['merchant', 'partner'])

    const { rows: ownerless } = await db.pool.query(`
      SELECT o.slug FROM organisations o
       WHERE NOT EXISTS (
         SELECT 1 FROM organisation_users u
          WHERE u.organisation_id = o.id AND u.role = 'owner' AND u.status = 'active')`)
    expect(ownerless.map((r) => r.slug), 'organisations with no active owner').toEqual([])
  })

  it('emits no duplicate email within a namespace', async () => {
    const { rows } = await db.pool.query(
      `SELECT email FROM members GROUP BY email HAVING count(*) > 1`,
    )
    expect(rows).toEqual([])
  })

  // ---- Marketplace (008, SC-009) --------------------------------------------

  it('covers every listing state, and every category in both modes', async () => {
    const { rows: states } = await db.pool.query(
      `SELECT DISTINCT state::text AS s FROM marketplace_listings ORDER BY 1`,
    )
    expect(states.map((r) => r.s)).toEqual(
      ['active', 'draft', 'expired', 'filled', 'hidden', 'sold', 'withdrawn'])

    const { rows: combos } = await db.pool.query(
      `SELECT category::text || '/' || mode::text AS c FROM marketplace_listings
        WHERE state = 'active' GROUP BY 1 ORDER BY 1`,
    )
    expect(combos).toHaveLength(8)

    // Unlimited is a first-class choice (FR-028), so both must be on screen —
    // a corpus where every listing expires would never exercise the null half
    // of the expiry job's predicate.
    const { rows: expiry } = await db.pool.query(`
      SELECT count(*) FILTER (WHERE expires_at IS NULL)     AS unlimited,
             count(*) FILTER (WHERE expires_at IS NOT NULL) AS expiring
        FROM marketplace_listings WHERE state = 'active'`)
    expect(Number(expiry[0].unlimited)).toBeGreaterThan(0)
    expect(Number(expiry[0].expiring)).toBeGreaterThan(0)

    const { rows: inbox } = await db.pool.query(
      `SELECT count(*)::int AS n FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.subject_type = 'marketplace_listing'`,
    )
    expect(inbox[0].n, 'the demo inbox is empty').toBeGreaterThan(0)
  })

  it('gives each moved listing exactly the history that moved it, at its own timestamp', async () => {
    // One entry per sold/filled/withdrawn/hidden listing, stamped with that
    // listing's own state_changed_at and naming the state it reached.
    const { rows: mismatched } = await db.pool.query(`
      SELECT l.id, l.state::text, count(a.id)::int AS entries
        FROM marketplace_listings l
        LEFT JOIN audit_log a
          ON a.target_type = 'marketplace_listing' AND a.target_id = l.id
         AND a.occurred_at = l.state_changed_at
         AND a.detail->>'statusTo' = l.state::text
       WHERE l.state IN ('sold', 'filled', 'withdrawn', 'hidden')
       GROUP BY l.id, l.state
      HAVING count(a.id) <> 1`)
    expect(mismatched, 'moved listings without exactly one matching entry').toEqual([])

    // Counter-assertion: nothing invented. A listing that never moved —
    // draft or active — has no audit history at all, and every expired one
    // sits inside a run of the job that expires listings.
    const { rows: invented } = await db.pool.query(`
      SELECT count(*)::int AS n FROM audit_log a
        JOIN marketplace_listings l ON l.id = a.target_id
       WHERE a.target_type = 'marketplace_listing' AND l.state IN ('draft', 'active')`)
    expect(invented[0].n).toBe(0)

    const { rows: unexplained } = await db.pool.query(`
      SELECT l.id FROM marketplace_listings l
       WHERE l.state = 'expired' AND NOT EXISTS (
         SELECT 1 FROM job_runs r
          WHERE r.job_name = 'marketplace-expiry'
            AND l.state_changed_at BETWEEN r.started_at AND r.finished_at)`)
    expect(unexplained).toEqual([])
  })

  it('attaches only photos the listing owner uploaded, and keeps their quota exact', async () => {
    const { rows: foreign } = await db.pool.query(`
      SELECT lm.listing_id FROM marketplace_listing_media lm
        JOIN marketplace_listings l ON l.id = lm.listing_id
        JOIN assets a ON a.id = lm.asset_id
       WHERE a.uploaded_by IS DISTINCT FROM l.owner_id`)
    expect(foreign).toEqual([])

    const { rows: drifted } = await db.pool.query(`
      SELECT c.subject FROM counters c
       WHERE c.scope = 'media.stored_bytes'
         AND c.used <> (SELECT sum(bytes) FROM assets WHERE uploaded_by::text = c.subject)`)
    expect(drifted, 'stored_bytes counters that disagree with sum(bytes)').toEqual([])
  })
})

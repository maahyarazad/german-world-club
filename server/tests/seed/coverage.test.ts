import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withSeededDatabase } from './helpers.ts'
import { hasDatabase } from '../helpers/db.ts'

/**
 * SC-002 — the population covers every state, and is not uniform.
 *
 * The second half is the one that matters. A suite asserting "there are members"
 * passes against a seed that inserted two hundred identical active rows, which
 * is exactly the demo database that teaches a reviewer nothing.
 */
describe.skipIf(!hasDatabase)('the seeded population spans every state', () => {
  let db
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
})

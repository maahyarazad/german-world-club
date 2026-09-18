import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withSeededDatabase, runSeed } from './helpers.ts'
import { hasDatabase } from '../helpers/db.ts'
import { isNonRoutableEmail, isNonRoutableMobile } from '../../src/seed/faker.ts'
import { NEVER_SEEDED } from '../../src/seed/tables.ts'

/**
 * The safety properties. Each one is here because breaking it would reach
 * somebody outside this repository.
 */

describe('the development gate', () => {
  it.each([['test'], ['production'], ['staging'], ['']])(
    'refuses to run under NODE_ENV=%s',
    async (nodeEnv) => {
      const result = await runSeed({ env: { NODE_ENV: nodeEnv } })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toMatch(/refusing to seed/)
      // It says why. A refusal with no reason is one somebody works around.
      expect(result.stderr).toMatch(/published passwords/)
    },
    60_000,
  )

  it.skipIf(!hasDatabase)('PERMITS development — the gate is not simply closed', async () => {
    // The counter-assertion. Without it, a seed that refused everything would
    // satisfy every test above.
    const db = await withSeededDatabase('gwc_seed_gate')
    try {
      expect(db.stdout).toMatch(/seed:demo/)
      const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM members`)
      expect(rows[0].n).toBeGreaterThan(0)
    } finally {
      await db.drop()
    }
  }, 120_000)
})

describe.skipIf(!hasDatabase)('nothing seeded can reach a real person', () => {
  let db
  beforeAll(async () => { db = await withSeededDatabase('gwc_seed_safety') }, 120_000)
  afterAll(async () => { await db?.drop() })

  it('gives every generated address a .invalid domain', async () => {
    // RFC 2606 reserves it: it can never resolve, in any DNS, ever. Faker's own
    // internet.email() returns live domains — hotmail.com was the first thing
    // it produced — so this is checked rather than trusted.
    for (const table of ['members', 'admin_users', 'organisation_users']) {
      const { rows } = await db.pool.query(`SELECT email FROM ${table}`)
      const routable = rows.map((r) => r.email).filter((e) => !isNonRoutableEmail(e))
      expect(routable, `${table} has routable addresses`).toEqual([])
    }
  })

  it('gives every mobile a number that cannot ring', async () => {
    const { rows } = await db.pool.query(`SELECT mobile FROM members WHERE mobile IS NOT NULL`)
    expect(rows.length).toBeGreaterThan(0)
    const dialable = rows.map((r) => r.mobile).filter((m) => !isNonRoutableMobile(m))
    expect(dialable).toEqual([])
  })

  it('STILL CATCHES a routable value — the checks are not vacuous', () => {
    expect(isNonRoutableEmail('somebody@gmail.com')).toBe(false)
    expect(isNonRoutableEmail('Luiz60@hotmail.com')).toBe(false)
    expect(isNonRoutableMobile('+4915112345678')).toBe(false)
    expect(isNonRoutableMobile('07700900123')).toBe(false)
  })
})

describe.skipIf(!hasDatabase)('no live credential is ever seeded', () => {
  let db
  beforeAll(async () => { db = await withSeededDatabase('gwc_seed_nocreds') }, 120_000)
  afterAll(async () => { await db?.drop() })

  it.each(Object.keys(NEVER_SEEDED))('%s is empty after a seed', async (table) => {
    // A seeded session is a valid credential nobody authenticated for, and a
    // seeded reset token is a working password-reset link sitting in a table.
    // These fill themselves on sign-in, which is the only way they should.
    const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM ${table}`)
    expect(rows[0].n).toBe(0)
  })

  it('BUT the seed did write elsewhere — the comparison is not of an empty database', async () => {
    const { rows } = await db.pool.query(`
      SELECT (SELECT count(*)::int FROM members) AS members,
             (SELECT count(*)::int FROM offers)  AS offers,
             (SELECT count(*)::int FROM events)  AS events`)
    expect(rows[0].members).toBeGreaterThan(0)
    expect(rows[0].offers).toBeGreaterThan(0)
    expect(rows[0].events).toBeGreaterThan(0)
  })
})

describe.skipIf(!hasDatabase)('history agrees with the state it describes', () => {
  let db
  beforeAll(async () => { db = await withSeededDatabase('gwc_seed_history') }, 120_000)
  afterAll(async () => { await db?.drop() })

  it('writes an audit entry only where a member state implies one', async () => {
    const { rows } = await db.pool.query(`
      SELECT count(*)::int AS entries FROM audit_log WHERE target_type = 'member'`)
    const { rows: nonActive } = await db.pool.query(`
      SELECT count(*)::int AS n FROM members WHERE email LIKE '%@demo.invalid' AND status <> 'active'`)

    // One entry per member whose status is not active. Not one more: invented
    // history in the one table nobody may edit would be the worst use of it.
    expect(rows[0].entries).toBe(nonActive[0].n)
  })

  it('stamps each entry with the fact it describes, not with "now"', async () => {
    const { rows } = await db.pool.query(`
      SELECT count(*)::int AS n
        FROM audit_log a JOIN members m ON m.id = a.target_id
       WHERE a.target_type = 'member' AND a.occurred_at <> m.status_changed_at`)
    expect(rows[0].n).toBe(0)
  })

  it('records a job run only for a job that exists', async () => {
    const { rows } = await db.pool.query(`
      SELECT count(*)::int AS n FROM job_runs r
       WHERE NOT EXISTS (SELECT 1 FROM job_definitions d WHERE d.name = r.job_name)`)
    expect(rows[0].n).toBe(0)
  })

  it('sets each stored-bytes counter to the bytes actually stored', async () => {
    /**
     * A counter is the number a quota check trusts, so "roughly right" is the
     * one thing it must not be. Compared against `sum(bytes)` computed here
     * rather than against a constant, so this fails if either side drifts.
     */
    const { rows } = await db.pool.query(`
      SELECT c.subject, c.used::bigint AS used, sum(a.bytes)::bigint AS actual
        FROM counters c
        JOIN assets a ON a.uploaded_by::text = c.subject
       WHERE c.scope = 'media.stored_bytes'
       GROUP BY c.subject, c.used`)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.used, row.subject).toBe(row.actual)
  })

  it('writes a counter for every uploader and for nobody else', async () => {
    // The other half: a counter for a member who uploaded nothing is invented
    // history, and a missing one understates a real member's usage.
    const { rows } = await db.pool.query(`
      SELECT (SELECT count(DISTINCT uploaded_by)::int FROM assets WHERE uploaded_by IS NOT NULL) AS uploaders,
             (SELECT count(*)::int FROM counters WHERE scope = 'media.stored_bytes') AS counters`)
    expect(rows[0].counters).toBe(rows[0].uploaders)
    expect(rows[0].uploaders).toBeGreaterThan(0)
  })

  it('leaves limit_value unset, so raising the configured quota is not refused', async () => {
    // The ceiling is configuration, applied by reserve() on first use. A baked
    // row would freeze today's value AND make counters_within_limit refuse
    // uploads after the quota was raised.
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS n FROM counters WHERE scope = 'media.stored_bytes' AND limit_value IS NOT NULL`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('matches campaign receipts to the campaign totals', async () => {
    const { rows } = await db.pool.query(`
      SELECT c.id FROM push_campaigns c
        JOIN push_campaign_recipients r ON r.campaign_id = c.id
       GROUP BY c.id, c.total_success
      HAVING count(*) FILTER (WHERE r.status = 'delivered') > c.total_success`)
    expect(rows.map((r) => r.id), 'more deliveries than the campaign claims').toEqual([])
  })
})

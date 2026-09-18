import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withSeededDatabase } from './helpers.ts'
import { hasDatabase } from '../helpers/db.ts'

/**
 * SC-011 … SC-013 — offers and events, and the constraints behind them.
 *
 * Each constraint is tested by *violating* it. Asserting that the seeded rows
 * satisfy a rule proves the generator is careful; asserting that the database
 * refuses a row that breaks it proves the rule is enforced where it has to be —
 * which is the difference Principle IV is about.
 */
describe.skipIf(!hasDatabase)('offers span their lifecycle', () => {
  let db
  beforeAll(async () => { db = await withSeededDatabase('gwc_seed_content') }, 120_000)
  afterAll(async () => { await db?.drop() })

  it('covers draft, published and expired', async () => {
    const { rows } = await db.pool.query(
      `SELECT state, count(*)::int AS n FROM offers GROUP BY state ORDER BY state`,
    )
    const states = rows.map((r) => r.state)
    expect(states).toContain('draft')
    expect(states).toContain('published')

    const { rows: expired } = await db.pool.query(
      `SELECT count(*)::int AS n FROM offers WHERE state = 'published' AND valid_until < now()`,
    )
    expect(expired[0].n, 'no expired offer to look at').toBeGreaterThan(0)
  })

  it('includes an offer belonging to a suspended organisation', async () => {
    const { rows } = await db.pool.query(`
      SELECT count(*)::int AS n FROM offers o
        JOIN organisations org ON org.id = o.organisation_id
       WHERE org.status = 'suspended'`)
    expect(rows[0].n).toBeGreaterThan(0)
  })

  it('makes a published offer invisible when its organisation is suspended', async () => {
    // Visibility depends on more than the offer's own state — §5's
    // lapsed-contract rule, and the reason the suspended merchant exists.
    const { rows } = await db.pool.query(`
      SELECT count(*)::int AS n FROM offers o
        JOIN organisations org ON org.id = o.organisation_id
       WHERE o.state = 'published'
         AND o.valid_from <= now() AND o.valid_until > now()
         AND org.status = 'active'`)
    const visible = rows[0].n

    const { rows: naive } = await db.pool.query(`
      SELECT count(*)::int AS n FROM offers
       WHERE state = 'published' AND valid_from <= now() AND valid_until > now()`)

    // The naive count — offer state alone — is larger. If they were equal, the
    // suspended organisation's offers would be showing.
    expect(naive[0].n).toBeGreaterThan(visible)
  })

  it('never seeds an offer without a real advantage', async () => {
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS n FROM offers
        WHERE regular_price_cents IS NOT NULL AND member_price_cents IS NOT NULL
          AND member_price_cents >= regular_price_cents`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('AND the database refuses one that has no advantage', async () => {
    // The design document's merchant rule 1 — "echter Vorteil, nicht
    // Normalpreis als Rabatt" — as a constraint rather than a convention a
    // form could forget.
    const { rows: org } = await db.pool.query(`SELECT id FROM organisations WHERE kind='merchant' LIMIT 1`)
    await expect(db.pool.query(
      `INSERT INTO offers (organisation_id, title, regular_price_cents, member_price_cents,
                           benefit_kind, valid_from, valid_until, state)
       VALUES ($1, 'Kein Vorteil', 1000, 1000, 'percentage', now(), now() + interval '1 day', 'draft')`,
      [org[0].id],
    )).rejects.toThrow(/offers_real_advantage/)
  })

  it('refuses a location attached to a partner rather than a merchant', async () => {
    // The composite foreign key onto (id, kind) makes it unrepresentable, not
    // merely discouraged.
    const { rows: partner } = await db.pool.query(`SELECT id FROM organisations WHERE kind='partner' LIMIT 1`)
    await expect(db.pool.query(
      `INSERT INTO merchant_locations (organisation_id, label) VALUES ($1, 'Falsch')`,
      [partner[0].id],
    )).rejects.toThrow()
  })

  it('has redemptions with feedback behind them', async () => {
    const { rows } = await db.pool.query(`
      SELECT (SELECT count(*)::int FROM redemptions)          AS redemptions,
             (SELECT count(*)::int FROM redemption_feedback)  AS feedback`)
    expect(rows[0].redemptions).toBeGreaterThan(0)
    expect(rows[0].feedback).toBeGreaterThan(0)
    // Not every redemption gets feedback — a rate of exactly 100% would make
    // the analytics screen compute a constant.
    expect(rows[0].feedback).toBeLessThan(rows[0].redemptions)
  })

  it('redeems only published offers', async () => {
    const { rows } = await db.pool.query(`
      SELECT count(*)::int AS n FROM redemptions r
        JOIN offers o ON o.id = r.offer_id
       WHERE o.state <> 'published'`)
    // A draft nobody could see cannot have been used. Seeding one would be
    // inventing history.
    expect(rows[0].n).toBe(0)
  })
})

describe.skipIf(!hasDatabase)('events span their state machine', () => {
  let db
  beforeAll(async () => { db = await withSeededDatabase('gwc_seed_events') }, 120_000)
  afterAll(async () => { await db?.drop() })

  it('covers all four states', async () => {
    const { rows } = await db.pool.query(
      `SELECT state, count(*)::int AS n FROM events GROUP BY state ORDER BY state`,
    )
    expect(rows.map((r) => r.state).sort()).toEqual(['closed', 'not_opened', 'open', 'review'])
  })

  it('includes an event at capacity', async () => {
    const { rows } = await db.pool.query(`
      SELECT e.slug, e.capacity,
             coalesce(sum(1 + r.guest_count + r.kids_free + r.kids_charged), 0)::int AS taken
        FROM events e LEFT JOIN event_registrations r ON r.event_id = e.id
       GROUP BY e.id, e.slug, e.capacity`)
    const full = rows.filter((r) => r.taken >= r.capacity)
    expect(full.length, 'no event is full — the full path is invisible').toBeGreaterThan(0)
  })

  it('never oversells', async () => {
    const { rows } = await db.pool.query(`
      SELECT e.slug FROM events e
        JOIN event_registrations r ON r.event_id = e.id
       GROUP BY e.id, e.slug, e.capacity
      HAVING sum(1 + r.guest_count + r.kids_free + r.kids_charged) > e.capacity`)
    expect(rows.map((r) => r.slug)).toEqual([])
  })

  it('AND the database refuses a registration past capacity', async () => {
    const { rows: full } = await db.pool.query(`
      SELECT e.id, e.capacity,
             coalesce(sum(1 + r.guest_count + r.kids_free + r.kids_charged), 0)::int AS taken
        FROM events e LEFT JOIN event_registrations r ON r.event_id = e.id
       GROUP BY e.id, e.capacity
      HAVING coalesce(sum(1 + r.guest_count + r.kids_free + r.kids_charged), 0) >= e.capacity
       LIMIT 1`)

    const { rows: spare } = await db.pool.query(`
      SELECT id FROM members
       WHERE id NOT IN (SELECT member_id FROM event_registrations WHERE event_id = $1)
       LIMIT 1`, [full[0].id])

    // §4 requires capacity enforced across every registration source. A check
    // in one writer is a race condition with extra steps.
    await expect(db.pool.query(
      `INSERT INTO event_registrations (event_id, member_id) VALUES ($1, $2)`,
      [full[0].id, spare[0].id],
    )).rejects.toThrow(/is full/)
  })

  it('registers no member twice for the same event', async () => {
    const { rows } = await db.pool.query(
      `SELECT event_id, member_id FROM event_registrations GROUP BY 1, 2 HAVING count(*) > 1`,
    )
    expect(rows).toEqual([])
  })

  it('AND the database refuses a duplicate registration', async () => {
    const { rows: existing } = await db.pool.query(
      `SELECT event_id, member_id FROM event_registrations LIMIT 1`,
    )
    await expect(db.pool.query(
      `INSERT INTO event_registrations (event_id, member_id) VALUES ($1, $2)`,
      [existing[0].event_id, existing[0].member_id],
    )).rejects.toThrow()
  })

  it('publishes a recap only for events that have happened', async () => {
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS n FROM events WHERE recap_published_at IS NOT NULL AND recap_published_at < starts_at`,
    )
    expect(rows[0].n).toBe(0)
  })
})

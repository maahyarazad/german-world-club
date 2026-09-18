import type { Pool } from 'pg'
/**
 * Club events across their state machine, with registrations
 * (BUSINESS_DESCRIPTION.md §4).
 *
 * §4's state machine is Not opened → Open → Closed → Review, and all four are
 * seeded: a list showing only open events proves nothing about how the other
 * three render. One event is deliberately filled to capacity, because the full
 * path is the one nobody builds a fixture for.
 */

const STATES = [
  { state: 'not_opened', share: 2, when: 'future', fill: 0 },
  { state: 'open', share: 4, when: 'soon', fill: 0.4 },
  { state: 'open', share: 1, when: 'soon', fill: 1 },      // the full one
  { state: 'closed', share: 2, when: 'soon', fill: 0.9 },
  { state: 'review', share: 3, when: 'past', fill: 0.8 },
]

export async function seedEvents(pool: Pool, faker, options) {
  /**
   * Already seeded? Then stop.
   *
   * These rows have no natural key the seeder controls — two offers from
   * one merchant may legitimately share a title — so ON CONFLICT has
   * nothing to catch. Inventing a unique constraint so that it would is
   * bending the schema to suit the seeder, which is the thing this feature
   * set out not to do. Idempotency (FR-019) is the seeder's problem, so it
   * is solved here: a database that already holds demo rows is left alone.
   */
  const { rows: seeded } = await pool.query('SELECT count(*)::int AS n FROM events')
  if (seeded[0].n > 0) return { events: 0, event_registrations: 0 }
  const { rows: members } = await pool.query(
    `SELECT id FROM members WHERE email LIKE '%@demo.invalid' AND status = 'active' ORDER BY email`,
  )

  const totalShare = STATES.reduce((sum, s) => sum + s.share, 0)
  const plan = STATES.flatMap((slice) =>
    Array.from({ length: Math.max(1, Math.round((slice.share / totalShare) * options.events)) }, () => slice))

  let events = 0
  let registrations = 0

  for (const [index, slice] of plan.entries()) {
    const startsAt =
      slice.when === 'past' ? faker.date.past({ years: 1 })
        : slice.when === 'soon' ? faker.date.soon({ days: 60 })
          : faker.date.future({ years: 1 })

    // Small enough that "full" is reachable without inserting hundreds of rows,
    // and varied enough that the number is not obviously synthetic.
    const capacity = faker.number.int({ min: 12, max: 60 })
    const city = faker.location.city()
    const title = `${faker.helpers.arrayElement(['Business Dinner', 'Stammtisch', 'Sommerfest', 'Neujahrsempfang', 'Kamingespräch', 'Netzwerkabend'])} ${city}`
    const slug = `${faker.helpers.slugify(title).toLowerCase()}-${index}`

    const opens = new Date(startsAt.getTime() - 60 * 86_400_000)
    const early = new Date(startsAt.getTime() - 40 * 86_400_000)
    const standard = new Date(startsAt.getTime() - 14 * 86_400_000)
    const closes = new Date(startsAt.getTime() - 86_400_000)

    const { rows } = await pool.query(
      `INSERT INTO events (slug, title, description, venue, city, latitude, longitude,
                           starts_at, ends_at, capacity,
                           early_until, standard_until, registration_opens, registration_closes,
                           price_early_cents, price_standard_cents, price_late_cents,
                           kids_price_cents, max_kids, currency, state, recap_published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19, 'EUR', $20::event_state, $21)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, capacity`,
      [
        slug, title, faker.lorem.paragraph(), faker.company.name(), city,
        faker.location.latitude(), faker.location.longitude(),
        startsAt, new Date(startsAt.getTime() + 4 * 3_600_000), capacity,
        early, standard, opens, closes,
        4500, 6500, 8500, 2000, 4,
        slice.state,
        // A recap only after the event has happened — the constraint refuses
        // anything else, which is §4's rule rather than this seeder's.
        slice.state === 'review' ? new Date(startsAt.getTime() + 3 * 86_400_000) : null,
      ],
    )
    if (rows.length === 0) continue
    events += 1

    if (slice.fill === 0 || members.length === 0) continue

    // Fill to the requested fraction. Each registration takes 1 seat plus its
    // guests, and the capacity trigger is what stops an overshoot — so the
    // counting here mirrors the trigger rather than assuming it is absent.
    const target = Math.floor(rows[0].capacity * slice.fill)
    let taken = 0
    const pool_ = faker.helpers.shuffle([...members])

    for (const member of pool_) {
      if (taken >= target) break
      const guests = taken + 2 <= target ? faker.number.int({ min: 0, max: 1 }) : 0
      const seats = 1 + guests
      if (taken + seats > rows[0].capacity) break

      const { rowCount } = await pool.query(
        `INSERT INTO event_registrations (event_id, member_id, guest_count, kids_free, kids_charged,
                                          payment_method, paid, amount_cents, registered_at)
         VALUES ($1, $2, $3, 0, 0, $4::registration_payment, $5, $6, $7)
         ON CONFLICT (event_id, member_id) DO NOTHING`,
        [
          rows[0].id, member.id, guests,
          faker.helpers.arrayElement(['online', 'online', 'door', 'invoice']),
          faker.datatype.boolean({ probability: 0.8 }),
          6500 * seats,
          faker.date.recent({ days: 30 }),
        ],
      )
      if (rowCount === 0) continue
      registrations += 1
      taken += seats
    }
  }

  return { events, event_registrations: registrations }
}

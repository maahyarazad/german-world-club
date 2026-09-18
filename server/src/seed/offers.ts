import type { Pool } from 'pg'
import type { Faker } from './faker.ts'
import type { SeedOptions } from './options.ts'
/**
 * Merchant locations, offers across their whole lifecycle, and the redemptions
 * and feedback behind the analytics screens (BUSINESS_DESCRIPTION.md §5).
 *
 * The spread is the point. A merchant portal listing six identical published
 * offers demonstrates nothing about the merchant portal; one showing a draft, a
 * live offer, an expired one and one belonging to a suspended organisation
 * shows how visibility actually works.
 */

/** Chosen so the price constraint holds by construction, never by retrying. */
function pricePair(faker) {
  const regular = faker.number.int({ min: 1500, max: 40000 })
  // A real advantage, 10–40% off — the design document's merchant rule 1
  // ("echter Vorteil, nicht Normalpreis als Rabatt") is a database constraint,
  // and generating a violation and catching the error would be building against
  // it rather than with it.
  const discount = faker.number.float({ min: 0.1, max: 0.4 })
  return { regular, member: Math.round(regular * (1 - discount)), discount }
}

const LIFECYCLE = [
  { state: 'draft', share: 2, window: 'future' },
  { state: 'pending', share: 1, window: 'future' },
  { state: 'published', share: 5, window: 'current' },
  { state: 'published', share: 2, window: 'past' },   // expired but still published
  { state: 'rejected', share: 1, window: 'current' },
  { state: 'withdrawn', share: 1, window: 'past' },
]

export async function seedOffers(pool: Pool, faker: Faker, options: SeedOptions) {
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
  const { rows: seeded } = await pool.query('SELECT count(*)::int AS n FROM offers')
  if (seeded[0].n > 0) return { merchant_locations: 0, offers: 0, redemptions: 0, redemption_feedback: 0 }
  const { rows: merchants } = await pool.query(
    `SELECT id, slug, status FROM organisations WHERE kind = 'merchant' ORDER BY slug`,
  )
  if (merchants.length === 0) return { merchant_locations: 0, offers: 0, redemptions: 0, redemption_feedback: 0 }

  const { rows: members } = await pool.query(
    `SELECT id FROM members WHERE email LIKE '%@demo.invalid' AND status = 'active' ORDER BY email LIMIT 60`,
  )

  let locations = 0
  let offers = 0
  let redemptions = 0
  let feedback = 0

  for (const merchant of merchants) {
    const branchCount = faker.number.int({ min: 1, max: 3 })
    for (let i = 0; i < branchCount; i += 1) {
      const { rowCount } = await pool.query(
        `INSERT INTO merchant_locations (organisation_id, label, street, postal_code, city, country,
                                         latitude, longitude, opening_hours)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          merchant.id, `${faker.location.city()} ${i + 1}`,
          faker.location.streetAddress(), faker.location.zipCode(), faker.location.city(),
          faker.helpers.arrayElement(['DE', 'AT', 'CH', 'AE']),
          faker.location.latitude(), faker.location.longitude(),
          'Mo-Fr 09:00-18:00',
        ],
      )
      locations += rowCount
    }
  }

  // Expand the lifecycle shares across the requested offer count.
  const totalShare = LIFECYCLE.reduce((sum, l) => sum + l.share, 0)
  const plan = LIFECYCLE.flatMap((slice) =>
    Array.from({ length: Math.max(1, Math.round((slice.share / totalShare) * options.offers)) }, () => slice))

  for (const [index, slice] of plan.entries()) {
    const merchant = merchants[index % merchants.length]
    const { regular, member, discount } = pricePair(faker)

    const validFrom =
      slice.window === 'past' ? faker.date.past({ years: 1 })
        : slice.window === 'future' ? faker.date.soon({ days: 20 })
          : faker.date.recent({ days: 60 })
    const validUntil = new Date(validFrom.getTime() + faker.number.int({ min: 30, max: 180 }) * 86_400_000)
    // A past window must actually be past, whatever duration was drawn.
    if (slice.window === 'past') validUntil.setTime(Math.min(validUntil.getTime(), Date.now() - 86_400_000))

    const title = `${faker.commerce.productName()} — ${Math.round(discount * 100)}% für GWC`

    const { rows } = await pool.query(
      `INSERT INTO offers (organisation_id, title, description, regular_price_cents,
                           member_price_cents, currency, benefit_kind, benefit_value,
                           valid_from, valid_until, conditions, state, published_at, remaining)
       VALUES ($1, $2, $3, $4, $5, $6, 'percentage'::benefit_kind, $7, $8, $9, $10,
               $11::offer_state, $12, $13)
       ON CONFLICT DO NOTHING
       RETURNING id, state`,
      [
        merchant.id, title, faker.commerce.productDescription(),
        regular, member, faker.helpers.arrayElement(['EUR', 'EUR', 'CHF', 'AED']),
        Math.round(discount * 100),
        validFrom, validUntil,
        'Nur für GWC-Mitglieder. Nicht mit anderen Aktionen kombinierbar.',
        slice.state,
        slice.state === 'published' ? validFrom : null,
        faker.number.int({ min: 5, max: 200 }),
      ],
    )
    if (rows.length === 0) continue
    offers += 1

    // Redemptions only against published offers — a draft nobody could see
    // cannot have been used, and seeding one would be inventing history.
    if (rows[0].state !== 'published' || members.length === 0) continue

    const count = faker.number.int({ min: 0, max: 6 })
    for (let i = 0; i < count; i += 1) {
      const memberRow = faker.helpers.arrayElement(members)
      const reference = `GWC-${String(index).padStart(4, '0')}-${String(i).padStart(2, '0')}`
      const { rows: redeemed } = await pool.query(
        `INSERT INTO redemptions (offer_id, member_id, redeemed_at, reference, estimated_saving_cents)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (reference) DO NOTHING
         RETURNING id`,
        [rows[0].id, memberRow.id, faker.date.recent({ days: 45 }), reference, regular - member],
      )
      if (redeemed.length === 0) continue
      redemptions += 1

      // Feedback on roughly two thirds, so the analytics compute a rate rather
      // than a constant.
      if (!faker.datatype.boolean({ probability: 0.66 })) continue
      const { rowCount } = await pool.query(
        `INSERT INTO redemption_feedback (redemption_id, benefit_real, price_correct, quality_rating, comment)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (redemption_id) DO NOTHING`,
        [
          redeemed[0].id,
          faker.datatype.boolean({ probability: 0.92 }),
          faker.datatype.boolean({ probability: 0.96 }),
          faker.number.int({ min: 3, max: 5 }),
          faker.datatype.boolean({ probability: 0.3 }) ? faker.lorem.sentence() : null,
        ],
      )
      feedback += rowCount
    }
  }

  return { merchant_locations: locations, offers, redemptions, redemption_feedback: feedback }
}

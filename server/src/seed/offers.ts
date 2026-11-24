import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
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

/**
 * Every offer insert runs in one transaction that first sets
 * `gwc.suppress_offer_push` (feature 011, research R12).
 *
 * The seed inserts offers that are already `published`, and publishing an
 * offer queues a push notification by trigger (029_offer_push_trigger.sql).
 * A seeded offer was never *announced* — nobody's phone buzzed for it — so
 * queuing one would be inventing history, which the consistent-history rule
 * forbids, and on a development database with real devices it would actually
 * send. `SET LOCAL` ends with the transaction, so nothing outside the seed can
 * inherit the switch. `tests/seed/safety.test.ts` asserts zero offer
 * notifications after a run.
 */
export async function seedOffers(pool: Pool, faker: Faker, options: SeedOptions) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL gwc.suppress_offer_push = 'on'`)
    const counts = await seedOffersIn(client, faker, options)
    await client.query('COMMIT')
    return counts
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function seedOffersIn(pool: PoolClient, faker: Faker, options: SeedOptions) {
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
  if (seeded[0].n > 0) return { stores: 0, merchant_locations: 0, offers: 0, redemptions: 0, redemption_feedback: 0 }
  const { rows: merchants } = await pool.query(
    `SELECT id, slug, status FROM organisations WHERE kind = 'merchant' ORDER BY slug`,
  )
  if (merchants.length === 0) return { stores: 0, merchant_locations: 0, offers: 0, redemptions: 0, redemption_feedback: 0 }

  const { rows: members } = await pool.query(
    `SELECT id FROM members WHERE email LIKE '%@demo.invalid' AND status = 'active' ORDER BY email LIMIT 60`,
  )

  let locations = 0
  let stores = 0
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

  // One store per merchant (feature 035). A suspended merchant keeps an ACTIVE
  // store row on purpose: the organisation's own status is what hides it, and
  // that is a different reason from staff switching a store off. One store is
  // switched off by staff, with the reason that implies, so the browse and the
  // admin list have both states to show.
  const storeIds = new Map<string, string>()
  for (const [i, merchant] of merchants.entries()) {
    const deactivated = merchant.status === 'active' && i === merchants.length - 1 && merchants.length > 2
    const { rows } = await pool.query(
      `INSERT INTO stores (organisation_id, description, opening_hours, active,
                           deactivated_at, deactivation_reason)
       VALUES ($1, $2, 'Mo-Fr 09:00-18:00', $3, $4, $5)
       ON CONFLICT (organisation_id) DO NOTHING
       RETURNING id`,
      [
        merchant.id, faker.commerce.productDescription(), !deactivated,
        deactivated ? new Date(Date.now() - 3 * 86_400_000) : null,
        deactivated ? 'Demo: switched off by staff' : null,
      ],
    )
    if (rows.length === 0) continue
    stores += 1
    storeIds.set(String(merchant.id), String(rows[0].id))
  }
  const { rows: categories } = await pool.query(
    `SELECT id FROM offer_categories WHERE visible ORDER BY position, slug`,
  )

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

    // Redemptions are drawn BEFORE the offer is inserted so `remaining` can be
    // what the seeded facts imply: the units the offer had, minus the ones
    // redeemed. A random `remaining` next to a handful of redemptions would be
    // a counter that disagrees with the rows it counts (the history rule).
    const published = slice.state === 'published'
    const total = faker.number.int({ min: 8, max: 200 })
    const redeemers = published && members.length > 0
      ? faker.helpers.arrayElements(members, faker.number.int({ min: 0, max: Math.min(6, members.length) }))
      : []

    const { rows } = await pool.query(
      `INSERT INTO offers (organisation_id, store_id, category_id, title, description,
                           regular_price_cents, member_price_cents, currency, benefit_kind,
                           benefit_value, valid_from, valid_until, conditions, state,
                           published_at, remaining, sort_position)
       VALUES ($1, $14, $15, $2, $3, $4, $5, $6, 'percentage'::benefit_kind, $7, $8, $9, $10,
               $11::offer_state, $12, $13, $16)
       ON CONFLICT DO NOTHING
       RETURNING id, state, category_id`,
      [
        merchant.id, title, faker.commerce.productDescription(),
        regular, member, faker.helpers.arrayElement(['EUR', 'EUR', 'CHF', 'AED']),
        Math.round(discount * 100),
        validFrom, validUntil,
        'Nur für GWC-Mitglieder. Nicht mit anderen Aktionen kombinierbar.',
        slice.state,
        slice.state === 'published' ? validFrom : null,
        total - redeemers.length,
        storeIds.get(String(merchant.id)) ?? (await storeIdFor(pool, merchant.id)),
        categories[index % categories.length].id,
        index,
      ],
    )
    if (rows.length === 0) continue
    offers += 1

    // Redemptions only against published offers — a draft nobody could see
    // cannot have been used, and seeding one would be inventing history.
    if (rows[0].state !== 'published' || members.length === 0) continue

    for (const [i, memberRow] of redeemers.entries()) {
      const reference = `GWC-${String(index).padStart(4, '0')}-${String(i).padStart(2, '0')}`
      const { rows: redeemed } = await pool.query(
        `INSERT INTO redemptions (offer_id, redeemer_kind, redeemer_id, request_id, organisation_id,
                                  category_id, redeemed_at, reference, estimated_saving_cents)
         VALUES ($1, 'member', $2, gen_random_uuid(), $3, $4, $5, $6, $7)
         ON CONFLICT (reference) DO NOTHING
         RETURNING id`,
        [rows[0].id, memberRow.id, merchant.id, rows[0].category_id, faker.date.recent({ days: 45 }), reference, regular - member],
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

  return { stores, merchant_locations: locations, offers, redemptions, redemption_feedback: feedback }
}

/** A store inserted by the migration's backfill rather than by this run. */
async function storeIdFor(pool: PoolClient, organisationId: unknown) {
  const { rows } = await pool.query('SELECT id FROM stores WHERE organisation_id = $1', [organisationId])
  return String(rows[0].id)
}


// A wide cover (16:9) and the variants the pipeline would have made for it.
const COVER_VARIANTS = [
  ['thumb', 'webp', 160, 90, 3_200],
  ['small', 'webp', 400, 225, 11_000],
  ['medium', 'webp', 800, 450, 29_000],
  ['large', 'webp', 1600, 900, 92_000],
] as const
const PHOTO_VARIANTS = [
  ['thumb', 'webp', 160, 120, 4_100],
  ['small', 'webp', 400, 300, 14_400],
  ['medium', 'webp', 800, 600, 36_800],
  ['large', 'webp', 1600, 1200, 118_000],
] as const

/**
 * Photos for the seeded stores and their published offers (feature 035).
 *
 * Its own step, run AFTER `seedContent`: that step stops as soon as any asset
 * exists (it has no natural key to be idempotent on), so assets written before
 * it would silently skip every event image. The merchants' own uploads are
 * uploaded BY the merchants' owners, kind `merchant`, so the stored-bytes
 * counter has the distribution the media screens show, and every file is under
 * the 1 MiB a merchant may upload — the seed does not get to break a rule the
 * server enforces.
 *
 * The counter is `sum(bytes)` over what each owner now owns, computed by
 * Postgres in one statement (the history rule), with `DO UPDATE`: an owner who
 * already has a counter must end with one that equals the rows.
 */
export async function seedMerchantMedia(pool: Pool, faker: Faker, _options: SeedOptions) {
  const counts = { assets: 0, asset_variants: 0, store_media: 0, offer_media: 0, counters: 0 }

  const { rows: already } = await pool.query(
    `SELECT (SELECT count(*) FROM store_media) + (SELECT count(*) FROM offer_media)
          + (SELECT count(*) FROM stores WHERE cover_asset_id IS NOT NULL) AS n`,
  )
  if (Number(already[0].n) > 0) return counts

  const { rows: stores } = await pool.query(
    `SELECT s.id AS store_id, o.id AS organisation_id, o.slug,
            (SELECT u.id FROM organisation_users u
              WHERE u.organisation_id = o.id AND u.role = 'owner' AND u.status = 'active'
              ORDER BY u.email LIMIT 1) AS owner_id
       FROM stores s JOIN organisations o ON o.id = s.organisation_id
      WHERE o.kind = 'merchant'
      ORDER BY o.slug`,
  )

  async function asset(key: string, owner: string, width: number, height: number, bytes: number, alt: string, variants: readonly (readonly [string, string, number, number, number])[]) {
    const { rows } = await pool.query(
      `INSERT INTO assets (kind, mime, checksum, bytes, width, height, alt, state,
                           uploaded_by, uploader_kind, storage_key)
       VALUES ('image', 'image/jpeg', $1, $2, $3, $4, $5, 'ready', $6, 'merchant', $7)
       ON CONFLICT (checksum) DO NOTHING
       RETURNING id`,
      [createHash('sha256').update(key).digest(), bytes, width, height, alt, owner, `demo/${key}`],
    )
    if (rows.length === 0) return null
    counts.assets += 1
    for (const [variant, format, w, h, b] of variants) {
      const { rowCount } = await pool.query(
        `INSERT INTO asset_variants (asset_id, variant, format, width, height, bytes, storage_key)
         VALUES ($1, $2::asset_variant, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [rows[0].id, variant, format, w, h, b, `demo/${key}-${variant}.${format}`],
      )
      counts.asset_variants += rowCount ?? 0
    }
    return String(rows[0].id)
  }

  const owners = new Set<string>()
  for (const store of stores) {
    if (!store.owner_id) continue
    owners.add(String(store.owner_id))

    const cover = await asset(
      `demo-store-cover-${store.slug}`, store.owner_id, 1600, 900,
      faker.number.int({ min: 120_000, max: 900_000 }), `Titelbild von ${store.slug}`, COVER_VARIANTS,
    )
    if (cover) await pool.query('UPDATE stores SET cover_asset_id = $1 WHERE id = $2', [cover, store.store_id])

    for (let position = 0; position < 3; position += 1) {
      const id = await asset(
        `demo-store-photo-${store.slug}-${position}`, store.owner_id, 1600, 1200,
        faker.number.int({ min: 120_000, max: 900_000 }), `Foto ${position + 1} von ${store.slug}`, PHOTO_VARIANTS,
      )
      if (!id) continue
      const { rowCount } = await pool.query(
        'INSERT INTO store_media (store_id, asset_id, position) VALUES ($1, $2, $3)', [store.store_id, id, position],
      )
      counts.store_media += rowCount ?? 0
    }

    const { rows: offers } = await pool.query(
      `SELECT id FROM offers WHERE store_id = $1 AND state = 'published' ORDER BY created_at, id`, [store.store_id],
    )
    for (const [n, offer] of offers.entries()) {
      for (let position = 0; position < 1 + (n % 3); position += 1) {
        const id = await asset(
          `demo-offer-photo-${store.slug}-${n}-${position}`, store.owner_id, 1600, 1200,
          faker.number.int({ min: 120_000, max: 900_000 }), `Foto ${position + 1} zum Angebot`, PHOTO_VARIANTS,
        )
        if (!id) continue
        const { rowCount } = await pool.query(
          'INSERT INTO offer_media (offer_id, asset_id, position) VALUES ($1, $2, $3)', [offer.id, id, position],
        )
        counts.offer_media += rowCount ?? 0
      }
    }
  }

  const { rowCount } = await pool.query(
    `INSERT INTO counters (scope, subject, used, updated_at)
     SELECT 'media.stored_bytes', uploaded_by::text, sum(bytes), max(created_at)
       FROM assets WHERE uploaded_by = ANY($1::uuid[])
      GROUP BY uploaded_by
     ON CONFLICT (scope, subject) DO UPDATE SET used = EXCLUDED.used, updated_at = EXCLUDED.updated_at`,
    [[...owners]],
  )
  counts.counters = rowCount ?? 0
  return counts
}

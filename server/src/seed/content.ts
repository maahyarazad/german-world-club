import { createHash } from 'node:crypto'
import type { Pool } from 'pg'

/**
 * Assets, their derivatives, SEO metadata and legacy redirects.
 *
 * Variants exist at the declared breakpoints because the original is never
 * served (Principle VI) — an asset row with no variants would describe a state
 * the media pipeline cannot produce.
 */

const VARIANTS = [
  ['thumb', 'webp', 160, 120, 6_100],
  ['small', 'webp', 400, 300, 21_400],
  ['medium', 'webp', 800, 600, 54_800],
  ['large', 'webp', 1600, 1200, 172_000],
]

export async function seedContent(pool: Pool, faker, options) {
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
  const { rows: seeded } = await pool.query('SELECT count(*)::int AS n FROM assets')
  if (seeded[0].n > 0) return { assets: 0, asset_variants: 0, seo_metadata: 0, legacy_redirects: 0, counters: 0 }
  let assets = 0
  let variants = 0
  let metadata = 0
  let redirects = 0

  const count = Math.max(8, Math.round(options.events / 2))

  /**
   * Somebody uploaded every asset, and who it was is not decoration.
   *
   * `assets.uploaded_by` is the subject of the `media.stored_bytes` quota, so
   * an asset with no uploader is a byte nobody is accounted for — the media
   * screens would show thirteen assets and every member at zero used. Spreading
   * them over a handful of members means the quota display has a distribution
   * to show rather than one number.
   */
  const { rows: uploaders } = await pool.query(
    `SELECT id FROM members
      WHERE email LIKE '%@demo.invalid' AND status = 'active'
      ORDER BY email LIMIT 5`,
  )

  for (let i = 0; i < count; i += 1) {

    const alt = faker.lorem.sentence({ min: 4, max: 9 })
    const checksum = createHash('sha256').update(`demo-asset-${i}`).digest()

    const { rows } = await pool.query(
      `INSERT INTO assets (kind, mime, checksum, bytes, width, height, alt, state,
                           uploaded_by, uploader_kind, storage_key)
       VALUES ('image', 'image/jpeg', $1, $2, $3, $4, $5, 'ready', $6, $7, $8)
       ON CONFLICT (checksum) DO NOTHING
       RETURNING id`,
      [
        checksum,
        faker.number.int({ min: 800_000, max: 4_000_000 }),
        faker.helpers.arrayElement([3000, 4000, 5000]),
        faker.helpers.arrayElement([2000, 3000, 3500]),
        alt,
        uploaders.length > 0 ? uploaders[i % uploaders.length].id : null,
        uploaders.length > 0 ? 'member' : null,
        `demo/asset-${i}`,
      ],
    )
    if (rows.length === 0) continue
    assets += 1

    for (const [variant, format, w, h, bytes] of VARIANTS) {
      const { rowCount } = await pool.query(
        `INSERT INTO asset_variants (asset_id, variant, format, width, height, bytes, storage_key)
         VALUES ($1, $2::asset_variant, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [rows[0].id, variant, format, w, h, bytes, `demo/asset-${i}-${variant}.${format}`],
      )
      variants += rowCount
    }
  }

  /**
   * SEO metadata for the seeded events.
   *
   * Only for events that are actually visible: §10 requires published state to
   * match real state, so writing indexable metadata for an event nobody can see
   * would advertise something that is not there.
   */
  const { rows: events } = await pool.query(
    `SELECT id, slug, title, state FROM events WHERE state IN ('open', 'closed', 'review') ORDER BY slug`,
  )
  for (const event of events) {
    const { rowCount } = await pool.query(
      `INSERT INTO seo_metadata (record_type, record_id, slug, seo_title, meta_description,
                                 indexable, language, published)
       VALUES ('event', $1, $2, $3, $4, true, 'de', true)
       ON CONFLICT (record_type, slug) DO NOTHING`,
      [event.id, event.slug, event.title, faker.lorem.sentence({ min: 10, max: 18 })],
    )
    metadata += rowCount
  }

  // A handful of retired URLs, so the redirect screen has rows. Indexed URLs
  // are an asset: they are preserved or permanently redirected, never dropped.
  for (let i = 0; i < 6; i += 1) {
    const { rowCount } = await pool.query(
      `INSERT INTO legacy_redirects (legacy_path, target_path, status, note)
       VALUES ($1, $2, 301, $3)
       ON CONFLICT (legacy_path) DO NOTHING`,
      [
        // Normalised on write by the table's own CHECK: lowercase, no trailing
        // slash, no query string. Generating a value that violates it would be
        // working against the constraint rather than with it.
        `/alt/${faker.helpers.slugify(faker.lorem.words(2)).toLowerCase()}-${i}`,
        '/',
        'seeded demo redirect',
      ],
    )
    redirects += rowCount
  }

  /**
   * The stored-bytes quota, derived rather than invented (T055).
   *
   * `counters` is history in the manifest's sense: it records what has been
   * consumed. The rule for history is that an entry exists only where a seeded
   * fact implies one, at that fact's own value — so this is `sum(bytes)` over
   * the rows just inserted, computed by the database, not a plausible-looking
   * number drawn from faker.
   *
   * Written in one SQL statement for the same reason the audit entries are: a
   * round trip through JS to add up numbers Postgres already has is a chance
   * for the counter and the assets it counts to disagree, and a counter that
   * disagrees with reality is worse than an absent one — it is the number the
   * quota check trusts.
   *
   * `limit_value` is left NULL: the ceiling is configuration
   * (`MEDIA_ACCOUNT_QUOTA_BYTES`), applied by `reserve()` as `defaultLimit` on
   * first use. Baking today's value into a row would freeze it, and the
   * `counters_within_limit` CHECK would then refuse uploads after the
   * configured quota was *raised*.
   */
  const { rowCount: counters } = await pool.query(
    `INSERT INTO counters (scope, subject, used, updated_at)
     SELECT 'media.stored_bytes', uploaded_by::text, sum(bytes), max(created_at)
       FROM assets
      WHERE uploaded_by IS NOT NULL
      GROUP BY uploaded_by
     ON CONFLICT (scope, subject) DO NOTHING`,
  )

  return {
    assets,
    asset_variants: variants,
    seo_metadata: metadata,
    legacy_redirects: redirects,
    counters,
  }
}

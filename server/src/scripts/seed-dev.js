#!/usr/bin/env node
import { loadEnv } from '../config/env.js'
import { createPool } from '../db/pool.js'

/**
 * Development seed data for local validation.
 *
 * Member, admin, and session tables arrive with US1, so this currently seeds
 * only what Foundational created: one SEO record and one asset, enough for the
 * US2 and US3 quickstart scenarios to have something to resolve.
 */
const env = loadEnv()
const pool = createPool(env)

try {
  const asset = await pool.query(
    `INSERT INTO assets (kind, mime, checksum, bytes, width, height, alt, state, storage_key)
     VALUES ('image', 'image/jpeg', $1, 2048000, 4000, 3000,
             'The German World Club terrace at sunset', 'ready', 'seed/terrace')
     ON CONFLICT (checksum) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [Buffer.from('seed-asset-terrace')],
  )
  const assetId = asset.rows[0].id

  for (const [variant, format, w, h, bytes] of [
    ['thumb', 'webp', 160, 120, 6_100],
    ['small', 'webp', 400, 300, 21_400],
    ['medium', 'webp', 800, 600, 54_800],
    ['large', 'webp', 1600, 1200, 172_000],
  ]) {
    await pool.query(
      `INSERT INTO asset_variants (asset_id, variant, format, width, height, bytes, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [assetId, variant, format, w, h, bytes, `seed/terrace-${variant}.${format}`],
    )
  }

  await pool.query(
    `INSERT INTO seo_metadata (record_type, record_id, slug, seo_title, meta_description,
                               share_image_id, indexable, language, published)
     VALUES ('page', gen_random_uuid(), 'willkommen', 'Willkommen beim German World Club',
             'Ein privates Netzwerk deutschsprachiger Expatriates in den VAE.',
             $1, true, 'de', true)
     ON CONFLICT (record_type, slug) DO NOTHING`,
    [assetId],
  )

  console.log('seed: 1 asset with 4 variants, 1 published SEO record')
} finally {
  await pool.end()
}

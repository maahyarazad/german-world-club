#!/usr/bin/env node
import { loadEnv } from '../config/env.js'
import { createPool } from '../db/pool.js'
import { hashPassword } from '../modules/auth/passwords.js'
import { FLAGS } from '@gwc/contracts/permissions'

/**
 * Development seed data for local validation.
 *
 * Seeds one asset with its variants, one published page, and the sign-in
 * accounts specs/003-web-console/quickstart.md needs — without them the console
 * has a sign-in screen and nothing to sign in as.
 */
const env = loadEnv()

/**
 * Refuses to run outside development.
 *
 * Everything below has a known, published password. That is exactly right for
 * a laptop and catastrophic anywhere else, and "we would never run it in
 * production" is not a control — this is. `development` exactly, not
 * `!isProduction`: staging runs as production and a CI database is not a place
 * for seeded credentials either.
 */
if (env.NODE_ENV !== 'development') {
  console.error(
    `refusing to seed: NODE_ENV is ${JSON.stringify(env.NODE_ENV)}, not "development".\n` +
      'This script creates accounts with known passwords and must never touch a shared database.',
  )
  process.exit(1)
}

const pool = createPool(env)

/** The one password every seeded account shares. Development only, by the gate above. */
const SEED_PASSWORD = 'konsole-entwicklung'

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

  /**
   * The slug must be one the server actually serves.
   *
   * `page` records are rendered only at the declared institutional slugs
   * (`INSTITUTIONAL_SLUGS` in public/routes.js) — everything else is a real
   * 404, by design. Seeding `willkommen` produced a published, indexable
   * record at a path that answered 404: invisible in the sitemap, because
   * `shouldInclude` correctly refuses to list a URL that does not resolve, and
   * therefore a developer running seed:dev saw no content at all.
   */
  const seeded = []
  for (const [slug, title, description] of [
    ['about', 'Über den German World Club',
      'Ein privates Netzwerk deutschsprachiger Expatriates in den Vereinigten Arabischen Emiraten.'],
    ['imprint', 'Impressum',
      'Angaben gemäß den rechtlichen Anforderungen der Vereinigten Arabischen Emirate.'],
  ]) {
    const { rowCount } = await pool.query(
      `INSERT INTO seo_metadata (record_type, record_id, slug, seo_title, meta_description,
                                 share_image_id, indexable, language, published)
       VALUES ('page', gen_random_uuid(), $2, $3, $4, $1, true, 'de', true)
       ON CONFLICT (record_type, slug) DO NOTHING`,
      [assetId, slug, title, description],
    )
    if (rowCount > 0) seeded.push(slug)
  }

  /**
   * The two landing pages, as a translation pair.
   *
   * `slug: 'home'` is what makes the German page resolve to `/` — `pathFor`
   * maps that one slug to the root. `slug: 'en'` resolves to `/en` through the
   * same function with no special case.
   *
   * The shared `translation_group_id` is the whole point: `build-page-meta.js`
   * derives the hreflang set from the group, so neither row names the other and
   * a one-directional declaration — which search engines ignore, leaving both
   * pages competing as duplicates — is not expressible.
   *
   * Note this also puts `/` in the sitemap for the FIRST time. The landing page
   * had no metadata row before, so it was absent from the sitemap entirely
   * (research R8). Adding the English page fixes the German one too.
   */
  const landingGroup = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id
  const landingPages = []
  for (const [slug, language, title, description] of [
    ['home', 'de', 'German World Club — Ein globales Vertrauensnetz',
      'Ein globales Netzwerk für deutschsprachige Menschen mit internationalem Leben: reale '
      + 'Beziehungen, geprüfte Experten, Veranstaltungen, lokale Vorteile und globale Kontinuität.'],
    ['en', 'en', 'German World Club — A Global Network of Trust',
      'A global network for German-speaking people with international lives: real relationships, '
      + 'verified experts, events, local benefits and continuity across borders.'],
  ]) {
    const { rowCount } = await pool.query(
      `INSERT INTO seo_metadata (record_type, record_id, slug, seo_title, meta_description,
                                 indexable, language, translation_group_id, published)
       VALUES ('page', gen_random_uuid(), $1, $2, $3, true, $4, $5, true)
       ON CONFLICT (record_type, slug) DO UPDATE
         SET seo_title = EXCLUDED.seo_title,
             meta_description = EXCLUDED.meta_description,
             language = EXCLUDED.language,
             translation_group_id = EXCLUDED.translation_group_id,
             updated_at = now()`,
      [slug, title, description, language, landingGroup],
    )
    if (rowCount > 0) landingPages.push(`${slug} (${language})`)
  }

  // ---- Sign-in accounts ---------------------------------------------------
  //
  // One account per grant shape the quickstart scenarios exercise. They are
  // upserted by email so re-running the seed is idempotent rather than a
  // unique-violation.

  const passwordHash = await hashPassword(SEED_PASSWORD)

  const upsertAdmin = async ({ email, displayName, isSuperadmin = false, grants = {} }) => {
    const { rows } = await pool.query(
      `INSERT INTO admin_users (email, password_hash, is_admin, is_superadmin, is_active, display_name)
       VALUES ($1, $2, true, $3, true, $4)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             is_superadmin = EXCLUDED.is_superadmin,
             is_active = true,
             display_name = EXCLUDED.display_name
       RETURNING id`,
      [email, passwordHash, isSuperadmin, displayName],
    )
    const id = rows[0].id

    for (const [module, flags] of Object.entries(grants)) {
      const set = flags === true ? Object.fromEntries(FLAGS.map((f) => [f, true])) : flags
      await pool.query(
        `INSERT INTO admin_permissions (admin_user_id, module, can_read, can_write, can_edit, can_delete, can_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (admin_user_id, module) DO UPDATE
           SET can_read = EXCLUDED.can_read, can_write = EXCLUDED.can_write,
               can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete,
               can_status = EXCLUDED.can_status`,
        [id, module, set.read === true, set.write === true, set.edit === true,
         set.delete === true, set.status === true],
      )
    }
    return email
  }

  const accounts = []

  accounts.push(await upsertAdmin({
    email: 'seo@test.invalid', displayName: 'SEO Redaktion',
    grants: { seo: { read: true, edit: true } },
  }))
  accounts.push(await upsertAdmin({
    email: 'reader@test.invalid', displayName: 'SEO Lesezugriff',
    grants: { seo: { read: true } },
  }))
  accounts.push(await upsertAdmin({
    email: 'push@test.invalid', displayName: 'Kampagnen',
    grants: { mass_messages: { read: true, write: true, edit: true } },
  }))
  /**
   * Not filler.
   *
   * An account holding nothing is the counter-assertion for the whole
   * capability mechanism: a console that renders a full sidebar here has a
   * defect no positive test would catch. It exists so that case can be checked
   * by hand as easily as it is checked in CI.
   */
  accounts.push(await upsertAdmin({ email: 'nogrants@test.invalid', displayName: 'Ohne Rechte' }))
  accounts.push(await upsertAdmin({
    email: 'super@test.invalid', displayName: 'Superadmin', isSuperadmin: true,
  }))

  await pool.query(
    `INSERT INTO members (email, password_hash, status, email_confirmed_at, display_name)
     VALUES ($1, $2, 'active', now(), $3)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           status = 'active',
           email_confirmed_at = now(),
           display_name = EXCLUDED.display_name`,
    ['member@test.invalid', passwordHash, 'Testmitglied'],
  )
  accounts.push('member@test.invalid')

  // Merchant and partner principals now have tables (migration 014), and
  // `seed:dev` still seeds none of them on purpose: it exists to produce the
  // six fixed accounts the hand-written suites depend on, not a population.
  // `npm run -w server seed:demo` is the one that fills every table.
  console.log(
    `seed: 1 asset with 4 variants, ${seeded.length} published page(s): ${seeded.join(', ') || 'none (already present)'}\n` +
      `seed: landing pair: ${landingPages.join(', ')} — one translation group\n` +
      `seed: ${accounts.length} sign-in accounts, all with password "${SEED_PASSWORD}":\n` +
      accounts.map((a) => `        ${a}`).join('\n') +
      '\n      (no merchant or partner principals — run seed:demo for those)',
  )
} finally {
  await pool.end()
}

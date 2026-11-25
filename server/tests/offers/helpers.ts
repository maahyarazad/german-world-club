import { randomBytes, randomUUID } from 'node:crypto'
import { createMember, createAdmin, bearerFor } from '../helpers/auth.ts'
import { organisationUser } from '../threads/social-helpers.ts'
import type { Pool } from 'pg'
import type { GwcApp } from '../../src/app.ts'

/**
 * Corpus helpers for the merchant store, offer and redemption suites (feature 035).
 *
 * Rows go in with SQL, not through the API, so a suite can put an offer into a
 * state the API will not produce — a published offer in a switched-off store, a
 * sold-out one, an expired one — which is exactly what the visibility rules
 * exist for. A corpus that could only hold reachable states would prove nothing
 * about them.
 */

export type RedeemerKind = 'member' | 'admin' | 'merchant' | 'partner'

/** The browse/redeem path prefix of each audience (one handler set, four prefixes). */
export const CLUB_OFFERS: Record<RedeemerKind, string> = {
  member: '/member/offers',
  admin: '/admin/club-offers',
  merchant: '/merchant/club-offers',
  partner: '/partner/club-offers',
}

/**
 * A merchant organisation with a public face, a store, and an owner who is
 * signed in. `profile: false` leaves the organisation without a public name,
 * the state a merchant is in before they have filled in their profile.
 */
export async function merchantWithStore(
  app: GwcApp,
  { storeActive = true, displayName = 'Café Test', profile = true, orgStatus = 'active', createStore = true }: {
    storeActive?: boolean; displayName?: string; profile?: boolean; orgStatus?: string; createStore?: boolean
  } = {},
) {
  const user = await organisationUser(app, 'merchant', { status: orgStatus })
  if (profile) {
    await app.pg.query(
      'INSERT INTO organisation_profiles (organisation_id, display_name) VALUES ($1, $2)',
      [user.organisationId, displayName],
    )
  }
  let storeId: string | null = null
  if (createStore) {
    const { rows } = await app.pg.query(
      `INSERT INTO stores (organisation_id, active, deactivated_at, deactivation_reason)
       VALUES ($1, $2, CASE WHEN $2 THEN NULL ELSE now() END, CASE WHEN $2 THEN NULL ELSE 'test' END)
       RETURNING id`,
      [user.organisationId, storeActive],
    )
    storeId = String(rows[0].id)
  }
  return { ...user, storeId: storeId as string, headers: user.headers as unknown as Record<string, string> }
}

export type OfferSeed = {
  organisationId: string
  storeId: string
  categorySlug?: string
  state?: string
  title?: string
  benefitKind?: string
  benefitValue?: number | null
  regularPriceCents?: number | null
  memberPriceCents?: number | null
  remaining?: number | null
  perPersonLimit?: number | null
  validFrom?: Date
  validUntil?: Date
  sortPosition?: number
}

const DAY = 86_400_000

/** Insert an offer directly, in any state. Returns its id. */
export async function seedOffer(pool: Pool, seed: OfferSeed): Promise<string> {
  const {
    organisationId, storeId, categorySlug = 'other', state = 'published', title = `Offer ${randomUUID().slice(0, 6)}`,
    benefitKind = 'percentage', benefitValue = benefitKind === 'percentage' ? 20 : null,
    regularPriceCents = 1000, memberPriceCents = 800, remaining = null, perPersonLimit = 1,
    validFrom = new Date(Date.now() - DAY), validUntil = new Date(Date.now() + 30 * DAY), sortPosition = 0,
  } = seed
  const { rows } = await pool.query(
    `INSERT INTO offers (organisation_id, store_id, category_id, title, description, regular_price_cents,
                         member_price_cents, benefit_kind, benefit_value, valid_from, valid_until, conditions,
                         state, published_at, remaining, per_person_limit, sort_position)
     VALUES ($1, $2, (SELECT id FROM offer_categories WHERE slug = $3), $4, 'Beschreibung', $5, $6,
             $7::benefit_kind, $8, $9, $10, 'Nur für Mitglieder', $11::offer_state,
             CASE WHEN $11 = 'published' THEN now() END, $12, $13, $14)
     RETURNING id`,
    [organisationId, storeId, categorySlug, title, regularPriceCents, memberPriceCents, benefitKind, benefitValue,
      validFrom, validUntil, state, remaining, perPersonLimit, sortPosition],
  )
  return String(rows[0].id)
}

/** An account of the given kind, signed in, able to redeem. */
export async function redeemerFor(app: GwcApp, kind: RedeemerKind, { organisationId }: { organisationId?: string } = {}) {
  if (kind === 'member') {
    const member = await createMember(app.pg, { passwordHash: null })
    const headers = await bearerFor(app, { accountId: String(member.id), accountKind: 'member' })
    return { id: String(member.id), kind, headers: headers as unknown as Record<string, string>, organisationId: undefined as string | undefined }
  }
  if (kind === 'admin') {
    const admin = await createAdmin(app.pg, { isAdmin: false })
    const headers = await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' })
    return { id: String(admin.id), kind, headers: headers as unknown as Record<string, string>, organisationId: undefined as string | undefined }
  }
  const user = await organisationUser(app, kind, { organisationId })
  return { id: user.id, kind, headers: user.headers as unknown as Record<string, string>, organisationId: user.organisationId }
}

/** Staff holding the given grants. `true` means all five flags. */
export async function staffWith(app: GwcApp, grants: Record<string, true | Record<string, boolean>> = {}, { superadmin = false } = {}) {
  const admin = await createAdmin(app.pg, { isAdmin: !superadmin ? false : true, isSuperadmin: superadmin, grants: grants as never })
  const headers = await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' })
  return { id: String(admin.id), headers: headers as unknown as Record<string, string> }
}

/**
 * A `ready` asset owned by the given uploader, with a thumbnail variant, so a
 * store or offer can link it and delivery has something to build a URL from.
 */
export async function seedReadyAsset(
  pool: Pool,
  { uploaderId, uploaderKind, kind = 'image', width = 1600, height = 900, bytes = 200_000, state = 'ready' }: {
    uploaderId: string; uploaderKind: 'merchant' | 'partner' | 'member' | 'admin'
    kind?: 'image' | 'video'; width?: number; height?: number; bytes?: number; state?: string
  },
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO assets (kind, mime, checksum, bytes, width, height, duration_ms, alt, state, failure_reason,
                         uploaded_by, uploader_kind, storage_key)
     VALUES ($1::asset_kind, $2, $3, $4, $5, $6, $7, 'Test asset', $8::asset_state,
             CASE WHEN $8 = 'failed' THEN 'test failure' END, $9, $10::account_kind, $11)
     RETURNING id`,
    [kind, kind === 'image' ? 'image/jpeg' : 'video/webm', randomBytes(32), bytes, width, height,
      kind === 'video' ? 4000 : null, state, uploaderId, uploaderKind, `test/${randomUUID()}`],
  )
  const id = String(rows[0].id)
  if (state === 'ready') {
    await pool.query(
      `INSERT INTO asset_variants (asset_id, variant, format, width, height, bytes, storage_key)
       VALUES ($1, $2::asset_variant, $3, 160, 90, 1000, $4)`,
      [id, kind === 'image' ? 'thumb' : 'poster', 'webp', `test/${id}-thumb`],
    )
  }
  return id
}

/** Everything these suites write. TRUNCATE fires no row trigger, so the append-only guards stay on. */
export async function resetOffers(pool: Pool) {
  await pool.query('TRUNCATE redemption_feedback, redemptions, offer_media, store_media RESTART IDENTITY CASCADE')
  await pool.query('TRUNCATE offers, stores RESTART IDENTITY CASCADE')
  // Categories are reference data that suites change to test changing them (hide,
  // rename, reorder). Put the starter set back exactly as the migration made it, so
  // a run does not depend on what the previous run left behind.
  await pool.query(`
    UPDATE offer_categories c
       SET name_de = s.name_de, name_en = s.name_en, position = s.position, visible = true
      FROM (VALUES
        ('restaurants', 'Küche & Restaurants',   'Cuisine & Restaurants', 10),
        ('health',      'Gesundheit & Kliniken', 'Health & Clinics',      20),
        ('beauty',      'Beauty & Wellness',     'Beauty & Wellness',     30),
        ('shopping',    'Einkaufen',             'Shopping',              40),
        ('travel',      'Reisen & Freizeit',     'Travel & Leisure',      50),
        ('services',    'Dienstleistungen',      'Services',              60),
        ('education',   'Bildung',               'Education',             70),
        ('other',       'Sonstiges',             'Other',                 80)
      ) AS s(slug, name_de, name_en, position)
     WHERE c.slug = s.slug`)
  await pool.query(`DELETE FROM offer_categories WHERE slug LIKE 'test-%'`)
}

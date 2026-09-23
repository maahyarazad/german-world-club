import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { PLATFORM_JOBS } from '../ops/jobs.ts'
import type { Faker } from './faker.ts'
import type { SeedOptions } from './options.ts'

/**
 * The marketplace corpus (feature 008, SC-009): every category, both modes,
 * every state, some listings with an expiry and some unlimited, plus the
 * conversations that make the demo inbox non-empty.
 *
 * A browse screen showing only active vehicle offers proves nothing about how
 * a filled job request, an expired property or a hidden listing renders — and
 * those are the screens nobody builds a fixture for.
 *
 * ── The consistent-history rule ─────────────────────────────────────────────
 * Every non-trivial state implies the thing that put the listing there, and
 * that thing is written at the listing's own `state_changed_at` with its own
 * value — derived from the row in SQL, never re-typed in JavaScript:
 *
 *   sold / filled / withdrawn → the owner's `marketplace_listing_state_changed`
 *   hidden                    → the moderator's `marketplace_listing_hidden`
 *   expired                   → a `marketplace-expiry` job run, the mechanism
 *                               that job's own accountability uses (manage.ts)
 *
 * `draft` and `active` imply nothing: creating and publishing write no audit
 * entry in `application/create.ts`, so a seeded one would be history the app
 * itself never records.
 */

/** Matches `currentTermsVersion()`'s default in application/create.ts. */
const TERMS_VERSION = process.env.MARKETPLACE_TERMS_VERSION ?? 'v1'

/**
 * Photos need the same breakpoints `content.ts` declares — an asset with no
 * variants describes a state the media pipeline cannot produce, and the
 * original is never served.
 */
const VARIANTS = [
  ['thumb', 'webp', 160, 120, 6_100],
  ['small', 'webp', 400, 300, 21_400],
  ['medium', 'webp', 800, 600, 54_800],
  ['large', 'webp', 1600, 1200, 172_000],
] as const

type Category = 'vehicle' | 'property' | 'job' | 'general'
type Mode = 'offer' | 'request'
type State = 'draft' | 'active' | 'sold' | 'filled' | 'withdrawn' | 'expired' | 'hidden'
type Expiry = 'none' | 'future' | 'past'

/**
 * The plan: every category × mode active twice, once unlimited and once with
 * a future expiry (FR-028 treats both as first-class), then each terminal and
 * moderation state placed where it reads naturally — a vehicle sells, a job is
 * filled. `expired` always carries a past expiry; nothing else can reach it.
 */
const PLAN: ReadonlyArray<{ category: Category; mode: Mode; state: State; expiry: Expiry }> = [
  ...(['vehicle', 'property', 'job', 'general'] as const).flatMap((category) =>
    (['offer', 'request'] as const).flatMap((mode) => [
      { category, mode, state: 'active' as const, expiry: 'none' as const },
      { category, mode, state: 'active' as const, expiry: 'future' as const },
    ])),
  { category: 'vehicle', mode: 'offer', state: 'sold', expiry: 'none' },
  { category: 'vehicle', mode: 'offer', state: 'draft', expiry: 'none' },
  { category: 'property', mode: 'offer', state: 'withdrawn', expiry: 'future' },
  { category: 'property', mode: 'offer', state: 'hidden', expiry: 'none' },
  { category: 'property', mode: 'request', state: 'expired', expiry: 'past' },
  { category: 'job', mode: 'offer', state: 'filled', expiry: 'none' },
  { category: 'job', mode: 'offer', state: 'expired', expiry: 'past' },
  { category: 'job', mode: 'request', state: 'filled', expiry: 'none' },
  { category: 'general', mode: 'offer', state: 'sold', expiry: 'future' },
  { category: 'general', mode: 'offer', state: 'hidden', expiry: 'none' },
  { category: 'general', mode: 'request', state: 'withdrawn', expiry: 'none' },
  { category: 'general', mode: 'request', state: 'draft', expiry: 'none' },
]

const DAY = 86_400_000

const TITLES: Record<Category, Record<Mode, readonly string[]>> = {
  vehicle: {
    offer: ['BMW 320d Touring, scheckheftgepflegt', 'Mercedes C 200, erste Hand', 'VW Golf GTI, Winterräder dabei'],
    request: ['Suche Familien-SUV bis 60.000 €', 'Suche Cabrio für den Winter'],
  },
  property: {
    offer: ['3-Zimmer-Wohnung mit Blick auf die Marina', 'Möbliertes Studio nahe Business Bay', 'Villa mit Garten zu vermieten'],
    request: ['Suche 2-Zimmer-Wohnung ab Januar', 'Familie sucht Haus mit Garten'],
  },
  job: {
    offer: ['Senior Controller (m/w/d) gesucht', 'Werkstudent Marketing, Teilzeit', 'Projektleiter Bau, Festanstellung'],
    request: ['Erfahrene Buchhalterin sucht neue Herausforderung', 'Suche Praktikum im Bereich Logistik'],
  },
  general: {
    offer: ['Deutsche Schulbücher Klasse 5–7', 'Umzugskartons, 40 Stück', 'Klavierunterricht für Kinder'],
    request: ['Suche Babysitter für Freitagabende', 'Suche gebrauchtes Kinderfahrrad 20 Zoll'],
  },
}

const MAKES = [['BMW', '320d', 'Kombi'], ['Mercedes-Benz', 'C 200', 'Limousine'], ['Volkswagen', 'Golf', 'Kompakt'], ['Audi', 'Q5', 'SUV'], ['Porsche', 'Macan', 'SUV']] as const
const CITIES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ras al-Khaimah'] as const

export async function seedMarketplace(pool: Pool, faker: Faker, _options: SeedOptions) {
  const counts = {
    marketplace_listings: 0,
    marketplace_vehicle_details: 0,
    marketplace_property_details: 0,
    marketplace_job_details: 0,
    marketplace_general_details: 0,
    marketplace_vehicle_features: 0,
    marketplace_listing_media: 0,
    marketplace_reports: 0,
    marketplace_terms_acceptances: 0,
    conversations: 0,
    conversation_participants: 0,
    messages: 0,
    assets: 0,
    asset_variants: 0,
    audit_log: 0,
    job_runs: 0,
    counters: 0,
  }

  /**
   * Already seeded? Then stop.
   *
   * Counted over demo-owned listings only, not the whole table: a listing a
   * developer posted by hand while testing must not make the seed think it
   * has already run. Listings have no natural key the seeder controls, so
   * ON CONFLICT has nothing to catch — the same reasoning as events.ts.
   */
  const { rows: seeded } = await pool.query(
    `SELECT count(*)::int AS n FROM marketplace_listings l
       JOIN members m ON m.id = l.owner_id
      WHERE m.email LIKE '%@demo.invalid'`,
  )
  if (seeded[0].n > 0) return counts

  /**
   * Owners are members who hold `marketplace_post`, in every status.
   *
   * Posting needs the flag, so a listing owned by a member without it would be
   * history that could not have happened. Non-active owners are included on
   * purpose: their listings exist and are hidden from the index by the
   * owner-status cascade (R7), which is a path worth being able to see.
   */
  const { rows: posters } = await pool.query(
    `SELECT id, status FROM members
      WHERE email LIKE '%@demo.invalid' AND (permissions->>'marketplace_post')::boolean
      ORDER BY (status = 'active') DESC, email`,
  )
  const activePosters = posters.filter((p) => p.status === 'active')
  const otherPosters = posters.filter((p) => p.status !== 'active')
  if (activePosters.length === 0) return counts

  const { rows: others } = await pool.query(
    `SELECT id FROM members
      WHERE email LIKE '%@demo.invalid' AND status = 'active'
        AND NOT coalesce((permissions->>'marketplace_post')::boolean, false)
      ORDER BY email LIMIT 12`,
  )

  const { rows: features } = await pool.query('SELECT id FROM vehicle_features WHERE retired_at IS NULL ORDER BY position')

  // A hide is taken by someone who holds the flag it needs. Falls back to a
  // superadmin; with neither, hidden listings are skipped rather than written
  // with an audit entry naming nobody.
  const { rows: moderators } = await pool.query(
    `SELECT a.id FROM admin_users a
       LEFT JOIN admin_permissions p
         ON p.admin_user_id = a.id AND p.module = 'marketplace_moderation' AND p.can_status
      WHERE a.email LIKE '%@staff.demo.invalid' AND (p.admin_user_id IS NOT NULL OR a.is_superadmin)
      ORDER BY (p.admin_user_id IS NOT NULL) DESC, a.email LIMIT 1`,
  )
  const moderator = moderators[0]?.id ?? null

  const now = Date.now()
  const listings: Array<{ id: string; ownerId: string; category: Category; mode: Mode; state: State; publishedAt: Date | null }> = []

  for (const [index, slot] of PLAN.entries()) {
    if (slot.state === 'hidden' && !moderator) continue

    // Roughly one in six listings belongs to a non-active member, and only
    // active listings — those are what the cascade actually hides.
    const owner = slot.state === 'active' && index % 6 === 5 && otherPosters.length > 0
      ? otherPosters[index % otherPosters.length]
      : activePosters[index % activePosters.length]

    const created = new Date(now - faker.number.int({ min: 10, max: 120 }) * DAY - faker.number.int({ min: 0, max: DAY }))
    const published = slot.state === 'draft' ? null : new Date(created.getTime() + faker.number.int({ min: 5, max: 90 }) * 60_000)

    let expires: Date | null = null
    if (slot.expiry === 'future') expires = new Date(now + faker.number.int({ min: 7, max: 60 }) * DAY)
    // Past but after publication — the CHECK refuses anything else, and an
    // expiry before publication would be a data-entry error, not an expiry.
    if (slot.expiry === 'past') expires = new Date(published!.getTime() + faker.number.int({ min: 3, max: 8 }) * DAY)

    // When the listing reached its state. Expired: the first job run after
    // `expires_at` — the job runs every five minutes. Otherwise: some time
    // between publication and now. Draft/active: the moment it was created or
    // published, which is what `create.ts` stamps.
    const stateChanged =
      slot.state === 'draft' ? created
        : slot.state === 'active' ? published!
          : slot.state === 'expired' ? new Date(expires!.getTime() + faker.number.int({ min: 1, max: 5 }) * 60_000)
            : new Date(published!.getTime() + faker.number.int({ min: 1, max: 9 }) * DAY)

    const title = faker.helpers.arrayElement(TITLES[slot.category][slot.mode])
    const body = `${title}. ${faker.lorem.paragraphs({ min: 1, max: 2 })}`
    const contact = index % 5 === 3 ? 'email_relay' : index % 7 === 4 ? 'phone' : 'platform_message'

    const { rows } = await pool.query(
      `INSERT INTO marketplace_listings (owner_id, category, mode, title, body, state, contact_method,
                                         terms_version, created_at, updated_at, published_at,
                                         expires_at, state_changed_at)
       VALUES ($1, $2::marketplace_category, $3::marketplace_mode, $4, $5, $6::marketplace_state,
               $7::marketplace_contact, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [owner.id, slot.category, slot.mode, title, body, slot.state, contact,
        TERMS_VERSION, created, stateChanged, published, expires, stateChanged],
    )
    const id = rows[0].id
    counts.marketplace_listings += 1
    listings.push({ id, ownerId: owner.id, category: slot.category, mode: slot.mode, state: slot.state, publishedAt: published })

    await insertDetails(pool, faker, { id, category: slot.category, index, counts })

    if (slot.category === 'vehicle' && features.length > 0) {
      for (const feature of faker.helpers.arrayElements(features, { min: 4, max: 12 })) {
        const { rowCount } = await pool.query(
          `INSERT INTO marketplace_vehicle_features (listing_id, feature_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id, feature.id],
        )
        counts.marketplace_vehicle_features += rowCount ?? 0
      }
    }
  }

  // ---- Media: the owner's own uploads --------------------------------------
  //
  // `attachMedia` only links an asset THIS member uploaded, so the photos are
  // uploaded by the listing owner here too. Offers only, and not drafts: a
  // request for a flat has nothing to photograph.
  const photographed = listings.filter((l) => l.mode === 'offer' && l.state !== 'draft' && l.category !== 'job')
  for (const [n, listing] of photographed.entries()) {
    const photos = 1 + (n % 3)
    for (let position = 0; position < photos; position += 1) {
      const { rows } = await pool.query(
        `INSERT INTO assets (kind, mime, checksum, bytes, width, height, alt, state,
                             uploaded_by, uploader_kind, storage_key, created_at)
         VALUES ('image', 'image/jpeg', $1, $2, 4000, 3000, $3, 'ready', $4, 'member', $5, $6)
         ON CONFLICT (checksum) DO NOTHING
         RETURNING id`,
        [
          createHash('sha256').update(`demo-listing-${n}-${position}`).digest(),
          faker.number.int({ min: 900_000, max: 3_800_000 }),
          `Foto ${position + 1} zur Anzeige`,
          listing.ownerId,
          `demo/listing-${n}-${position}`,
          listing.publishedAt,
        ],
      )
      if (rows.length === 0) continue
      counts.assets += 1
      for (const [variant, format, w, h, bytes] of VARIANTS) {
        const { rowCount } = await pool.query(
          `INSERT INTO asset_variants (asset_id, variant, format, width, height, bytes, storage_key)
           VALUES ($1, $2::asset_variant, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [rows[0].id, variant, format, w, h, bytes, `demo/listing-${n}-${position}-${variant}.${format}`],
        )
        counts.asset_variants += rowCount ?? 0
      }
      const { rowCount } = await pool.query(
        'INSERT INTO marketplace_listing_media (listing_id, asset_id, position) VALUES ($1, $2, $3)',
        [listing.id, rows[0].id, position],
      )
      counts.marketplace_listing_media += rowCount ?? 0
    }
  }

  /**
   * The owners' storage quota, recomputed from the assets they now own.
   *
   * `DO UPDATE`, not `DO NOTHING` as in content.ts: an owner who already
   * uploaded something there has a counter that no longer equals their
   * `sum(bytes)`, and a quota counter that disagrees with reality is the one
   * number the quota check trusts. Computed by Postgres, in one statement.
   */
  const { rowCount: counterRows } = await pool.query(
    `INSERT INTO counters (scope, subject, used, updated_at)
     SELECT 'media.stored_bytes', uploaded_by::text, sum(bytes), max(created_at)
       FROM assets
      WHERE uploaded_by = ANY($1::uuid[])
      GROUP BY uploaded_by
     ON CONFLICT (scope, subject) DO UPDATE SET used = EXCLUDED.used, updated_at = EXCLUDED.updated_at`,
    [[...new Set(photographed.map((l) => l.ownerId))]],
  )
  counts.counters += counterRows ?? 0

  // ---- Terms: every owner accepted before their first listing ---------------
  //
  // A record, not a credential, so seedable (tables.ts). Stamped a day before
  // that owner's earliest listing — the version they posted under has to have
  // been accepted by then.
  const { rowCount: terms } = await pool.query(
    `INSERT INTO marketplace_terms_acceptances (member_id, version, accepted_at)
     SELECT owner_id, $1, min(created_at) - interval '1 day'
       FROM marketplace_listings WHERE id = ANY($2::uuid[])
      GROUP BY owner_id
     ON CONFLICT DO NOTHING`,
    [TERMS_VERSION, listings.map((l) => l.id)],
  )
  counts.marketplace_terms_acceptances += terms ?? 0

  // ---- History, derived from state -----------------------------------------
  const ids = listings.map((l) => l.id)

  const { rowCount: ownerEntries } = await pool.query(
    `INSERT INTO audit_log (occurred_at, request_id, actor_id, actor_kind, action,
                            target_type, target_id, outcome, detail)
     SELECT l.state_changed_at, 'seed-' || left(l.id::text, 12), l.owner_id, 'member',
            'marketplace_listing_state_changed', 'marketplace_listing', l.id, 'allowed',
            jsonb_build_object('statusFrom', 'active', 'statusTo', l.state::text)
       FROM marketplace_listings l
      WHERE l.id = ANY($1::uuid[]) AND l.state IN ('sold', 'filled', 'withdrawn')`,
    [ids],
  )
  counts.audit_log += ownerEntries ?? 0

  if (moderator) {
    const { rowCount: hides } = await pool.query(
      `INSERT INTO audit_log (occurred_at, request_id, actor_id, actor_kind, action,
                              target_type, target_id, required_permission, outcome, detail)
       SELECT l.state_changed_at, 'seed-' || left(l.id::text, 12), $2, 'admin',
              'marketplace_listing_hidden', 'marketplace_listing', l.id,
              'marketplace_moderation.status', 'allowed',
              jsonb_build_object('reason', 'Verstoß gegen die Marktplatzregeln (Demo)',
                                 'statusFrom', 'active', 'statusTo', 'hidden')
         FROM marketplace_listings l
        WHERE l.id = ANY($1::uuid[]) AND l.state = 'hidden'`,
      [ids, moderator],
    )
    counts.audit_log += hides ?? 0
  }

  // An expired listing implies the job run that expired it. One run per
  // distinct moment, counting the listings it moved — the run brackets the
  // `state_changed_at` it stamped, because the job sets it to now() mid-run.
  const { rowCount: runs } = await pool.query(
    `INSERT INTO job_runs (job_name, started_at, finished_at, outcome, error, items_processed)
     SELECT 'marketplace-expiry', state_changed_at - interval '40 milliseconds',
            state_changed_at + interval '15 milliseconds', 'success', NULL, count(*)::int
       FROM marketplace_listings
      WHERE id = ANY($1::uuid[]) AND state = 'expired'
      GROUP BY state_changed_at`,
    [ids],
  )
  counts.job_runs += runs ?? 0

  // …and a run implies the job it belongs to. The server registers
  // PLATFORM_JOBS at boot, but the seed never boots it, so without this the
  // runs above would describe a job with no definition. Taken from
  // PLATFORM_JOBS rather than re-typed, so schedule and description cannot
  // drift from the code; `DO NOTHING` leaves a real definition's `enabled`
  // exactly as an operator set it.
  const expiryJob = PLATFORM_JOBS.find((j) => j.name === 'marketplace-expiry')
  if (expiryJob && (runs ?? 0) > 0) {
    await pool.query(
      `INSERT INTO job_definitions (name, schedule, enabled, description, last_run_at)
       SELECT $1, $2, true, $3, max(started_at) FROM job_runs WHERE job_name = $1
       ON CONFLICT (name) DO NOTHING`,
      [expiryJob.name, expiryJob.schedule, expiryJob.description],
    )
  }

  // ---- Reports: open ones only ----------------------------------------------
  //
  // An open report is state. An upheld or dismissed one implies a resolution
  // entry and a moderator decision, and inventing those is exactly what the
  // history rule forbids — the queue is what the demo needs to show.
  const reportable = listings.filter((l) => l.state === 'active').slice(0, 3)
  for (const [n, listing] of reportable.entries()) {
    const reporter = others[n % Math.max(1, others.length)]
    if (!reporter) break
    const { rowCount } = await pool.query(
      `INSERT INTO marketplace_reports (listing_id, reporter_id, reason, created_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [listing.id, reporter.id,
        faker.helpers.arrayElement(['Preis wirkt unrealistisch', 'Anzeige doppelt eingestellt', 'Kein Mitgliederangebot, sondern gewerblich']),
        new Date(listing.publishedAt!.getTime() + (n + 1) * DAY)],
    )
    counts.marketplace_reports += rowCount ?? 0
  }

  // ---- Conversations: the inbox is not empty --------------------------------
  //
  // Inquiries on active listings, plus one on a sold listing, because a
  // conversation outlives its listing (FR-027) and that screen needs a row.
  const inquired = [
    ...listings.filter((l) => l.state === 'active' && activePosters.some((p) => p.id === l.ownerId)).slice(0, 3),
    ...listings.filter((l) => l.state === 'sold').slice(0, 1),
  ]
  for (const [n, listing] of inquired.entries()) {
    const inquirer = others[(n + 3) % Math.max(1, others.length)]
    if (!inquirer) break

    // Within 20 hours of publication, and the thread spans at most four more:
    // a terminal state is stamped at least a day after publication, so the
    // conversation on the sold listing predates the sale, as it must have.
    const opened = new Date(listing.publishedAt!.getTime() + faker.number.int({ min: 1, max: 20 }) * 3_600_000)
    const { rows } = await pool.query(
      `INSERT INTO conversations (subject_type, subject_id, created_at, last_message_at)
       VALUES ('marketplace_listing', $1, $2, $2) RETURNING id`,
      [listing.id, opened],
    )
    const conversationId = rows[0].id
    counts.conversations += 1

    const thread = [
      [inquirer.id, 'Guten Tag, ist die Anzeige noch aktuell? Ich hätte großes Interesse.'],
      [listing.ownerId, 'Hallo, ja, noch verfügbar. Wann würde es Ihnen passen?'],
      [inquirer.id, 'Am Samstagvormittag ginge es bei mir. Passt das?'],
    ].slice(0, 2 + (n % 2))

    for (const [i, [sender, text]] of thread.entries()) {
      await pool.query(
        'INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4)',
        [conversationId, sender, text, new Date(opened.getTime() + i * 2 * 3_600_000)],
      )
      counts.messages += 1
    }

    // The ordering key is the newest message's own timestamp, read back from
    // the rows rather than recomputed — the same reason content.ts sums bytes
    // in SQL.
    await pool.query(
      `UPDATE conversations SET last_message_at = (SELECT max(created_at) FROM messages WHERE conversation_id = $1)
        WHERE id = $1`,
      [conversationId],
    )

    // The inquirer has read everything; the owner's last reply may be unread
    // on the odd threads, so the unread count has something to show.
    const { rowCount } = await pool.query(
      `INSERT INTO conversation_participants (conversation_id, member_id, joined_at, last_read_at)
       SELECT $1, p.member_id, $2, CASE WHEN p.reads THEN c.last_message_at END
         FROM conversations c,
              (VALUES ($3::uuid, true), ($4::uuid, $5::boolean)) AS p(member_id, reads)
        WHERE c.id = $1`,
      [conversationId, opened, inquirer.id, listing.ownerId, n % 2 === 0],
    )
    counts.conversation_participants += rowCount ?? 0
  }

  return counts
}

async function insertDetails(
  pool: Pool,
  faker: Faker,
  { id, category, index, counts }: {
    id: string; category: Category; index: number
    counts: Record<`marketplace_${Category}_details`, number>
  },
) {
  if (category === 'vehicle') {
    const [make, model, body] = MAKES[index % MAKES.length]!
    await pool.query(
      `INSERT INTO marketplace_vehicle_details (listing_id, make, model, year, mileage_km, price_minor,
                                                currency, fuel, transmission, body_type, condition)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, make, model, faker.number.int({ min: 2012, max: 2025 }), faker.number.int({ min: 5_000, max: 180_000 }),
        faker.number.int({ min: 40, max: 350 }) * 100_000, index % 4 === 0 ? 'EUR' : 'AED',
        faker.helpers.arrayElement(['petrol', 'diesel', 'hybrid', 'electric']),
        faker.helpers.arrayElement(['manual', 'automatic']), body, 'used'],
    )
    counts.marketplace_vehicle_details += 1
  } else if (category === 'property') {
    // Half-rooms are a real German convention, so some come out as x.5.
    const rooms = faker.helpers.arrayElement([1, 1.5, 2, 2.5, 3, 4, 5])
    const deal = index % 3 === 0 ? 'sale' : 'rent'
    await pool.query(
      `INSERT INTO marketplace_property_details (listing_id, deal, rooms, size_sqm, price_minor,
                                                 currency, city, postal_code, available_from)
       VALUES ($1, $2, $3, $4, $5, 'AED', $6, NULL, $7)`,
      [id, deal, rooms, rooms * faker.number.int({ min: 28, max: 45 }),
        deal === 'sale' ? faker.number.int({ min: 90, max: 600 }) * 1_000_000 : faker.number.int({ min: 60, max: 300 }) * 100_000,
        CITIES[index % CITIES.length], faker.date.soon({ days: 90 })],
    )
    counts.marketplace_property_details += 1
  } else if (category === 'job') {
    const min = faker.number.int({ min: 8, max: 30 }) * 100_000
    await pool.query(
      `INSERT INTO marketplace_job_details (listing_id, employment_type, seniority, department, city,
                                            remote, salary_min_minor, salary_max_minor, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'AED')`,
      [id, faker.helpers.arrayElement(['full_time', 'part_time', 'contract', 'internship']),
        faker.helpers.arrayElement(['junior', 'mid', 'senior', 'lead']),
        faker.helpers.arrayElement(['Finanzen', 'Marketing', 'Vertrieb', 'Technik']),
        CITIES[index % CITIES.length], faker.helpers.arrayElement(['onsite', 'hybrid', 'remote']),
        // Salary bounds ordered, as the CHECK requires — and a max that is
        // sometimes absent, because "from 12.000" is a real advert.
        min, index % 2 === 0 ? min + faker.number.int({ min: 2, max: 12 }) * 100_000 : null],
    )
    counts.marketplace_job_details += 1
  } else {
    const kind = index % 2 === 0 ? 'product' : 'service'
    await pool.query(
      `INSERT INTO marketplace_general_details (listing_id, kind, price_minor, currency, condition)
       VALUES ($1, $2::general_listing_kind, $3, 'AED', $4)`,
      [id, kind, faker.number.int({ min: 2, max: 150 }) * 1_000, kind === 'product' ? 'used' : 'n/a'],
    )
    counts.marketplace_general_details += 1
  }
}

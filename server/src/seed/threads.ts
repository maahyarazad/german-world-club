import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import type { Faker } from './faker.ts'
import type { SeedOptions } from './options.ts'

/**
 * Threads and profiles (features 009 and 010, research R15): handles, a few
 * avatars, a follow graph, posts with and without photos, replies, quotes,
 * likes, reposts, mentions, one influencer, and the public faces of the
 * active organisations.
 *
 * ── The consistent-history rule ─────────────────────────────────────────────
 * Two seeded facts imply history, because the application audits them:
 *   a post         → `thread_post_created` (compose.ts), by its author, at its
 *                    own `created_at`;
 *   an influencer  → `member.designation.granted` (designations.ts), by the
 *                    granting staff member, at `granted_at`, with its reason.
 * Both are derived in SQL from the rows themselves. Liking, reposting and
 * following write no audit entry in the application, so nothing is invented
 * for them. Blocks, mutes and the Activity cursor are left empty: no seeded
 * fact implies any of them.
 *
 * Every timestamp falls after both parties existed — a like predates neither
 * the post nor the member who liked it.
 */

const VARIANTS = [
  ['thumb', 'webp', 160, 120, 6_100],
  ['small', 'webp', 400, 300, 21_400],
  ['medium', 'webp', 800, 600, 54_800],
  ['large', 'webp', 1600, 1200, 172_000],
] as const

const DAY = 86_400_000

const POSTS = [
  'Wer ist heute Abend beim Stammtisch in der Marina dabei?',
  'Tipp für Neuankömmlinge: Die Emirates ID dauert gerade etwa zwei Wochen.',
  'Sonnenuntergang am Kite Beach. Nie langweilig.',
  'Does anyone know a good German bakery in Abu Dhabi?',
  'Heute unser erstes Jahr in Dubai gefeiert. Danke an alle, die uns so herzlich aufgenommen haben!',
  'Looking for a padel partner on weekday mornings.',
  'Das Oktoberfest-Menü im Club war großartig — gerne wieder.',
  'Our kids loved the Kinderfest last weekend.',
  'Suche Empfehlungen für eine Steuerberatung mit Deutschland-Bezug.',
  'Wüstentour am Wochenende — Fotos folgen.',
  'Great talk yesterday on moving a business to the UAE.',
  'Hat jemand Erfahrung mit der Anmeldung eines Autos aus Deutschland?',
]

const REPLIES = [
  'Bin dabei!', 'Sehr gerne, schreib mir.', 'Great tip, thanks!', 'Ich kann dir jemanden empfehlen.',
  'Wunderschön!', 'Count me in.', 'Das hat bei uns drei Wochen gedauert.', 'Absolutely agree.',
]

const QUOTES = ['Genau das!', 'Worth reading.', 'Das sollten alle Neuen wissen.', 'So true.']

const CITIES = ['Dubai', 'Abu Dhabi', 'Sharjah']

/** A valid, lowercase handle from an email's local part (026's CHECK). */
function handleFrom(local: string, n: number) {
  const base = local.toLowerCase().replace(/[^a-z0-9._]/g, '.').replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '')
  const trimmed = (base.length >= 3 ? base : `member.${base}`).slice(0, 24).replace(/\.+$/, '')
  return n === 0 ? trimmed : `${trimmed}_${n}`
}

export async function seedThreads(pool: Pool, faker: Faker, _options: SeedOptions) {
  const counts = {
    handles: 0,
    member_avatars: 0,
    member_links: 0,
    member_follows: 0,
    thread_posts: 0,
    thread_post_media: 0,
    thread_post_mentions: 0,
    thread_likes: 0,
    thread_reposts: 0,
    member_designations: 0,
    organisation_profiles: 0,
    assets: 0,
    asset_variants: 0,
    audit_log: 0,
    counters: 0,
  }

  // ---- Handles: every demo member, from their address ------------------------
  //
  // Deduplicated in order, so two addresses that normalise alike get _1, _2.
  // `handle_changed_at` is then set back to when the member joined: the
  // trigger stamps now(), which would lock every demo member out of changing
  // their handle for 30 days for no reason a member would recognise.
  const { rows: members } = await pool.query(
    `SELECT id, email, handle, status, created_at FROM members
      WHERE email LIKE '%@%demo.invalid' ORDER BY email`,
  )
  const { rows: taken } = await pool.query('SELECT lower(handle::text) AS h FROM members WHERE handle IS NOT NULL')
  const used = new Set(taken.map((r) => String(r.h)))
  for (const m of members) {
    if (m.handle) continue
    const local = String(m.email).split('@')[0]!
    let n = 0
    let handle = handleFrom(local, n)
    while (used.has(handle)) handle = handleFrom(local, (n += 1))
    used.add(handle)
    const { rowCount } = await pool.query(
      'UPDATE members SET handle = $2 WHERE id = $1 AND handle IS NULL',
      [m.id, handle],
    )
    await pool.query('UPDATE members SET handle_changed_at = created_at WHERE id = $1', [m.id])
    m.handle = handle
    counts.handles += rowCount ?? 0
  }

  const active = members.filter((m) => m.status === 'active')
  if (active.length < 3) return counts

  // ---- Organisation public profiles (US3/US4) ------------------------------
  const { rowCount: orgProfiles } = await pool.query(
    `INSERT INTO organisation_profiles (organisation_id, display_name, about, city, updated_at)
     SELECT o.id, left(o.legal_name, 120),
            CASE o.kind WHEN 'merchant' THEN 'Mitgliedervorteile für den German World Club.'
                        ELSE 'Corporate Partner des German World Club.' END,
            $1, o.status_changed_at
       FROM organisations o
      WHERE o.status = 'active'
     ON CONFLICT (organisation_id) DO NOTHING`,
    [CITIES[0]],
  )
  counts.organisation_profiles += orgProfiles ?? 0

  /**
   * Already seeded? The posts are the part with no natural key, so they are
   * the idempotency check — the same reasoning as marketplace.ts. Handles and
   * organisation profiles above are keyed and safe to re-run.
   */
  const { rows: seeded } = await pool.query(
    `SELECT count(*)::int AS n FROM thread_posts p JOIN members m ON m.id = p.author_id
      WHERE m.email LIKE '%@%demo.invalid'`,
  )
  if (seeded[0].n > 0) return counts

  const now = Date.now()
  const joined = (m: { created_at: Date }) => new Date(m.created_at).getTime()
  /** A moment after every one of `times`, and before now. */
  const after = (...times: number[]) => {
    const from = Math.max(...times, now - 45 * DAY)
    return new Date(faker.number.int({ min: from + 60_000, max: Math.max(from + 120_000, now - 60_000) }))
  }

  // ---- Photos, as each owner's own uploads ---------------------------------
  let photoSeq = 0
  const photo = async (ownerId: string, at: Date, alt: string) => {
    photoSeq += 1
    const { rows } = await pool.query(
      `INSERT INTO assets (kind, mime, checksum, bytes, width, height, alt, state,
                           uploaded_by, uploader_kind, storage_key, created_at)
       VALUES ('image', 'image/jpeg', $1, $2, 4000, 3000, $3, 'ready', $4, 'member', $5, $6)
       ON CONFLICT (checksum) DO NOTHING
       RETURNING id`,
      [
        createHash('sha256').update(`demo-thread-photo-${photoSeq}`).digest(),
        faker.number.int({ min: 900_000, max: 3_800_000 }),
        alt,
        ownerId,
        `demo/thread-${photoSeq}`,
        at,
      ],
    )
    if (rows.length === 0) return null
    counts.assets += 1
    for (const [variant, format, w, h, bytes] of VARIANTS) {
      const { rowCount } = await pool.query(
        `INSERT INTO asset_variants (asset_id, variant, format, width, height, bytes, storage_key)
         VALUES ($1, $2::asset_variant, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [rows[0].id, variant, format, w, h, bytes, `demo/thread-${photoSeq}-${variant}.${format}`],
      )
      counts.asset_variants += rowCount ?? 0
    }
    return String(rows[0].id)
  }

  // ---- Avatars and links for about a fifth of active members -----------------
  for (const [i, m] of active.entries()) {
    if (i % 5 !== 0) continue
    const asset = await photo(m.id, after(joined(m)), `Profilbild`)
    if (asset) {
      const { rowCount } = await pool.query(
        'INSERT INTO member_avatars (member_id, asset_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [m.id, asset],
      )
      counts.member_avatars += rowCount ?? 0
    }
    const { rowCount } = await pool.query(
      `INSERT INTO member_links (member_id, position, url, label) VALUES ($1, 0, $2, 'LinkedIn') ON CONFLICT DO NOTHING`,
      [m.id, `https://www.linkedin.com/in/${m.handle}`],
    )
    counts.member_links += rowCount ?? 0
  }

  // ---- Follow graph: each active member follows three to eight others -------
  for (const m of active) {
    for (const other of faker.helpers.arrayElements(active.filter((o) => o.id !== m.id), { min: 3, max: Math.min(8, active.length - 1) })) {
      const { rowCount } = await pool.query(
        `INSERT INTO member_follows (follower_id, followee_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [m.id, other.id, after(joined(m), joined(other))],
      )
      counts.member_follows += rowCount ?? 0
    }
  }

  /**
   * One post, its media and its mentions in ONE transaction — the database
   * refuses media attached in any other (027_threads_social.sql), exactly as
   * it does for the application.
   */
  type Seeded = { id: string; authorId: string; at: number }
  const createPost = async (
    author: { id: string },
    { body, at, replyTo, quoteOf, photos = 0, mention }:
      { body: string; at: Date; replyTo?: Seeded; quoteOf?: Seeded; photos?: number; mention?: { id: string; handle: string } },
  ): Promise<Seeded> => {
    const assetIds: string[] = []
    for (let i = 0; i < photos; i += 1) {
      const id = await photo(author.id, new Date(at.getTime() - 60_000), `Foto ${i + 1}`)
      if (id) assetIds.push(id)
    }
    const text = mention ? `${body} @${mention.handle}` : body
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `INSERT INTO thread_posts (author_id, body, reply_to_id, root_id, quote_of_id, created_at, state_changed_at)
         VALUES ($1, $2, $3, (SELECT coalesce(root_id, id) FROM thread_posts WHERE id = $3), $4, $5, $5)
         RETURNING id`,
        [author.id, text, replyTo?.id ?? null, quoteOf?.id ?? null, at],
      )
      const id = String(rows[0].id)
      for (const [position, assetId] of assetIds.entries()) {
        await client.query('INSERT INTO thread_post_media (post_id, asset_id, position) VALUES ($1, $2, $3)', [id, assetId, position])
        counts.thread_post_media += 1
      }
      if (mention) {
        await client.query(
          'INSERT INTO thread_post_mentions (post_id, member_id, handle_as_written, created_at) VALUES ($1, $2, $3, $4)',
          [id, mention.id, mention.handle, at],
        )
        counts.thread_post_mentions += 1
      }
      await client.query('COMMIT')
      counts.thread_posts += 1
      return { id, authorId: author.id, at: at.getTime() }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // ---- Posts, replies, quotes ------------------------------------------------
  const roots: Seeded[] = []
  for (const [i, body] of POSTS.entries()) {
    const author = active[i % active.length]!
    const mentioned = i % 4 === 1 ? active[(i + 3) % active.length] : undefined
    roots.push(await createPost(author, {
      body,
      at: after(joined(author)),
      photos: i % 3 === 2 ? 1 + (i % 4) : 0,
      mention: mentioned && mentioned.id !== author.id ? { id: mentioned.id, handle: mentioned.handle } : undefined,
    }))
  }
  const replies: Seeded[] = []
  for (const [i, root] of roots.entries()) {
    for (let r = 0; r < 1 + (i % 3); r += 1) {
      const author = active[(i + r + 1) % active.length]!
      // The third reply answers the one before it, so it must be dated after
      // THAT reply, not merely after the root.
      const parent = r === 2 && replies.length > 0 ? replies[replies.length - 1]! : root
      replies.push(await createPost(author, {
        body: REPLIES[(i + r) % REPLIES.length]!,
        at: after(parent.at, joined(author)),
        replyTo: parent,
      }))
    }
  }
  for (const [i, body] of QUOTES.entries()) {
    const quoted = roots[(i * 3) % roots.length]!
    const author = active[(i + 5) % active.length]!
    await createPost(author, { body, at: after(quoted.at, joined(author)), quoteOf: quoted })
  }

  // ---- Likes and reposts, after the post and the member ----------------------
  for (const post of [...roots, ...replies]) {
    for (const m of faker.helpers.arrayElements(active, { min: 0, max: Math.min(6, active.length) })) {
      if (m.id === post.authorId) continue
      const { rowCount } = await pool.query(
        'INSERT INTO thread_likes (post_id, member_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [post.id, m.id, after(post.at, joined(m))],
      )
      counts.thread_likes += rowCount ?? 0
    }
  }
  for (const [i, post] of roots.entries()) {
    if (i % 3 !== 0) continue
    const m = active[(i + 2) % active.length]!
    if (m.id === post.authorId) continue
    const { rowCount } = await pool.query(
      'INSERT INTO thread_reposts (post_id, member_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [post.id, m.id, after(post.at, joined(m))],
    )
    counts.thread_reposts += rowCount ?? 0
  }

  // ---- History the posts imply: one `thread_post_created` each -------------
  //
  // At the post's own `created_at`, by its author — what compose.ts writes
  // when a member posts. Read back from the rows, never re-typed.
  const { rowCount: postEntries } = await pool.query(
    `INSERT INTO audit_log (occurred_at, request_id, actor_id, actor_kind, action,
                            target_type, target_id, outcome)
     SELECT p.created_at, 'seed-' || left(p.id::text, 12), p.author_id, 'member',
            'thread_post_created', 'thread_post', p.id, 'allowed'
       FROM thread_posts p JOIN members m ON m.id = p.author_id
      WHERE m.email LIKE '%@%demo.invalid'`,
  )
  counts.audit_log += postEntries ?? 0

  // ---- The storage quota, recomputed from what each uploader now owns ------
  const uploaders = [...new Set(active.map((m) => String(m.id)))]
  const { rowCount: counterRows } = await pool.query(
    `INSERT INTO counters (scope, subject, used, updated_at)
     SELECT 'media.stored_bytes', uploaded_by::text, sum(bytes), max(created_at)
       FROM assets WHERE uploaded_by = ANY($1::uuid[])
      GROUP BY uploaded_by
     ON CONFLICT (scope, subject) DO UPDATE SET used = EXCLUDED.used, updated_at = EXCLUDED.updated_at`,
    [uploaders],
  )
  counts.counters += counterRows ?? 0

  // ---- One influencer, granted by staff who may, with its audit entry --------
  const { rows: granters } = await pool.query(
    `SELECT a.id FROM admin_users a
       LEFT JOIN admin_permissions p ON p.admin_user_id = a.id AND p.module = 'members' AND p.can_write
      WHERE a.email LIKE '%@staff.demo.invalid' AND (p.admin_user_id IS NOT NULL OR a.is_superadmin)
      ORDER BY (p.admin_user_id IS NOT NULL) DESC, a.email LIMIT 1`,
  )
  const influencer = active[1]
  if (granters[0] && influencer) {
    const { rows } = await pool.query(
      `INSERT INTO member_designations (member_id, designation, granted_at, granted_by, grant_reason)
       VALUES ($1, 'influencer', $2, $3, 'Community-Botschafterin (Demo)')
       ON CONFLICT (member_id, designation) WHERE revoked_at IS NULL DO NOTHING
       RETURNING id`,
      [influencer.id, after(joined(influencer)), granters[0].id],
    )
    if (rows[0]) {
      counts.member_designations += 1
      // The history the grant implies: at the grant's own time, with its own
      // reason, read back from the row rather than re-typed here.
      const { rowCount } = await pool.query(
        `INSERT INTO audit_log (occurred_at, request_id, actor_id, actor_kind, action,
                                target_type, target_id, outcome, detail)
         SELECT d.granted_at, 'seed-' || left(d.id::text, 12), d.granted_by, 'admin',
                'member.designation.granted', 'member', d.member_id, 'allowed',
                jsonb_build_object('designation', d.designation::text, 'reason', d.grant_reason, 'designationId', d.id)
           FROM member_designations d WHERE d.id = $1`,
        [rows[0].id],
      )
      counts.audit_log += rowCount ?? 0
    }
  }

  return counts
}

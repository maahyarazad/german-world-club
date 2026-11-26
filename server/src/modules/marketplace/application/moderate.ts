import { PROBLEMS } from '@gwc/contracts/errors'
import { DISABLEABLE_STATES } from '@gwc/contracts/marketplace'
import { withTransaction, query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'

/**
 * Staff moderation (US4, FR-016…FR-018, contracts/moderation-api.md).
 *
 * `write` and `edit` are unused on this module, on purpose: staff hide,
 * restore or remove a listing, and resolve a report. Nothing here rewrites
 * what a member said — `tests/marketplace/moderation.test.ts`'s counter-
 * assertion is that no endpoint in this file can touch `title` or `body`.
 *
 * **Every action writes to the append-only audit log**, after its own
 * transaction commits, never inside it — see `manage.ts`'s note on why an
 * audit entry must not become durable independently of whether the state
 * change it describes actually did.
 */

export class ListingNotFoundError extends Error {
  constructor() {
    super('No such listing.')
    this.name = 'ListingNotFoundError'
  }
}

export class ReasonRequiredError extends Error {
  constructor() {
    super('A reason is required.')
    this.name = 'ReasonRequiredError'
  }
}

export class AlreadyReportedError extends Error {
  constructor() {
    super('You already have an open report on this listing.')
    this.name = 'AlreadyReportedError'
  }
}

export class ReportNotFoundError extends Error {
  constructor() {
    super('No such report.')
    this.name = 'ReportNotFoundError'
  }
}

const requireReason = (reason: unknown): string => {
  const trimmed = String(reason ?? '').trim()
  // A hide or remove with no reason is indistinguishable from a mistake six
  // months later (§8) — refused here rather than left to a NOT NULL column,
  // which would accept whitespace.
  if (trimmed.length < 3) throw new ReasonRequiredError()
  return trimmed
}

/** `GET /admin/marketplace/listings/:id` — staff may see a hidden listing too. */
export async function loadForModeration(
  app: GwcApp,
  { listingId, signal }: { listingId: string; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    `SELECT l.id, l.owner_id, l.category, l.mode, l.title, l.body, l.state,
            l.contact_method, l.created_at, l.published_at, l.expires_at,
            l.state_changed_at, l.hidden_from_state, m.display_name AS owner_display_name,
            (SELECT count(*)::int FROM marketplace_reports r
              WHERE r.listing_id = l.id AND r.state = 'open') AS open_reports
       FROM marketplace_listings l
       JOIN members m ON m.id = l.owner_id
      WHERE l.id = $1::uuid`,
    [listingId],
    { signal },
  )
  const row = rows[0]
  if (!row) throw new ListingNotFoundError()
  return row
}

export async function hideListing(
  app: GwcApp,
  { listingId, actorId, reason, requestId, signal }:
    { listingId: string; actorId: string; reason: string; requestId?: string; signal?: AbortSignal },
) {
  const safeReason = requireReason(reason)
  let previousState = ''

  const changed = await withTransaction(app.pg, async (client: PoolClient) => {
    const { rows } = await client.query(
      `SELECT id, state FROM marketplace_listings WHERE id = $1::uuid FOR UPDATE`,
      [listingId],
    )
    const row = rows[0]
    if (!row) throw new ListingNotFoundError()
    // A draft can be disabled too (feature 037): a listing nobody can see yet
    // can still be the record that is wrong, and disabling it stops its owner
    // publishing it. Every other state is already off display.
    if (!(DISABLEABLE_STATES as readonly string[]).includes(String(row.state))) {
      throw forbidden(PROBLEMS.VALIDATION_FAILED, `Cannot hide a "${row.state}" listing.`)
    }
    previousState = String(row.state)

    // `hidden_from_state` remembers where it came from, so enabling puts it
    // back there — and never publishes a draft.
    const { rows: updated } = await client.query(
      `UPDATE marketplace_listings
          SET state = 'hidden', hidden_from_state = $2::marketplace_state,
              state_changed_at = now(), updated_at = now()
        WHERE id = $1::uuid RETURNING id, state, state_changed_at`,
      [listingId, previousState],
    )
    return updated[0]!
  }, { signal })

  await app.audit({
    action: 'marketplace_listing_hidden', requestId,
    actorId, actorKind: 'admin',
    targetType: 'marketplace_listing', targetId: listingId,
    requiredPermission: 'marketplace_moderation.status',
    detail: { reason: safeReason, statusFrom: previousState, statusTo: 'hidden' },
  })

  return changed
}

/** Reachable only from `hidden` — the state machine's one reverse edge. */
export async function restoreListing(
  app: GwcApp,
  { listingId, actorId, reason, requestId, signal }:
    { listingId: string; actorId: string; reason: string; requestId?: string; signal?: AbortSignal },
) {
  const safeReason = requireReason(reason)

  let restoredTo = 'active'
  const changed = await withTransaction(app.pg, async (client: PoolClient) => {
    const { rows } = await client.query(
      `SELECT id, state, hidden_from_state FROM marketplace_listings WHERE id = $1::uuid FOR UPDATE`,
      [listingId],
    )
    const row = rows[0]
    if (!row) throw new ListingNotFoundError()
    if (row.state !== 'hidden') throw forbidden(PROBLEMS.VALIDATION_FAILED, `Cannot restore a "${row.state}" listing.`)

    // Back to where the owner left it. NULL is a listing hidden before the
    // column existed, which always came back as `active`.
    restoredTo = String(row.hidden_from_state ?? 'active')

    const { rows: updated } = await client.query(
      `UPDATE marketplace_listings
          SET state = $2::marketplace_state, hidden_from_state = NULL,
              state_changed_at = now(), updated_at = now()
        WHERE id = $1::uuid RETURNING id, state, state_changed_at`,
      [listingId, restoredTo],
    )
    return updated[0]!
  }, { signal })

  await app.audit({
    action: 'marketplace_listing_restored', requestId,
    actorId, actorKind: 'admin',
    targetType: 'marketplace_listing', targetId: listingId,
    requiredPermission: 'marketplace_moderation.status',
    detail: { reason: safeReason, statusFrom: 'hidden', statusTo: restoredTo },
  })

  return changed
}

/**
 * Remove a listing outright — `marketplace_moderation:delete`, distinct from
 * `status`. Members never hard-delete their own (FR-005); this is the one
 * path that can, and it exists for content staff must be able to remove
 * regardless of what state it is in — a report can land on any state.
 */
export async function removeListing(
  app: GwcApp,
  { listingId, actorId, reason, requestId, signal }:
    { listingId: string; actorId: string; reason: string; requestId?: string; signal?: AbortSignal },
) {
  const safeReason = requireReason(reason)

  await withTransaction(app.pg, async (client: PoolClient) => {
    const { rows } = await client.query(
      `DELETE FROM marketplace_listings WHERE id = $1::uuid RETURNING id`,
      [listingId],
    )
    if (rows.length === 0) throw new ListingNotFoundError()
  }, { signal })

  await app.audit({
    action: 'marketplace_listing_removed', requestId,
    actorId, actorKind: 'admin',
    targetType: 'marketplace_listing', targetId: listingId,
    requiredPermission: 'marketplace_moderation.delete',
    detail: { reason: safeReason },
  })

  return { id: listingId, removed: true }
}

/** `POST /marketplace/listings/:id/report` — a member reporting a listing. */
export async function reportListing(
  app: GwcApp,
  { listingId, reporterId, reason, signal }:
    { listingId: string; reporterId: string; reason: string; signal?: AbortSignal },
) {
  const safeReason = requireReason(reason)

  return withTransaction(app.pg, async (client: PoolClient) => {
    const { rows: listing } = await client.query(
      'SELECT id FROM marketplace_listings WHERE id = $1::uuid', [listingId],
    )
    if (listing.length === 0) throw new ListingNotFoundError()

    // One open report per member per listing — a second complaint about the
    // same listing does not need a second row; it needs staff to act on the
    // first one faster.
    const { rows: existing } = await client.query(
      `SELECT 1 FROM marketplace_reports WHERE listing_id = $1::uuid AND reporter_id = $2::uuid AND state = 'open'`,
      [listingId, reporterId],
    )
    if (existing.length > 0) throw new AlreadyReportedError()

    const { rows } = await client.query(
      `INSERT INTO marketplace_reports (listing_id, reporter_id, reason)
       VALUES ($1::uuid, $2::uuid, $3) RETURNING id, listing_id, state, created_at`,
      [listingId, reporterId, safeReason],
    )
    return rows[0]!
  }, { signal })
}

/** `GET /admin/marketplace/reports` — the moderation queue. */
export async function listReports(
  app: GwcApp,
  { state, signal }: { state?: string; signal?: AbortSignal } = {},
) {
  const { rows } = await query(
    app.pg,
    `SELECT r.id, r.listing_id, r.reporter_id, r.reason, r.state,
            r.created_at, r.resolved_at, r.resolved_by,
            l.title AS listing_title, l.state AS listing_state
       FROM marketplace_reports r
       JOIN marketplace_listings l ON l.id = r.listing_id
      WHERE ($1::report_state IS NULL OR r.state = $1::report_state)
      ORDER BY r.created_at DESC`,
    [state ?? null],
    { signal },
  )
  return rows
}

/** `POST /admin/marketplace/reports/:id/resolve` — `upheld` or `dismissed`. */
export async function resolveReport(
  app: GwcApp,
  { reportId, actorId, outcome, reason, requestId, signal }: {
    reportId: string; actorId: string; outcome: 'upheld' | 'dismissed';
    reason: string; requestId?: string; signal?: AbortSignal
  },
) {
  const safeReason = requireReason(reason)

  const resolved = await withTransaction(app.pg, async (client: PoolClient) => {
    const { rows } = await client.query(
      `SELECT id, state FROM marketplace_reports WHERE id = $1::uuid FOR UPDATE`,
      [reportId],
    )
    if (rows.length === 0) throw new ReportNotFoundError()

    const { rows: updated } = await client.query(
      `UPDATE marketplace_reports
          SET state = $2, resolved_at = now(), resolved_by = $3::uuid
        WHERE id = $1::uuid
        RETURNING id, listing_id, state, resolved_at`,
      [reportId, outcome, actorId],
    )
    return updated[0]!
  }, { signal })

  await app.audit({
    action: 'marketplace_report_resolved', requestId,
    actorId, actorKind: 'admin',
    targetType: 'marketplace_report', targetId: reportId,
    requiredPermission: 'marketplace_moderation.status',
    detail: { reason: safeReason },
  })

  return resolved
}

// ---------------------------------------------------------------------------
// The staff listing browser (feature 037)
// ---------------------------------------------------------------------------

export type StaffListingFilters = {
  state?: string
  category?: string
  ownerId?: string
  q?: string
  /** Already decoded and bounded by the controller. */
  cursor?: { createdAt: string; id: string } | null
  limit: number
  signal?: AbortSignal
}

/**
 * Every member listing in every state, newest first — keyset paged on
 * (created_at, id), never OFFSET, so page 400 costs what page 1 does.
 *
 * Reads `marketplace_listings` only, so a merchant offer cannot appear: those
 * live in their own tables. Columns are named, and the member's contact
 * details are not among them — the owner is `id` and display name, nothing
 * else. This is a list, not a place to read what was written: the body text is
 * left out, and the one-listing read stays the way to open it.
 */
export async function browseForModeration(app: GwcApp, f: StaffListingFilters) {
  const where: string[] = []
  const params: unknown[] = []
  const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)) }

  if (f.state) add('l.state = ?::marketplace_state', f.state)
  if (f.category) add('l.category = ?::marketplace_category', f.category)
  if (f.ownerId) add('l.owner_id = ?::uuid', f.ownerId)
  if (f.q) {
    // `%` and `_` are wildcards in LIKE. A search for "50%" must find "50%",
    // not everything starting with 50, so they are escaped before use.
    add(`l.title ILIKE ? ESCAPE '\\'`, `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
  }
  if (f.cursor) {
    params.push(f.cursor.createdAt, f.cursor.id)
    where.push(`(l.created_at, l.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
  }
  params.push(f.limit + 1)

  const { rows } = await query(
    app.pg,
    `SELECT l.id, l.title, l.category, l.mode, l.state, l.hidden_from_state,
            l.created_at, l.published_at, l.expires_at, l.state_changed_at,
            -- The paging key at full microsecond precision. A JavaScript Date
            -- keeps milliseconds, so two rows created within one would be
            -- skipped or repeated at a page boundary.
            to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
            m.id AS owner_id, m.display_name AS owner_display_name,
            (SELECT count(*)::int FROM marketplace_reports r
              WHERE r.listing_id = l.id AND r.state = 'open') AS open_reports
       FROM marketplace_listings l
       JOIN members m ON m.id = l.owner_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $${params.length}`,
    params,
    { signal: f.signal },
  )
  return rows
}

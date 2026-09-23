import { PROBLEMS } from '@gwc/contracts/errors'
import { withTransaction, query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { validateDetails, detailColumns, DETAIL_TABLE } from '../categories.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'
import type { MarketplaceCategory, ListingDetails } from '@gwc/contracts/marketplace'

/**
 * Owning your own listings (US3, FR-003, FR-004, FR-028, FR-030).
 *
 * Every function here loads the row with `FOR UPDATE` and checks
 * `owner_id` against the caller **inside the transaction** — never as a
 * separate SELECT a moment before, and never trusted from anything the client
 * sent. A route-level declaration cannot express "yours"; this is where that
 * rule actually lives (Principle II).
 *
 * **Every refusal on someone else's listing is 404, never 403.** A 403 would
 * confirm the id belongs to a real listing, which is exactly what
 * `guardOrganisationScope` exists to prevent elsewhere in this codebase — the
 * same reasoning, applied here because ownership is itself the fact being
 * protected (SC-006).
 */

/** States an owner may transition *into* from `active`. Terminal — see data-model.md §7. */
const OWNER_TRANSITIONS = Object.freeze(['sold', 'filled', 'withdrawn'])

export class ListingNotFoundError extends Error {
  constructor() {
    // One message for "not yours" and "does not exist" — see the class doc.
    super('No such listing.')
    this.name = 'ListingNotFoundError'
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot move a "${from}" listing to "${to}".`)
    this.name = 'InvalidTransitionError'
  }
}

export class DetailsInvalidError extends Error {
  readonly problems: { field: string; reason: string }[]
  constructor(problems: { field: string; reason: string }[]) {
    super(`Invalid ${problems.length === 1 ? 'field' : 'fields'}: ${problems.map((p) => p.field).join(', ')}`)
    this.name = 'DetailsInvalidError'
    this.problems = problems
  }
}

/** Load a listing FOR UPDATE and assert the caller owns it. 404 on any mismatch. */
async function loadOwned(client: PoolClient, { listingId, ownerId }: { listingId: string; ownerId: string }) {
  const { rows } = await client.query(
    `SELECT id, owner_id, category, mode, title, body, state, contact_method,
            expires_at, published_at, created_at
       FROM marketplace_listings
      WHERE id = $1::uuid
      FOR UPDATE`,
    [listingId],
  )
  const row = rows[0]
  // Genuinely absent and "belongs to someone else" produce the SAME error —
  // that identity is the point (SC-006).
  if (!row || String(row.owner_id) !== ownerId) throw new ListingNotFoundError()
  return row
}

export type EditInput = {
  listingId: string
  ownerId: string
  title?: string
  body?: string
  category?: MarketplaceCategory
  details?: ListingDetails
  features?: readonly string[]
  contactMethod?: string
  signal?: AbortSignal
}

/**
 * Edit a listing's own fields, and — if the category changes — its detail row.
 *
 * A category change deletes the old detail row and inserts a fresh one (T074).
 * Anything less would leave fields from the old category sitting in a table
 * they no longer belong to: a `property` listing's `price_minor` surviving a
 * change to `job`, invisible to validation because `job`'s fields are a
 * different set, and readable forever by anyone who queried the raw table.
 */
export async function editListing(app: GwcApp, input: EditInput) {
  const { listingId, ownerId, signal } = input

  return withTransaction(app.pg, async (client: PoolClient) => {
    const row = await loadOwned(client, { listingId, ownerId })
    const category = (input.category ?? row.category) as MarketplaceCategory
    const categoryChanged = input.category !== undefined && input.category !== row.category

    // Validated against the FINAL category, whether or not it changed — an
    // edit that only touches `title` on a `job` listing still owes `job` a
    // complete, valid detail row afterward.
    if (input.details !== undefined || categoryChanged) {
      const problems = validateDetails(category, input.details ?? {})
      if (problems.length > 0) throw new DetailsInvalidError(problems)
    }

    const sets: string[] = []
    const params: unknown[] = [listingId]
    const set = (column: string, value: unknown) => {
      params.push(value)
      sets.push(`${column} = $${params.length}`)
    }

    if (input.title !== undefined) set('title', input.title)
    if (input.body !== undefined) set('body', input.body)
    if (input.contactMethod !== undefined) set('contact_method', input.contactMethod)
    if (categoryChanged) set('category', category)

    if (sets.length > 0) {
      await client.query(
        `UPDATE marketplace_listings SET ${sets.join(', ')}, updated_at = now() WHERE id = $1::uuid`,
        params,
      )
    }

    if (categoryChanged || input.details !== undefined) {
      // DELETE then INSERT, not UPSERT: an UPSERT would keep whatever the old
      // row had for a column the new payload omits, which is precisely the
      // stale-field leak this task exists to close.
      await client.query(`DELETE FROM ${DETAIL_TABLE[row.category as MarketplaceCategory]} WHERE listing_id = $1::uuid`, [listingId])

      const { columns, values } = detailColumns(category, input.details ?? {})
      const table = DETAIL_TABLE[category]
      if (columns.length > 0) {
        const placeholders = values.map((_, i) => `$${i + 2}`).join(', ')
        await client.query(
          `INSERT INTO ${table} (listing_id, ${columns.join(', ')}) VALUES ($1, ${placeholders})`,
          [listingId, ...values],
        )
      } else {
        await client.query(`INSERT INTO ${table} (listing_id) VALUES ($1)`, [listingId])
      }

      // A category change orphans the old vehicle-feature rows on FK cascade
      // when leaving `vehicle`; entering it starts with none, which is
      // correct — features were never asked for in this edit.
      if (row.category === 'vehicle' && category !== 'vehicle') {
        await client.query('DELETE FROM marketplace_vehicle_features WHERE listing_id = $1::uuid', [listingId])
      }
    }

    if (category === 'vehicle' && input.features !== undefined) {
      await client.query('DELETE FROM marketplace_vehicle_features WHERE listing_id = $1::uuid', [listingId])
      if (input.features.length > 0) {
        await client.query(
          `INSERT INTO marketplace_vehicle_features (listing_id, feature_id)
           SELECT $1, id FROM vehicle_features WHERE key = ANY($2::citext[]) AND retired_at IS NULL`,
          [listingId, input.features],
        )
      }
    }

    const { rows: after } = await client.query(
      `SELECT id, category, mode, title, body, state, contact_method,
              created_at, published_at, expires_at
         FROM marketplace_listings WHERE id = $1::uuid`,
      [listingId],
    )
    return after[0]!
  }, { signal })
}

/**
 * Move a listing to a terminal state the owner controls.
 *
 * Only from `active`, and only to `sold`, `filled` or `withdrawn` — `hidden`
 * is moderation's alone, reachable from nowhere in this function, and there is
 * no transition OUT of a terminal state here either (data-model.md §7: "a sold
 * listing is not re-posted; a new listing is").
 */
export async function transitionState(
  app: GwcApp,
  { listingId, ownerId, to, signal }: { listingId: string; ownerId: string; to: string; signal?: AbortSignal },
) {
  if (!OWNER_TRANSITIONS.includes(to)) {
    throw forbidden(PROBLEMS.VALIDATION_FAILED, `"${to}" is not a state a member may set.`)
  }

  let previousState = ''
  const result = await withTransaction(app.pg, async (client: PoolClient) => {
    const row = await loadOwned(client, { listingId, ownerId })
    if (row.state !== 'active') throw new InvalidTransitionError(String(row.state), to)
    previousState = String(row.state)

    const { rows } = await client.query(
      `UPDATE marketplace_listings
          SET state = $2, state_changed_at = now(), updated_at = now()
        WHERE id = $1::uuid
        RETURNING id, state, state_changed_at`,
      [listingId, to],
    )
    return rows[0]!
  }, { signal })

  // AFTER the transaction commits, not inside it. `app.audit` writes on its
  // own connection — calling it from inside `fn` would let the entry become
  // durable independently of whether COMMIT itself later succeeds, which is
  // how a rolled-back transition ends up with a phantom audit row for a
  // change that never happened.
  //
  // data-model.md §9: "every transition writes state_changed_at and an audit
  // entry." The owner triggered this one; the expiry job's is tracked through
  // job_runs instead, the mechanism every job in this codebase already uses
  // for its own accountability.
  await app.audit({
    action: 'marketplace_listing_state_changed',
    actorId: ownerId, actorKind: 'member',
    targetType: 'marketplace_listing', targetId: listingId,
    // `from`/`to` would be silently stripped: `ops/audit.ts`'s
    // `SAFE_DETAIL_KEYS` is an allowlist, not a denylist, and these are the
    // names it already reserves for exactly this shape.
    detail: { statusFrom: previousState, statusTo: to },
  })

  return result
}

/**
 * Set or clear an expiry on an owned listing.
 *
 * `null` is accepted explicitly and means unlimited — a first-class choice a
 * member may return to at any time (FR-030), not the absence of an answer.
 */
export async function setExpiry(
  app: GwcApp,
  { listingId, ownerId, expiresAt, signal }:
    { listingId: string; ownerId: string; expiresAt: string | null; signal?: AbortSignal },
) {
  return withTransaction(app.pg, async (client: PoolClient) => {
    await loadOwned(client, { listingId, ownerId })
    // The full row, not just the changed column: the controller folds this
    // into the same PATCH response as editListing, and a caller who set title
    // and cleared the expiry in one request should get one consistent listing
    // back, not two different shapes depending on which fields they sent.
    const { rows } = await client.query(
      `UPDATE marketplace_listings SET expires_at = $2, updated_at = now()
        WHERE id = $1::uuid
        RETURNING id, category, mode, title, body, state, contact_method,
                  created_at, published_at, expires_at`,
      [listingId, expiresAt],
    )
    return rows[0]!
  }, { signal })
}

/** `GET /marketplace/mine` — every state, because the owner must see hidden and withdrawn too. */
export async function myListings(
  app: GwcApp,
  { ownerId, signal }: { ownerId: string; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    `SELECT id, category, mode, title, body, state, contact_method,
            created_at, published_at, expires_at, state_changed_at
       FROM marketplace_listings
      WHERE owner_id = $1::uuid
      ORDER BY state_changed_at DESC`,
    [ownerId],
    { signal },
  )
  return rows
}

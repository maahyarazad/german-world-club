import { PROBLEMS } from '@gwc/contracts/errors'
import { withTransaction, query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { validateDetails, detailColumns, DETAIL_TABLE } from '../categories.ts'
import { ListingModeNotAllowedError, modeAllowed } from './create.ts'
import { mediaForListings } from './media.ts'
import { assertEditable } from './editable.ts'
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

const staleVersion = () =>
  forbidden(PROBLEMS.CONFLICT, 'This listing was changed elsewhere. Reload it and try again.')

/**
 * A listing's version token (feature 037, research R5): `updated_at` formatted
 * by the database to the microsecond. A JavaScript `Date` keeps only
 * milliseconds, so two edits inside one millisecond would compare equal — the
 * same reason feature 028 formats an admin account's version this way.
 */
export const LISTING_VERSION_SQL =
  `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`


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
            expires_at, published_at, created_at, ${LISTING_VERSION_SQL} AS version
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
  /** The `version` the caller last read; a different one means someone else got there first. */
  version: string
  /** `true` publishes, `false` unpublishes, absent leaves the state alone (feature 037). */
  published?: boolean
  title?: string
  body?: string
  category?: MarketplaceCategory
  details?: ListingDetails
  features?: readonly string[]
  contactMethod?: string
  /**
   * `null` clears the expiry to unlimited. Present-and-undefined is NOT the
   * same as absent, so the caller passes the key only when the request had it
   * (`'expiresAt' in input` below) — FR-030 depends on telling those apart.
   */
  expiresAt?: string | null
  signal?: AbortSignal
}

/**
 * Edit a listing's own fields, its expiry and whether it is published — all in
 * ONE transaction, so a save either changes everything the form sent or
 * nothing, and the version moves once.
 *
 * Order of refusals, on purpose: not yours (404) → not editable (409) → stale
 * (409). The owner of a listing staff just disabled must hear "disabled", not
 * "reload", because reloading would not help.
 *
 * A category change deletes the old detail row and inserts a fresh one (T074).
 * Anything less would leave fields from the old category sitting in a table
 * they no longer belong to: a `property` listing's `price_minor` surviving a
 * change to `job`, invisible to validation because `job`'s fields are a
 * different set, and readable forever by anyone who queried the raw table.
 */
export async function editListing(app: GwcApp, input: EditInput) {
  const { listingId, ownerId, signal } = input
  let stateFrom = ''
  let stateTo = ''

  const result = await withTransaction(app.pg, async (client: PoolClient) => {
    const row = await loadOwned(client, { listingId, ownerId })
    stateFrom = String(row.state)
    assertEditable(stateFrom)
    if (row.version !== input.version) throw staleVersion()

    const category = (input.category ?? row.category) as MarketplaceCategory
    const categoryChanged = input.category !== undefined && input.category !== row.category

    // Mode is not editable, so the only way an edit makes a job offer is a
    // category change (feature 021). Checked only on a change: a job offer
    // that predates the rule may still have its text and details edited.
    if (categoryChanged && !modeAllowed(category, row.mode)) {
      throw new ListingModeNotAllowedError(category, row.mode)
    }

    // Validated against the FINAL category, whether or not it changed — an
    // edit that only touches `title` on a `job` listing still owes `job` a
    // complete, valid detail row afterward.
    if (input.details !== undefined || categoryChanged) {
      const problems = validateDetails(category, input.details ?? {})
      if (problems.length > 0) throw new DetailsInvalidError(problems)
    }

    // ---- Expiry ------------------------------------------------------------
    const expiryGiven = 'expiresAt' in input
    let expiresAt: Date | null = row.expires_at ?? null
    if (expiryGiven) {
      if (input.expiresAt === null || input.expiresAt === undefined) expiresAt = null
      else {
        const parsed = new Date(input.expiresAt)
        if (Number.isNaN(parsed.getTime())) throw new DetailsInvalidError([{ field: 'expiresAt', reason: 'is not a valid date' }])
        expiresAt = parsed
      }
    }

    // ---- Publication -------------------------------------------------------
    // `published: true` makes a draft or an expired listing live. An active one
    // is already; `hidden` never reaches here (assertEditable). `false` takes a
    // live listing back to a private draft and leaves everything else alone —
    // an expired listing is already off display, so unpublishing it is a no-op.
    let nextState = stateFrom
    if (input.published === true && (stateFrom === 'draft' || stateFrom === 'expired')) nextState = 'active'
    if (input.published === false && stateFrom === 'active') nextState = 'draft'
    stateTo = nextState

    if (nextState === 'active' && stateFrom !== 'active' && expiresAt !== null && expiresAt.getTime() <= Date.now()) {
      // A listing published with an expiry already behind it would be live for
      // one tick of the expiry job. Refused, with the field named, so the form
      // asks for a new date instead of publishing and expiring in one breath.
      throw new DetailsInvalidError([{ field: 'expiresAt', reason: 'must be in the future to publish' }])
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
    if (expiryGiven) set('expires_at', expiresAt)
    if (nextState !== stateFrom) {
      set('state', nextState)
      sets.push('state_changed_at = now()')
      // A draft made unpublished from the start has no publication time yet; one
      // that was live keeps its original, so "published on" does not move.
      if (nextState === 'active') sets.push('published_at = COALESCE(published_at, now())')
    }

    const detailsChanged = categoryChanged || input.details !== undefined
    const featuresChanged = category === 'vehicle' && input.features !== undefined

    if (sets.length > 0 || detailsChanged || featuresChanged) {
      // Any change moves the version, including one that only touched the
      // detail rows or the features: another device's form is stale either way.
      await client.query(
        `UPDATE marketplace_listings SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1::uuid`,
        params,
      )
    }

    if (detailsChanged) {
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

    if (featuresChanged) {
      await client.query('DELETE FROM marketplace_vehicle_features WHERE listing_id = $1::uuid', [listingId])
      if (input.features!.length > 0) {
        await client.query(
          `INSERT INTO marketplace_vehicle_features (listing_id, feature_id)
           SELECT $1, id FROM vehicle_features WHERE key = ANY($2::citext[]) AND retired_at IS NULL`,
          [listingId, input.features],
        )
      }
    }

    const { rows: after } = await client.query(
      `SELECT id, category, mode, title, body, state, contact_method,
              created_at, published_at, expires_at, state_changed_at,
              ${LISTING_VERSION_SQL} AS version
         FROM marketplace_listings WHERE id = $1::uuid`,
      [listingId],
    )
    return after[0]!
  }, { signal })

  // AFTER the commit, never inside it (see `transitionState`): an audit entry
  // that became durable before a failed COMMIT would describe a change that
  // never happened.
  if (stateTo !== stateFrom) {
    await app.audit({
      action: 'marketplace_listing_state_changed',
      actorId: ownerId, actorKind: 'member',
      targetType: 'marketplace_listing', targetId: listingId,
      detail: { statusFrom: stateFrom, statusTo: stateTo },
    })
  }

  return result
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

/** `GET /marketplace/mine` — every state, because the owner must see hidden and withdrawn too. */
export async function myListings(
  app: GwcApp,
  { ownerId, signal }: { ownerId: string; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    `SELECT id, category, mode, title, body, state, contact_method,
            created_at, published_at, expires_at, state_changed_at,
            ${LISTING_VERSION_SQL} AS version
       FROM marketplace_listings
      WHERE owner_id = $1::uuid
      ORDER BY state_changed_at DESC`,
    [ownerId],
    { signal },
  )
  return rows
}

/**
 * `GET /marketplace/mine/:id` — the owner's whole listing, in ANY state.
 *
 * The public detail route is the visibility rule (active only) and must stay
 * that simple, so the owner's read lives here instead of as a second branch
 * there. Not yours and absent are one `ListingNotFoundError`.
 */
export async function ownListing(
  app: GwcApp,
  { listingId, ownerId, signal }: { listingId: string; ownerId: string; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    `SELECT id, owner_id, category, mode, title, body, state, contact_method,
            created_at, published_at, expires_at, state_changed_at,
            ${LISTING_VERSION_SQL} AS version
       FROM marketplace_listings
      WHERE id = $1::uuid AND owner_id = $2::uuid`,
    [listingId, ownerId],
    { signal },
  )
  const row = rows[0]
  if (!row) throw new ListingNotFoundError()

  const table = DETAIL_TABLE[row.category as MarketplaceCategory]
  const { rows: details } = await query(
    app.pg,
    `SELECT to_jsonb(d.*) - 'listing_id' AS details FROM ${table} d WHERE d.listing_id = $1::uuid`,
    [listingId],
    { signal },
  )
  const { rows: features } = await query(
    app.pg,
    `SELECT vf.key
       FROM marketplace_vehicle_features mvf
       JOIN vehicle_features vf ON vf.id = mvf.feature_id
      WHERE mvf.listing_id = $1::uuid
      ORDER BY vf.key`,
    [listingId],
    { signal },
  )
  const media = await mediaForListings(app, [listingId], { signal })

  return {
    row: { ...row, details: details[0]?.details ?? {} },
    features: features.map((f) => String(f.key)),
    media: media.get(listingId) ?? [],
  }
}

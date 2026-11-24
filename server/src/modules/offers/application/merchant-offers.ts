import { PROBLEMS } from '@gwc/contracts/errors'
import type { CreateOfferRequest, UpdateOfferRequest, MerchantOffer } from '@gwc/contracts/offers'
import { withTransaction } from '../../../db/query.ts'
import { versionSql } from '../../../db/version.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { auditInTransaction } from '../../../ops/audit.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import { requireStoreId } from '../../stores/application/store.ts'
import type { GwcApp } from '../../../app.ts'

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }
type Actor = { id: string; kind: 'merchant'; requestId: string }

/**
 * A merchant's own offers (feature 035).
 *
 * Every statement here is scoped by the principal's organisation, and an offer
 * that is not the caller's answers exactly like one that does not exist (404),
 * so nobody can enumerate another merchant's offers by guessing ids.
 *
 * Publishing sets the state and nothing else. The announcement to members is
 * queued by the `offers_queue_push` trigger, once per offer (its idempotency
 * key is `offer:<id>`), and **must not be queued from here**: a second path
 * would not share the key's protection and `push.deliver` would send both.
 */

// Explicit columns: a column added to `offers` later must not reach a client by
// accident (the no-SELECT-* rule).
const OFFER_COLUMNS = `
  o.id, o.state, o.title, o.description, o.category_id, o.benefit_kind, o.benefit_value,
  o.regular_price_cents, o.member_price_cents, o.currency, o.valid_from, o.valid_until,
  o.conditions, o.remaining, o.per_person_limit, o.sort_position, o.published_at,
  ${versionSql('o')} AS version`

const iso = (value: unknown) => (value === null || value === undefined ? null : new Date(value as string).toISOString())

async function mediaFor(db: Queryable, offerIds: readonly string[]) {
  if (offerIds.length === 0) return new Map<string, unknown[]>()
  const { rows } = await db.query(
    'SELECT offer_id, asset_id FROM offer_media WHERE offer_id = ANY($1::uuid[]) ORDER BY offer_id, position', [offerIds],
  )
  const items = await loadMediaItems(db, rows.map((r) => String(r.asset_id)))
  const byOffer = new Map<string, unknown[]>()
  for (const r of rows) {
    const item = items.get(String(r.asset_id))
    // Only `ready` assets are returned by the loader; one still processing is
    // simply not shown yet.
    if (!item) continue
    const list = byOffer.get(String(r.offer_id)) ?? []
    list.push(item)
    byOffer.set(String(r.offer_id), list)
  }
  return byOffer
}

function toOffer(row: Record<string, any>, media: unknown[]): MerchantOffer {
  return {
    id: String(row.id),
    state: row.state,
    title: String(row.title),
    description: row.description ?? null,
    categoryId: String(row.category_id),
    benefit: {
      kind: row.benefit_kind,
      // numeric arrives from pg as a string; the contract says number.
      value: row.benefit_value === null ? null : Number(row.benefit_value),
    },
    regularPriceCents: row.regular_price_cents ?? null,
    memberPriceCents: row.member_price_cents ?? null,
    currency: String(row.currency).trim(),
    validFrom: iso(row.valid_from)!,
    validUntil: iso(row.valid_until)!,
    conditions: row.conditions ?? null,
    remaining: row.remaining ?? null,
    perPersonLimit: row.per_person_limit ?? null,
    sortPosition: Number(row.sort_position),
    publishedAt: iso(row.published_at),
    media: media as MerchantOffer['media'],
    version: String(row.version),
  }
}

export async function listOwnOffers(app: GwcApp, { organisationId }: { organisationId: string }) {
  const { rows } = await app.pg.query(
    `SELECT ${OFFER_COLUMNS} FROM offers o WHERE o.organisation_id = $1
      ORDER BY o.sort_position, o.created_at, o.id`,
    [organisationId],
  )
  const media = await mediaFor(app.pg, rows.map((r) => String(r.id)))
  return { items: rows.map((r) => toOffer(r, media.get(String(r.id)) ?? [])) }
}

/** One of the organisation's own offers, or null. Another organisation's is null too. */
export async function loadOwnOffer(db: Queryable, { organisationId, offerId }: { organisationId: string; offerId: string }) {
  const { rows } = await db.query(
    `SELECT ${OFFER_COLUMNS} FROM offers o WHERE o.id = $1 AND o.organisation_id = $2`, [offerId, organisationId],
  )
  if (rows.length === 0) return null
  const media = await mediaFor(db, [offerId])
  return toOffer(rows[0], media.get(offerId) ?? [])
}

const invalid = (detail: string) => forbidden(PROBLEMS.VALIDATION_FAILED, detail)

type Candidate = {
  title: string; description: string | null; categoryId: string | null
  benefitKind: string; benefitValue: number | null
  regularPriceCents: number | null; memberPriceCents: number | null; currency: string
  validFrom: string; validUntil: string; conditions: string | null
  remaining: number | null; perPersonLimit: number | null
}

/**
 * The offer's own rules, before the database's. The constraints are the backstop
 * (they catch a race or another code path); these give a person a refusal that
 * names what is wrong rather than a constraint name.
 */
function checkCandidate(c: Candidate) {
  if (!(new Date(c.validUntil) > new Date(c.validFrom))) throw invalid('The offer must end after it starts.')
  if (c.benefitKind === 'percentage' && !(c.benefitValue !== null && c.benefitValue > 0 && c.benefitValue <= 100)) {
    throw invalid('A percentage discount needs a value between 1 and 100.')
  }
  if (c.benefitKind === 'fixed_amount' && !(c.benefitValue !== null && c.benefitValue > 0)) {
    throw invalid('A fixed-amount discount needs an amount above zero.')
  }
  if ((c.benefitKind === 'freebie' || c.benefitKind === 'bogo') && c.benefitValue !== null) {
    throw invalid('A freebie or buy-one-get-one offer has no discount value.')
  }
  if (c.regularPriceCents !== null && c.memberPriceCents !== null && c.memberPriceCents >= c.regularPriceCents) {
    // Merchant rule 1 of the design document: a real advantage, or no offer.
    throw invalid('The member price must be lower than the regular price.')
  }
}

/** A hidden or unknown category is not offered to merchants, so it is refused like a missing one. */
async function requireChoosableCategory(db: Queryable, categoryId: string | null | undefined) {
  if (!categoryId) throw forbidden(PROBLEMS.OFFER_CATEGORY_REQUIRED, 'Choose a category for the offer.')
  const { rows } = await db.query('SELECT 1 FROM offer_categories WHERE id = $1 AND visible', [categoryId])
  if (rows.length === 0) throw forbidden(PROBLEMS.OFFER_CATEGORY_REQUIRED, 'Choose a category from the list.')
}

/** A check or foreign-key violation the pre-checks did not foresee, as a refusal that says what it was about. */
function refuse(error: unknown): never {
  const e = error as { code?: string; constraint?: string }
  if (e.code === '23514' || e.code === '23503') throw invalid('The offer is not valid.')
  throw error
}

export async function createOffer(
  app: GwcApp,
  { organisationId, actor, body }: { organisationId: string; actor: Actor; body: CreateOfferRequest },
): Promise<MerchantOffer> {
  return withTransaction(app.pg, async (client) => {
    const store = await requireStoreId(client, organisationId)
    await requireChoosableCategory(client, body.categoryId)

    const candidate: Candidate = {
      title: body.title, description: body.description ?? null, categoryId: body.categoryId ?? null,
      benefitKind: body.benefitKind, benefitValue: body.benefitValue ?? null,
      regularPriceCents: body.regularPriceCents ?? null, memberPriceCents: body.memberPriceCents ?? null,
      currency: body.currency ?? 'EUR', validFrom: body.validFrom, validUntil: body.validUntil,
      conditions: body.conditions ?? null, remaining: body.remaining ?? null,
      // Absent means the default of one per person; an explicit null means no limit.
      perPersonLimit: body.perPersonLimit === undefined ? 1 : body.perPersonLimit,
    }
    checkCandidate(candidate)

    let offerId: string
    try {
      const { rows } = await client.query(
        `INSERT INTO offers (organisation_id, store_id, category_id, title, description, benefit_kind,
                             benefit_value, regular_price_cents, member_price_cents, currency, valid_from,
                             valid_until, conditions, remaining, per_person_limit, state)
         VALUES ($1, $2, $3, $4, $5, $6::benefit_kind, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft')
         RETURNING id`,
        [organisationId, store.id, candidate.categoryId, candidate.title, candidate.description,
          candidate.benefitKind, candidate.benefitValue, candidate.regularPriceCents, candidate.memberPriceCents,
          candidate.currency, candidate.validFrom, candidate.validUntil, candidate.conditions,
          candidate.remaining, candidate.perPersonLimit],
      )
      offerId = String(rows[0].id)
    } catch (error) {
      refuse(error)
    }
    await auditInTransaction(client, {
      action: 'offer_created', outcome: 'allowed', requestId: actor.requestId,
      actorId: actor.id, actorKind: actor.kind, targetType: 'offer', targetId: offerId,
      detail: { offerChange: { after: { state: 'draft' } } },
    })
    return (await loadOwnOffer(client, { organisationId, offerId }))!
  })
}

export async function updateOffer(
  app: GwcApp,
  { organisationId, actor, offerId, body }:
    { organisationId: string; actor: Actor; offerId: string; body: UpdateOfferRequest },
): Promise<MerchantOffer> {
  return withTransaction(app.pg, async (client) => {
    const { rows } = await client.query(
      `SELECT ${OFFER_COLUMNS} FROM offers o WHERE o.id = $1 AND o.organisation_id = $2 FOR UPDATE`,
      [offerId, organisationId],
    )
    if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such offer.')
    const current = rows[0]
    // Two users of one organisation edit the same offers: a stale edit is a 409.
    if (current.version !== body.version) {
      throw forbidden(PROBLEMS.CONFLICT, 'The offer was changed by someone else. Reload and try again.')
    }

    const pick = <K extends keyof UpdateOfferRequest, T>(key: K, existing: T): T =>
      (body[key] === undefined ? existing : (body[key] as unknown as T))
    const candidate: Candidate = {
      title: pick('title', current.title),
      description: pick('description', current.description),
      categoryId: pick('categoryId', current.category_id),
      benefitKind: pick('benefitKind', current.benefit_kind),
      benefitValue: pick('benefitValue', current.benefit_value === null ? null : Number(current.benefit_value)),
      regularPriceCents: pick('regularPriceCents', current.regular_price_cents),
      memberPriceCents: pick('memberPriceCents', current.member_price_cents),
      currency: pick('currency', String(current.currency).trim()),
      validFrom: pick('validFrom', new Date(current.valid_from).toISOString()),
      validUntil: pick('validUntil', new Date(current.valid_until).toISOString()),
      conditions: pick('conditions', current.conditions),
      remaining: pick('remaining', current.remaining),
      perPersonLimit: pick('perPersonLimit', current.per_person_limit),
    }
    checkCandidate(candidate)
    // Only a CHANGED category must be one merchants may still choose: an offer
    // under a category staff have since hidden stays editable.
    if (candidate.categoryId !== String(current.category_id)) await requireChoosableCategory(client, candidate.categoryId)

    try {
      await client.query(
        `UPDATE offers SET title = $2, description = $3, category_id = $4, benefit_kind = $5::benefit_kind,
                           benefit_value = $6, regular_price_cents = $7, member_price_cents = $8, currency = $9,
                           valid_from = $10, valid_until = $11, conditions = $12, remaining = $13,
                           per_person_limit = $14
          WHERE id = $1`,
        [offerId, candidate.title, candidate.description, candidate.categoryId, candidate.benefitKind,
          candidate.benefitValue, candidate.regularPriceCents, candidate.memberPriceCents, candidate.currency,
          candidate.validFrom, candidate.validUntil, candidate.conditions, candidate.remaining,
          candidate.perPersonLimit],
      )
    } catch (error) {
      refuse(error)
    }
    await auditInTransaction(client, {
      action: 'offer_updated', outcome: 'allowed', requestId: actor.requestId,
      actorId: actor.id, actorKind: actor.kind, targetType: 'offer', targetId: offerId,
      detail: { offerChange: { changed: Object.keys(body).filter((k) => k !== 'version') } },
    })
    return (await loadOwnOffer(client, { organisationId, offerId }))!
  })
}

/**
 * `draft → published` (and `withdrawn → published`), with no approval step.
 *
 * Refused while the store is switched off. Also refused when it could never be
 * seen: with no public name for the merchant, or a window already over. The
 * announcement is queued once per offer and checked again when it is sent; an
 * offer published while invisible would burn that one announcement on a
 * cancelled notification and never reach members, even after it was fixed.
 *
 * Publishing an offer that is already published changes nothing and says
 * nothing: the trigger has already queued its single announcement.
 */
export async function publishOffer(
  app: GwcApp,
  { organisationId, actor, offerId }: { organisationId: string; actor: Actor; offerId: string },
): Promise<MerchantOffer> {
  return withTransaction(app.pg, async (client) => {
    const { rows } = await client.query(
      `SELECT o.state, o.valid_until FROM offers o WHERE o.id = $1 AND o.organisation_id = $2 FOR UPDATE`,
      [offerId, organisationId],
    )
    if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such offer.')
    const { state, valid_until: validUntil } = rows[0]
    if (state === 'published') return (await loadOwnOffer(client, { organisationId, offerId }))!
    if (state !== 'draft' && state !== 'withdrawn') {
      throw forbidden(PROBLEMS.CONFLICT, 'Only a draft or a withdrawn offer can be published.')
    }

    const store = await requireStoreId(client, organisationId)
    if (!store.active) throw forbidden(PROBLEMS.STORE_INACTIVE, 'The store is deactivated, so offers cannot be published.')

    const { rows: profile } = await client.query(
      'SELECT 1 FROM organisation_profiles WHERE organisation_id = $1 AND display_name IS NOT NULL', [organisationId],
    )
    if (profile.length === 0) {
      throw forbidden(PROBLEMS.PROFILE_INCOMPLETE, 'Set the public name of your business before publishing an offer.')
    }
    if (new Date(validUntil) <= new Date()) throw invalid('The offer has already ended.')

    await client.query(
      `UPDATE offers SET state = 'published', published_at = COALESCE(published_at, now()) WHERE id = $1`, [offerId],
    )
    await auditInTransaction(client, {
      action: 'offer_published', outcome: 'allowed', requestId: actor.requestId,
      actorId: actor.id, actorKind: actor.kind, targetType: 'offer', targetId: offerId,
      detail: { offerChange: { before: { state }, after: { state: 'published' } } },
    })
    return (await loadOwnOffer(client, { organisationId, offerId }))!
  })
}

/** `published → withdrawn`. Already withdrawn is a no-op; a draft has nothing to withdraw. */
export async function withdrawOffer(
  app: GwcApp,
  { organisationId, actor, offerId }: { organisationId: string; actor: Actor; offerId: string },
): Promise<MerchantOffer> {
  return withTransaction(app.pg, async (client) => {
    const { rows } = await client.query(
      'SELECT o.state FROM offers o WHERE o.id = $1 AND o.organisation_id = $2 FOR UPDATE', [offerId, organisationId],
    )
    if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such offer.')
    const state = rows[0].state
    if (state === 'withdrawn') return (await loadOwnOffer(client, { organisationId, offerId }))!
    if (state !== 'published') throw forbidden(PROBLEMS.CONFLICT, 'Only a published offer can be withdrawn.')

    await client.query(`UPDATE offers SET state = 'withdrawn' WHERE id = $1`, [offerId])
    await auditInTransaction(client, {
      action: 'offer_withdrawn', outcome: 'allowed', requestId: actor.requestId,
      actorId: actor.id, actorKind: actor.kind, targetType: 'offer', targetId: offerId,
      detail: { offerChange: { before: { state }, after: { state: 'withdrawn' } } },
    })
    return (await loadOwnOffer(client, { organisationId, offerId }))!
  })
}

/** The merchant's own display order. Every id must be theirs, or none is touched. */
export async function setOfferOrder(
  app: GwcApp,
  { organisationId, ids }: { organisationId: string; ids: readonly string[] },
) {
  return withTransaction(app.pg, async (client) => {
    const { rows } = await client.query(
      'SELECT id FROM offers WHERE id = ANY($1::uuid[]) AND organisation_id = $2 FOR UPDATE', [ids, organisationId],
    )
    if (new Set(ids).size !== ids.length || rows.length !== ids.length) {
      throw forbidden(PROBLEMS.NOT_FOUND, 'No such offer.')
    }
    for (const [position, id] of ids.entries()) {
      await client.query('UPDATE offers SET sort_position = $2 WHERE id = $1', [id, position])
    }
    const { rows: fresh } = await client.query(
      `SELECT ${OFFER_COLUMNS} FROM offers o WHERE o.organisation_id = $1 ORDER BY o.sort_position, o.created_at, o.id`,
      [organisationId],
    )
    const media = await mediaFor(client, fresh.map((r) => String(r.id)))
    return { items: fresh.map((r) => toOffer(r, media.get(String(r.id)) ?? [])) }
  })
}

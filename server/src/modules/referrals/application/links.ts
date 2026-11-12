import { withTransaction } from '../../../db/query.ts'
import { insertLinkWithFreshCode } from './codes.ts'
import type { Owner, Queryable } from './codes.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * A person's own referral link: read it (creating it the first time), or
 * replace it (FR-001–FR-003, US1).
 */

type LinkRow = { id: string; code: string; created_at: Date }

async function activeLink(db: Queryable, owner: Owner): Promise<LinkRow | null> {
  const { rows } = await db.query(
    `SELECT id, code, created_at FROM referral_links
      WHERE owner_kind = $1 AND owner_id = $2 AND state = 'active'`,
    [owner.kind, owner.id],
  )
  return rows[0] ?? null
}

const isOneActiveConflict = (err: unknown) => {
  const e = err as { code?: string; constraint?: string }
  return e.code === '23505' && e.constraint === 'referral_links_one_active'
}

/**
 * The owner's active link, created on first read.
 *
 * Created lazily rather than at sign-up so nobody who never opens Refer & earn
 * has a link at all, and so the four kinds of principal need no hook in four
 * different account-creation paths. Two first reads racing (two tabs, a
 * double-tapped screen) both try to insert; the one-active index lets exactly
 * one win and the loser reads the winner's — the same link either way.
 */
export async function getOrCreateLink(
  app: GwcApp,
  owner: Owner,
  { requestId }: { requestId?: string } = {},
): Promise<LinkRow> {
  const existing = await activeLink(app.pg, owner)
  if (existing) return existing
  try {
    const created = await insertLinkWithFreshCode(app.pg, owner)
    await app.audit({
      action: 'referral_link_created', requestId,
      actorId: owner.id, actorKind: owner.kind,
      targetType: 'referral_link', targetId: created.id,
    })
    return created
  } catch (err) {
    if (!isOneActiveConflict(err)) throw err
    const winner = await activeLink(app.pg, owner)
    if (!winner) throw err
    return winner
  }
}

/**
 * Retire the owner's link and issue a new one, in one transaction.
 *
 * The old code stops crediting anyone from this moment (FR-003, FR-006); the
 * people who already came through it stay credited, because their referral
 * rows point at the old link and nothing here touches them. A double-tapped
 * Replace runs twice in sequence (the row lock serialises it) and leaves the
 * newest link active, which is what the person last asked for.
 */
export async function replaceLink(
  app: GwcApp,
  owner: Owner,
  { requestId }: { requestId?: string } = {},
): Promise<LinkRow> {
  const { previous, created } = await withTransaction(app.pg, async (client) => {
    const { rows } = await client.query(
      `UPDATE referral_links SET state = 'retired', state_changed_at = now()
        WHERE owner_kind = $1 AND owner_id = $2 AND state = 'active'
        RETURNING id`,
      [owner.kind, owner.id],
    )
    const created = await insertLinkWithFreshCode(client, owner)
    return { previous: rows[0]?.id ? String(rows[0].id) : null, created }
  })
  await app.audit({
    action: 'referral_link_replaced', requestId,
    actorId: owner.id, actorKind: owner.kind,
    targetType: 'referral_link', targetId: created.id,
    detail: previous ? { previousLinkId: previous } : null,
  })
  return created
}

import { PROBLEMS } from '@gwc/contracts/errors'
import { MAX_OFFER_MEDIA } from '@gwc/contracts/offers'
import type { MerchantOffer, OfferMedia } from '@gwc/contracts/offers'
import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { auditInTransaction } from '../../../ops/audit.ts'
import { loadOwnedAssets } from '../../media/application/owned-assets.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import { loadOwnOffer } from './merchant-offers.ts'
import type { GwcApp } from '../../../app.ts'

/** `admin` is how a staff account is recorded (`account_kind`, `request.principal.kind`); `staff` is only an audience name. */
type Actor = { id: string; kind: 'merchant' | 'admin'; requestId: string }

/**
 * Replace an offer's images and videos as a whole (feature 035, research R5).
 *
 * At most `MAX_OFFER_MEDIA`, in the order given, the first leading. The limit is
 * checked before anything is touched, and the database's position bound is the
 * backstop, so an eleventh item is refused whichever layer sees it first and the
 * previous set is left alone.
 *
 * This is an edit endpoint where threads have none: a thread post is immutable,
 * so its media attach only in the creating transaction, but an offer belongs to
 * its merchant and is meant to be edited.
 */
export async function setOfferMedia(
  app: GwcApp,
  { organisationId, actor, offerId, assetIds }:
    { organisationId: string; actor: Actor; offerId: string; assetIds: readonly string[] },
): Promise<MerchantOffer> {
  if (assetIds.length > MAX_OFFER_MEDIA) {
    throw forbidden(PROBLEMS.OFFER_MEDIA_LIMIT, `An offer holds at most ${MAX_OFFER_MEDIA} images or videos.`)
  }
  return withTransaction(app.pg, async (client) => {
    // Another organisation's offer answers exactly like an unknown id.
    const { rows } = await client.query(
      'SELECT id FROM offers WHERE id = $1 AND organisation_id = $2 FOR UPDATE', [offerId, organisationId],
    )
    if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such offer.')

    await loadOwnedAssets(client, { organisationId, assetIds })
    await client.query('DELETE FROM offer_media WHERE offer_id = $1', [offerId])
    for (const [position, assetId] of assetIds.entries()) {
      await client.query(
        'INSERT INTO offer_media (offer_id, asset_id, position) VALUES ($1, $2, $3)', [offerId, assetId, position],
      )
    }
    await auditInTransaction(client, {
      action: 'offer_updated', outcome: 'allowed', requestId: actor.requestId,
      actorId: actor.id, actorKind: actor.kind, targetType: 'offer', targetId: offerId,
      detail: { offerChange: { changed: ['media'], count: assetIds.length } },
    })
    return (await loadOwnOffer(client, { organisationId, offerId }))!
  })
}

/**
 * Choose which of an offer's existing files is the main one (feature 042, research R8).
 *
 * Moves `assetId` to position 0 and keeps the others in their relative order. This is
 * deliberately not "replace the set": that endpoint rebuilds the whole list from the
 * client's copy, so a stale tab would silently drop files added elsewhere. Here the
 * server reads the current order under the row lock and moves one id, so nothing can
 * be lost (Principle IV). The lock is the same `FOR UPDATE` `setOfferMedia` takes, so
 * the two cannot interleave.
 *
 * Two doors, one rule. `scope` is the whole difference: a merchant reaches only its own
 * organisation's offers (anyone else's answers exactly like an unknown id), and the
 * staff door, already narrowed to a super admin by its handler, reaches any offer.
 *
 * Already first is a no-op: nothing written, no audit entry. `offers.updated_at` is not
 * touched (as in `setOfferMedia`), so a merchant's open edit form is not made stale.
 */
export async function setMainMedia(
  app: GwcApp,
  { scope, actor, offerId, assetId }:
    { scope: { organisationId: string } | { anyOrganisation: true }; actor: Actor; offerId: string; assetId: string },
): Promise<OfferMedia> {
  return withTransaction(app.pg, async (client) => {
    const { rows } = 'organisationId' in scope
      ? await client.query('SELECT id FROM offers WHERE id = $1 AND organisation_id = $2 FOR UPDATE', [offerId, scope.organisationId])
      : await client.query('SELECT id FROM offers WHERE id = $1 FOR UPDATE', [offerId])
    if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such offer.')

    const { rows: links } = await client.query(
      'SELECT asset_id FROM offer_media WHERE offer_id = $1 ORDER BY position', [offerId],
    )
    const current = links.map((l: { asset_id: unknown }) => String(l.asset_id))
    if (!current.includes(assetId)) {
      throw forbidden(PROBLEMS.OFFER_MEDIA_NOT_ATTACHED, 'That file is not one of this offer’s images or videos.')
    }

    let order = current
    if (current[0] !== assetId) {
      order = [assetId, ...current.filter((id) => id !== assetId)]
      // The primary key is (offer_id, position), so the set is rewritten rather than updated in place.
      await client.query('DELETE FROM offer_media WHERE offer_id = $1', [offerId])
      for (const [position, id] of order.entries()) {
        await client.query(
          'INSERT INTO offer_media (offer_id, asset_id, position) VALUES ($1, $2, $3)', [offerId, id, position],
        )
      }
      await auditInTransaction(client, {
        action: 'offer_updated', outcome: 'allowed', requestId: actor.requestId,
        actorId: actor.id, actorKind: actor.kind, targetType: 'offer', targetId: offerId,
        detail: { offerChange: { changed: ['mainMedia'], assetId } },
      })
    }

    // Only ready items are delivered, in the stored order: the same view members get.
    const items = await loadMediaItems(client, order)
    return { media: order.flatMap((id) => items.get(id) ?? []) }
  })
}

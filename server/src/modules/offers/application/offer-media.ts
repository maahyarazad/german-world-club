import { PROBLEMS } from '@gwc/contracts/errors'
import { MAX_OFFER_MEDIA } from '@gwc/contracts/offers'
import type { MerchantOffer } from '@gwc/contracts/offers'
import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { auditInTransaction } from '../../../ops/audit.ts'
import { loadOwnedAssets } from '../../media/application/owned-assets.ts'
import { loadOwnOffer } from './merchant-offers.ts'
import type { GwcApp } from '../../../app.ts'

type Actor = { id: string; kind: 'merchant'; requestId: string }

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

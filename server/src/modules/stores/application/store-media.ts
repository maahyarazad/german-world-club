import { PROBLEMS } from '@gwc/contracts/errors'
import { MAX_STORE_MEDIA, isWideCover } from '@gwc/contracts/media'
import type { Store } from '@gwc/contracts/stores'
import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { auditInTransaction } from '../../../ops/audit.ts'
import { loadOwnedAssets } from '../../media/application/owned-assets.ts'
import { loadStoreView, requireStoreId } from './store.ts'
import type { GwcApp } from '../../../app.ts'

type Actor = { id: string; kind: 'merchant'; requestId: string }

/**
 * The store's wide cover (feature 035, research R15).
 *
 * An image whose own dimensions are about 16:9 landscape. The dimensions are the
 * asset's, probed synchronously at upload, so no decode happens here. A refusal
 * leaves the previous cover exactly as it was: the check runs before the update.
 * `assetId: null` clears the cover.
 */
export async function setStoreCover(
  app: GwcApp,
  { organisationId, actor, assetId }: { organisationId: string; actor: Actor; assetId: string | null },
): Promise<Store> {
  return withTransaction(app.pg, async (client) => {
    const store = await requireStoreId(client, organisationId)
    // Lock the store row so two changes to the cover are applied one at a time.
    await client.query('SELECT 1 FROM stores WHERE id = $1 FOR UPDATE', [store.id])

    if (assetId !== null) {
      const [asset] = await loadOwnedAssets(client, { organisationId, assetIds: [assetId] })
      if (asset!.kind !== 'image') {
        throw forbidden(PROBLEMS.COVER_ASPECT_RATIO, 'The cover must be an image.')
      }
      if (!isWideCover(asset!.width, asset!.height)) {
        throw forbidden(PROBLEMS.COVER_ASPECT_RATIO, 'The cover must be a wide image, about 16:9.')
      }
    }
    await client.query('UPDATE stores SET cover_asset_id = $2 WHERE id = $1', [store.id, assetId])
    await auditInTransaction(client, {
      action: 'store_updated', outcome: 'allowed', requestId: actor.requestId,
      actorId: actor.id, actorKind: actor.kind, targetType: 'store', targetId: store.id,
      detail: { storeChange: { changed: ['cover'] } },
    })
    return (await loadStoreView(client, organisationId))!
  })
}

/**
 * Replace the gallery as a whole: at most `MAX_STORE_MEDIA` photos or videos, in
 * the order given. The cover is not part of it, so choosing a cover never uses
 * one of the ten.
 *
 * Checked before anything is touched, with the database's position bound as the
 * backstop, so an eleventh item is refused whichever layer sees it first and the
 * previous gallery is left as it was.
 */
export async function setStoreMedia(
  app: GwcApp,
  { organisationId, actor, assetIds }: { organisationId: string; actor: Actor; assetIds: readonly string[] },
): Promise<Store> {
  if (assetIds.length > MAX_STORE_MEDIA) {
    throw forbidden(PROBLEMS.OFFER_MEDIA_LIMIT, `A store gallery holds at most ${MAX_STORE_MEDIA} photos or videos.`)
  }
  return withTransaction(app.pg, async (client) => {
    const store = await requireStoreId(client, organisationId)
    await client.query('SELECT 1 FROM stores WHERE id = $1 FOR UPDATE', [store.id])
    await loadOwnedAssets(client, { organisationId, assetIds })

    await client.query('DELETE FROM store_media WHERE store_id = $1', [store.id])
    for (const [position, assetId] of assetIds.entries()) {
      await client.query(
        'INSERT INTO store_media (store_id, asset_id, position) VALUES ($1, $2, $3)', [store.id, assetId, position],
      )
    }
    await auditInTransaction(client, {
      action: 'store_updated', outcome: 'allowed', requestId: actor.requestId,
      actorId: actor.id, actorKind: actor.kind, targetType: 'store', targetId: store.id,
      detail: { storeChange: { changed: ['media'], count: assetIds.length } },
    })
    return (await loadStoreView(client, organisationId))!
  })
}

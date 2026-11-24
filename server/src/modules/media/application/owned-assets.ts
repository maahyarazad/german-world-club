import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden } from '../../../authz/require-permission.ts'

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }

export type OwnedAsset = {
  id: string
  kind: 'image' | 'video'
  state: 'processing' | 'ready' | 'failed'
  width: number
  height: number
}

/**
 * The assets an organisation may attach to its store or offers (feature 035).
 *
 * "Its own" means uploaded by a user of this organisation, so a colleague's
 * upload counts and another merchant's does not. An unknown id, someone else's
 * asset and one that was never uploaded as a merchant all answer the same 404,
 * so the response cannot be used to find out which asset ids exist.
 *
 * A `failed` asset is refused: it has nothing to show and, attached, would hold
 * one of the ten places for nothing. A `processing` one is allowed — a video is
 * transcoded after the upload returns — and delivery simply does not return it
 * until it is `ready`.
 *
 * Returns the assets in the order the ids were given, so a caller can use the
 * position as the display order.
 */
export async function loadOwnedAssets(
  db: Queryable,
  { organisationId, assetIds }: { organisationId: string; assetIds: readonly string[] },
): Promise<OwnedAsset[]> {
  if (assetIds.length === 0) return []
  if (new Set(assetIds).size !== assetIds.length) {
    throw forbidden(PROBLEMS.VALIDATION_FAILED, 'The same file appears more than once.')
  }

  const { rows } = await db.query(
    `SELECT a.id, a.kind, a.state, a.width, a.height
       FROM assets a
      WHERE a.id = ANY($1::uuid[])
        AND a.uploader_kind = 'merchant'
        AND a.uploaded_by IN (SELECT id FROM organisation_users WHERE organisation_id = $2)`,
    [assetIds, organisationId],
  )
  if (rows.length !== assetIds.length) throw forbidden(PROBLEMS.NOT_FOUND, 'No such file.')

  const byId = new Map<string, OwnedAsset>(rows.map((r) => [String(r.id), {
    id: String(r.id), kind: r.kind, state: r.state, width: Number(r.width), height: Number(r.height),
  }]))
  const ordered = assetIds.map((id) => byId.get(id)!)
  if (ordered.some((a) => a.state === 'failed')) {
    throw forbidden(PROBLEMS.VALIDATION_FAILED, 'A file that could not be processed cannot be used.')
  }
  return ordered
}

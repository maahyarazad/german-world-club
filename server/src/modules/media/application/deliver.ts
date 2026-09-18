import { PROBLEMS } from '@gwc/contracts/errors'
import { VARIANTS, FORMATS } from '@gwc/contracts/media'
import { withTransaction, query } from '../../../db/query.ts'
import { release, SCOPE } from '../../../db/counters.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { VARIANTS_IN_ORDER, toResponse, MIME_FOR_FORMAT } from './format.ts'

export async function getAsset(app, { id, signal }) {
  const { rows } = await query(app.pg, 'SELECT * FROM assets WHERE id = $1', [id], { signal })
  if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such asset.')

  const { rows: variants } = await query(app.pg, VARIANTS_IN_ORDER, [rows[0].id], { signal })
  // `state` and `failure_reason` are both included so a client polling a
  // processing video can tell "still working" from "gave up, here is why".
  return toResponse(rows[0], variants)
}

export async function deleteAsset(app, { storage, id, principal, permissions, requestId }) {
  const outcome = await withTransaction(app.pg, async (client) => {
    const { rows } = await client.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [id])
    if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such asset.')
    const asset = rows[0]

    // Ownership, or the module flag for staff.
    const owns = asset.uploaded_by === principal.id && asset.uploader_kind === principal.kind
    const staffMayDelete = principal.kind === 'admin' && permissions?.isSuperadmin
    if (!owns && !staffMayDelete) {
      throw forbidden(PROBLEMS.INSUFFICIENT_PERMISSION, 'This asset belongs to someone else.')
    }

    const { rows: variants } = await client.query(
      'SELECT storage_key FROM asset_variants WHERE asset_id = $1', [asset.id],
    )

    await client.query('DELETE FROM assets WHERE id = $1', [asset.id])

    // Content-addressed storage means bytes may be shared. Removing them
    // while another asset points at the same checksum would break that
    // asset's URLs — which is exactly the failure dedupe is supposed to be
    // invisible against.
    const { rows: sharing } = await client.query(
      'SELECT 1 FROM assets WHERE checksum = $1 LIMIT 1', [asset.checksum],
    )
    const bytesRemoved = sharing.length === 0

    if (asset.uploaded_by) {
      await release(client, SCOPE.STORED_BYTES, asset.uploaded_by, Number(asset.bytes))
    }

    return { asset, variants, bytesRemoved }
  })

  if (outcome.bytesRemoved) {
    // Outside the transaction: an object-store failure must not roll back a
    // committed delete, and an orphaned object is reclaimable garbage.
    await Promise.allSettled([
      storage.remove(outcome.asset.storage_key),
      ...outcome.variants.map((v) => storage.remove(v.storage_key)),
    ])
  }

  await app.audit({
    action: 'media_deleted', outcome: 'allowed', requestId,
    actorId: principal.id, actorKind: principal.kind,
    targetType: 'asset', targetId: outcome.asset.id,
    detail: { bytesRemoved: outcome.bytesRemoved },
  })

  return { id: outcome.asset.id, deleted: true, bytesRemoved: outcome.bytesRemoved }
}

export async function getVariant(app, { storage, checksum, variant, ext, signal }) {
  const format = ext === 'jpg' ? 'jpeg' : ext

  /**
   * Checked against the known sets before the query runs.
   *
   * `variant` and `format` are PostgreSQL enums, so a URL naming something
   * outside them — `/original.jpg`, or anything a scanner invents — would
   * fail the cast and surface as a 500. That is both a misleading answer and
   * a free way to generate server errors. A name that cannot address a
   * variant addresses nothing, which is a 404.
   */
  if (!VARIANTS.includes(variant) || !FORMATS.includes(format)) {
    throw forbidden(PROBLEMS.NOT_FOUND, 'No such variant.')
  }

  const { rows } = await query(
    app.pg,
    `SELECT v.storage_key, v.format, v.bytes, a.mime
       FROM asset_variants v JOIN assets a ON a.id = v.asset_id
      WHERE encode(a.checksum, 'hex') = $1 AND v.variant = $2 AND v.format = $3`,
    [checksum, variant, format],
    { signal },
  )
  if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such variant.')

  const body = await storage.get(rows[0].storage_key)
  return { body, contentType: MIME_FOR_FORMAT[rows[0].format] ?? 'application/octet-stream' }
}

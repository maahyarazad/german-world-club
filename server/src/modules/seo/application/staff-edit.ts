import { PROBLEMS } from '@gwc/contracts/errors'
import { withTransaction } from '../../../db/query.ts'
import { guardSeoEdit, seoModulesFor } from '../../../authz/object-guards.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { normalisePath } from '../../../plugins/04-legacy-redirects.ts'
import { pathFor } from '../build-page-meta.ts'
import type { FastifyRequest } from 'fastify'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'

/**
 * Staff-editable SEO fields (§10.8, FR-020, FR-021).
 *
 * Because partner visibility is a paid deliverable, §10.8 requires staff to see
 * and adjust how a partner's page presents in search and in shared links
 * **without engineering involvement**. So `seo` is a module of the five-flag
 * matrix like any other.
 *
 * Two things here are easy to get wrong and expensive to discover:
 *
 *  1. Editing a record's SEO fields requires the flag on **both** `seo` and the
 *     record's own module. Otherwise `seo.edit` is edit access to every title
 *     on the site.
 *  2. A slug change writes the old slug into `legacy_redirects` as a 301,
 *     automatically. A slug change that silently discards accumulated search
 *     equity shows up months later as a ranking decline with no error anywhere
 *     to explain it (§12.12).
 *
 * `guardSeoEdit` takes the raw `request` because it audits a denial through
 * `app.auditDenial(request, ...)` — an existing cross-cutting authz mechanism
 * shared by every guarded route in the codebase, not something this feature
 * changes.
 */

export const toResponse = (row, redirectCreated = null) => ({
  recordType: row.record_type,
  recordId: row.record_id,
  slug: row.slug,
  seoTitle: row.seo_title ?? null,
  metaDescription: row.meta_description ?? null,
  shareImageId: row.share_image_id ?? null,
  indexable: row.indexable,
  language: row.language,
  published: row.published,
  updatedAt: new Date(row.updated_at).toISOString(),
  redirectCreated,
})

export async function readSeoRecord(app: GwcApp, request: FastifyRequest, { recordType, recordId, permissions }) {
  await guardSeoEdit(app, request, permissions, recordType, 'read')
  const { rows } = await app.pg.query(
    'SELECT * FROM seo_metadata WHERE record_type = $1 AND record_id = $2',
    [recordType, recordId],
  )
  if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No SEO record for that content.')
  return rows[0]
}

export async function updateSeoRecord(app: GwcApp, request: FastifyRequest, { recordType, recordId, patch, permissions, principal, requestId }) {
  // The dual-permission requirement. Layer 1 already proved `seo.edit`; this
  // proves the record's own module too.
  await guardSeoEdit(app, request, permissions, recordType, 'edit')

  const { row, redirectCreated } = await withTransaction(app.pg, async (client: PoolClient) => {
    const { rows: existing } = await client.query(
      'SELECT * FROM seo_metadata WHERE record_type = $1 AND record_id = $2 FOR UPDATE',
      [recordType, recordId],
    )
    if (existing.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No SEO record for that content.')
    const before = existing[0]

    const next = {
      slug: patch.slug ?? before.slug,
      seo_title: patch.seoTitle !== undefined ? patch.seoTitle : before.seo_title,
      meta_description: patch.metaDescription !== undefined ? patch.metaDescription : before.meta_description,
      share_image_id: patch.shareImageId !== undefined ? patch.shareImageId : before.share_image_id,
      indexable: patch.indexable ?? before.indexable,
      language: patch.language ?? before.language,
      published: patch.published ?? before.published,
    }

    const { rows: updated } = await client.query(
      `UPDATE seo_metadata
          SET slug = $3, seo_title = $4, meta_description = $5, share_image_id = $6,
              indexable = $7, language = $8, published = $9, updated_at = now()
        WHERE record_type = $1 AND record_id = $2
        RETURNING *`,
      [recordType, recordId, next.slug, next.seo_title, next.meta_description,
       next.share_image_id, next.indexable, next.language, next.published],
    )

    let created = null
    const slugChanged = String(before.slug).toLowerCase() !== String(next.slug).toLowerCase()
    if (slugChanged) {
      const from = normalisePath(pathFor(recordType, before.slug))
      const to = pathFor(recordType, next.slug)
      await client.query(
        `INSERT INTO legacy_redirects (legacy_path, target_path, status, note)
         VALUES ($1, $2, 301, $3)
         ON CONFLICT (legacy_path) DO UPDATE SET target_path = EXCLUDED.target_path, status = 301`,
        [from, to, `Automatic 301 from a slug change on ${recordType} ${recordId}`],
      )
      created = from
    }

    return { row: updated[0], redirectCreated: created, before }
  })

  if (redirectCreated) app.invalidateLegacyRedirects()
  // The sitemap is cached for an hour; a publication or slug change must not
  // wait that out.
  app.invalidateSitemap?.()

  await app.audit({
    action: 'seo_changed', outcome: 'allowed', requestId,
    actorId: principal.id, actorKind: principal.kind,
    targetType: recordType, targetId: recordId,
    requiredPermission: `${seoModulesFor(recordType).record}.edit`,
  })

  return { row, redirectCreated }
}

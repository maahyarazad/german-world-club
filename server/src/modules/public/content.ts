import { query } from '../../db/query.ts'
import { shareImageFromVariants } from '../seo/build-page-meta.ts'
import type { Pool } from 'pg'

/**
 * Where a public page's content comes from.
 *
 * This feature is the platform layer: it owns crawl posture, metadata, status
 * codes and rendering, but it does not own partners, events or articles — those
 * are [data-model.md]'s "§2 model" and arrive with their own features. So the
 * public routes resolve through a **content source** rather than querying a
 * domain table directly.
 *
 * The default source reads `seo_metadata`, which is the one table this feature
 * does own and which already carries slug, language, publication state, staff
 * overrides and the share image. A domain feature later registers a richer
 * resolver for its own record type and the routes, templates and metadata
 * resolver are unchanged — that is the "touches those entities by reference"
 * rule in data-model.md, made concrete.
 *
 * It is also the seam the rendering and OG-tag suites inject through, so those
 * assertions are about the resolver and the templates rather than about SQL.
 */

/** Humanise a slug into a title, for a record whose domain feature does not exist yet. */
export function titleFromSlug(slug) {
  return String(slug)
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const KIND_LABEL = {
  page: 'Seite', partner: 'Partner', outlet: 'Filiale',
  event: 'Veranstaltung', article: 'Magazin', committee: 'Komitee',
}

/**
 * Turn a `seo_metadata` row into the record `buildPageMeta` and the templates
 * consume. Staff overrides win; the derived values are the fallback (FR-020).
 */
export function recordFromSeoRow(row, variants = []) {
  const title = row.seo_title?.trim() || titleFromSlug(row.slug)
  return {
    recordType: row.record_type,
    recordId: row.record_id,
    slug: row.slug,
    title,
    // Derived per record, never one shared boilerplate line — a description
    // repeated across every partner page suppresses all of them (§10.3, SC-006).
    description:
      row.meta_description?.trim() ||
      `${title} — ${KIND_LABEL[row.record_type] ?? 'Seite'} beim German World Club.`,
    seoTitle: row.seo_title ?? null,
    metaDescription: row.meta_description ?? null,
    shareImage: shareImageFromVariants(variants, row.share_image_alt ?? title),
    language: row.language ?? 'de',
    translationGroupId: row.translation_group_id ?? null,
    indexable: row.indexable,
    published: row.published,
    updatedAt: row.updated_at ?? null,
    sections: [],
  }
}

const RECORD_COLUMNS = `
  m.record_type, m.record_id, m.slug, m.seo_title, m.meta_description,
  m.share_image_id, m.indexable, m.language, m.translation_group_id,
  m.published, m.updated_at, a.alt AS share_image_alt`

/** The database-backed source. */
export function createDbContentSource(pool: Pool) {
  async function variantsFor(assetId, signal) {
    if (!assetId) return []
    const { rows } = await query(
      pool,
      `SELECT v.variant, v.format, v.width, v.height, encode(a.checksum, 'hex') AS checksum_hex
         FROM asset_variants v
         JOIN assets a ON a.id = v.asset_id
        WHERE v.asset_id = $1 AND a.state = 'ready'`,
      [assetId],
      { signal },
    )
    // Only a `ready` asset may be rendered from (FR-059, FR-060).
    return rows.map((r) => ({
      variant: r.variant, format: r.format, width: r.width, height: r.height, checksumHex: r.checksum_hex,
    }))
  }

  return {
    async find(recordType, slug, { signal } = {}) {
      const { rows } = await query(
        pool,
        `SELECT ${RECORD_COLUMNS}
           FROM seo_metadata m
           LEFT JOIN assets a ON a.id = m.share_image_id
          WHERE m.record_type = $1 AND m.slug = $2`,
        [recordType, slug],
        { signal },
      )
      if (rows.length === 0) return null
      return recordFromSeoRow(rows[0], await variantsFor(rows[0].share_image_id, signal))
    },

    /** Reciprocal alternates for a record's translation group (FR-030). */
    async alternates(record, { signal } = {}) {
      if (!record.translationGroupId) return []
      const { rows } = await query(
        pool,
        `SELECT record_type, slug, language
           FROM seo_metadata
          WHERE translation_group_id = $1 AND published = true
          ORDER BY language`,
        [record.translationGroupId],
        { signal },
      )
      return rows.map((r) => ({ recordType: r.record_type, slug: r.slug, language: r.language }))
    },
  }
}

/**
 * An in-memory source over plain records. Used by the rendering, OG-tag and
 * canonical suites so they assert on the resolver and templates rather than on
 * SQL, and by any later feature that wants to preview a page.
 */
export function createFixtureContentSource(records) {
  const all = () => (typeof records === 'function' ? records() : records)
  return {
    async find(recordType, slug) {
      return all().find((r) => r.recordType === recordType && r.slug === slug) ?? null
    },
    async alternates(record) {
      if (!record.translationGroupId) return []
      return all()
        .filter((r) => r.translationGroupId === record.translationGroupId && r.published)
        .map((r) => ({ recordType: r.recordType, slug: r.slug, language: r.language }))
    },
  }
}

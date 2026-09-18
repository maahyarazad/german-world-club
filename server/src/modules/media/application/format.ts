import { hexOf, extensionFor } from '../storage.ts'

export const MIME_FOR_FORMAT: Readonly<Record<string, string>> = Object.freeze({
  webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webm: 'video/webm',
})

/**
 * Variants are always read in the same order.
 *
 * Without an ORDER BY, PostgreSQL returns rows in physical order, which differs
 * between a freshly-inserted asset and one read back on the dedupe path. That
 * would make the `variants` array in an API response non-deterministic for the
 * same asset — which breaks a client building a stable `srcset`, and makes any
 * cached or compared response spuriously different. Width ascending, then
 * format, so the primary encoding leads at each size.
 */
export const VARIANTS_IN_ORDER =
  'SELECT * FROM asset_variants WHERE asset_id = $1 ORDER BY width, format'

/** The same ordering, for rows built in memory rather than read back. */
export const sortVariants = (rows) =>
  [...rows].sort((a, b) => a.width - b.width || String(a.format).localeCompare(String(b.format)))

/** The public URL for one variant. Content-addressed, hence immutable. */
export const urlForVariant = (checksumHex, variant, format) =>
  `/media/${checksumHex}/${variant}.${extensionFor(format)}`

export const toResponse = (asset, variants) => ({
  id: asset.id,
  kind: asset.kind,
  mime: asset.mime,
  width: asset.width,
  height: asset.height,
  durationMs: asset.duration_ms ?? null,
  alt: asset.alt,
  state: asset.state,
  failureReason: asset.failure_reason ?? null,
  bytes: Number(asset.bytes),
  createdAt: new Date(asset.created_at).toISOString(),
  variants: variants.map((v) => ({
    variant: v.variant,
    format: v.format,
    width: v.width,
    height: v.height,
    bytes: Number(v.bytes),
    url: urlForVariant(hexOf(asset.checksum), v.variant, v.format),
  })),
})

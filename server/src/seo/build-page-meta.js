import { OG_TYPES, SITE_NAME, DEFAULT_LOCALE, TITLE_MAX, DESCRIPTION_MAX } from '@gwc/contracts/seo'
import { postureFor } from './surfaces.js'

/**
 * THE metadata resolver (FR-019).
 *
 * A pure function taking the same record the page body renders from, so the two
 * cannot drift — §10.3's named failure mode is "hand-maintained metadata that
 * duplicates on-page copy". Being pure, it is unit-testable with no server and
 * no browser: uniqueness (SC-006) becomes a property test over a record set.
 *
 * This is also the concrete answer to "OG tag handlers": not per-route
 * hand-written tags, but one resolver plus one serializer, with per-route input.
 */

const LOCALES = Object.freeze({ de: 'de_DE', en: 'en_GB' })

/** Truncate at a word boundary, never mid-word. */
export function truncate(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')}…`
}

/** Append the site name once — never twice on a title that already carries it. */
export function withSiteName(title) {
  const t = String(title ?? '').trim()
  if (!t) return SITE_NAME
  if (t === SITE_NAME || t.endsWith(`— ${SITE_NAME}`) || t.endsWith(`- ${SITE_NAME}`)) return t
  return `${t} — ${SITE_NAME}`
}

/** Absolutize against the one canonical origin. A relative og:image breaks every preview bot. */
export function absolute(origin, pathOrUrl) {
  if (!pathOrUrl) return null
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : new URL(pathOrUrl, origin).toString()
}

/** Public path for a record type. Slug-based, never a bare numeric id (FR-027). */
export function pathFor(recordType, slug) {
  const prefix = {
    page: '', partner: '/partners', outlet: '/outlets',
    event: '/events', article: '/magazine', committee: '/committees',
  }[recordType] ?? ''
  return slug === 'home' || slug === '' ? '/' : `${prefix}/${slug}`
}

/**
 * @param {import('@gwc/contracts/seo').contentRecordSchema} record
 * @param {{ origin: string, surfaceAuth?: object, alternates?: Array<{language: string, slug: string, recordType: string}> }} context
 */
export function buildPageMeta(record, context) {
  const { origin } = context
  if (!origin) throw new Error('buildPageMeta requires a canonical origin')

  const path = pathFor(record.recordType, record.slug)
  const canonical = absolute(origin, path)

  // Staff-editable fields WIN over derived values (FR-020). Derived is the
  // fallback, never the other way round.
  const rawTitle = record.seoTitle?.trim() || record.title
  const rawDescription = record.metaDescription?.trim() || record.description

  const title = withSiteName(truncate(rawTitle, TITLE_MAX))
  const description = truncate(rawDescription, DESCRIPTION_MAX)

  // Indexability is the STRICTER of the record's flag and the surface posture
  // (FR-025). A record may opt out of indexing; it may never opt in to a
  // surface that §10.1 declares gated.
  const posture = postureFor(context.surfaceAuth ?? { audience: 'public' }, path)
  const indexed = Boolean(record.indexable) && Boolean(record.published) && posture.indexed
  const robots = indexed ? 'index,follow' : 'noindex,nofollow'

  const image = record.shareImage
    ? {
        url: absolute(origin, record.shareImage.url),
        width: record.shareImage.width,
        height: record.shareImage.height,
        alt: record.shareImage.alt,
      }
    : null

  // Reciprocal alternates, generated from the translation group rather than
  // written per page: a one-directional hreflang is ignored, and the two
  // translations then compete as duplicates, suppressing both (§10.7).
  const alternates = []
  if ((context.alternates ?? []).length > 0) {
    for (const alt of context.alternates) {
      alternates.push({
        hreflang: alt.language,
        href: absolute(origin, pathFor(alt.recordType ?? record.recordType, alt.slug)),
      })
    }
    const german = context.alternates.find((a) => a.language === DEFAULT_LOCALE)
    if (german) {
      alternates.push({
        hreflang: 'x-default',
        href: absolute(origin, pathFor(german.recordType ?? record.recordType, german.slug)),
      })
    }
  }

  const lang = record.language || DEFAULT_LOCALE
  const lastModified = record.updatedAt
    ? new Date(record.updatedAt).toISOString()
    : null

  return {
    title,
    description,
    canonical,
    robots,
    lang,
    alternates,
    og: {
      type: OG_TYPES[record.recordType] ?? 'website',
      siteName: SITE_NAME,
      title,
      description,
      url: canonical,
      locale: LOCALES[lang] ?? LOCALES[DEFAULT_LOCALE],
      image,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      image: image?.url ?? null,
    },
    jsonLd: [],
    lastModified,
  }
}

/**
 * Choose the share image from an asset's variants.
 *
 * Preview bots expect roughly 1200×630, so the `large` WebP is the right
 * choice — and never the stored original, which Principle VI forbids as a
 * rendering path (FR-060).
 */
export function shareImageFromVariants(variants, alt) {
  if (!variants?.length) return null
  const preferred =
    variants.find((v) => v.variant === 'large' && v.format === 'webp') ??
    variants.find((v) => v.variant === 'large') ??
    variants.find((v) => v.variant === 'medium' && v.format === 'webp') ??
    variants.find((v) => v.variant === 'medium')
  if (!preferred) return null
  return {
    url: `/media/${preferred.checksumHex}/${preferred.variant}.${preferred.format}`,
    width: preferred.width,
    height: preferred.height,
    alt,
  }
}

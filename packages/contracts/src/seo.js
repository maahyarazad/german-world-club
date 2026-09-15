import { z } from 'zod'

/**
 * Page metadata and structured-data shapes, shared by the API and every client.
 *
 * §10.3 names the failure mode this prevents: "hand-maintained metadata that
 * duplicates on-page copy drifts and is a recurring defect source." One schema,
 * one producer (`buildPageMeta`), one source record.
 */

export const shareImageSchema = z.object({
  url: z.string().url(),
  // All three are REQUIRED. A share image without dimensions is a validation
  // failure at test time, not a silent omission (FR-018) — and §10.9 names
  // unsized images as the most common cause of layout shift.
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string().min(1),
})

export const alternateSchema = z.object({
  hreflang: z.string().min(2),
  href: z.string().url(),
})

export const pageMetaSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  canonical: z.string().url(),
  robots: z.enum(['index,follow', 'noindex,nofollow']),
  lang: z.string().min(2),
  alternates: z.array(alternateSchema),
  og: z.object({
    type: z.string(),
    siteName: z.string(),
    title: z.string(),
    description: z.string(),
    url: z.string().url(),
    locale: z.string(),
    image: shareImageSchema.nullable(),
  }),
  twitter: z.object({
    card: z.literal('summary_large_image'),
    title: z.string(),
    description: z.string(),
    image: z.string().url().nullable(),
  }),
  jsonLd: z.array(z.record(z.string(), z.unknown())),
  lastModified: z.string().nullable(),
})

/** The record `buildPageMeta` consumes. Domain features widen `sections`. */
export const contentRecordSchema = z.object({
  recordType: z.enum(['page', 'partner', 'outlet', 'event', 'article', 'committee']),
  recordId: z.string(),
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  seoTitle: z.string().nullable().optional(),
  metaDescription: z.string().nullable().optional(),
  shareImage: shareImageSchema.nullable().optional(),
  language: z.string().default('de'),
  translationGroupId: z.string().nullable().optional(),
  indexable: z.boolean().default(true),
  published: z.boolean().default(false),
  updatedAt: z.union([z.string(), z.date()]).nullable().optional(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })).default([]),
})

/** og:type per record type. */
export const OG_TYPES = Object.freeze({
  page: 'website',
  partner: 'business.business',
  outlet: 'business.business',
  event: 'article',
  article: 'article',
  committee: 'website',
})

export const SITE_NAME = 'German World Club'
export const DEFAULT_LOCALE = 'de'
export const TITLE_MAX = 60
export const DESCRIPTION_MAX = 160

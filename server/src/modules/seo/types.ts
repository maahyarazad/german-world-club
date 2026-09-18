import type { ContentRecord, ShareImage } from '@gwc/contracts/seo'

/**
 * A content record as the SEO module reads it.
 *
 * The base shape stays in `@gwc/contracts/seo` — that is the definition every
 * client shares (Principle I). What is added here are the domain fields the
 * structured-data documents read off specific record types: an event has a
 * venue and a capacity, a partner has opening hours and a contract window.
 * They are all optional because `recordType` decides which apply, and the
 * builders already guard on it.
 */
export type SeoRecord = ContentRecord & {
  // --- partner / outlet ---
  address?: { street?: string; city?: string; country?: string; postalCode?: string } | null
  geo?: { lat?: number; lng?: number } | null
  openingHours?: { day?: string; opens?: string; closes?: string }[] | null
  priceFrom?: number | null
  currency?: string | null
  discountPercent?: number | null
  contractStart?: string | Date | null
  contractYears?: number | null
  graceDays?: number | null

  // --- event ---
  startsAt?: string | Date | null
  venue?: { name?: string; address?: string } | null
  capacity?: number | null
  registeredCount?: number | null
  registrationOpensAt?: string | Date | null
  registrationClosesAt?: string | Date | null
  cancelled?: boolean | null

  // --- article ---
  author?: string | null
  publishedAt?: string | Date | null

  breadcrumbs?: { name: string; path: string }[] | null
}

/** One derivative of a share image, as the picture/srcset builders see it. */
export type VariantRow = {
  variant: string
  format: string
  width: number
  height?: number
  bytes?: number
  checksumHex: string
}

export type { ShareImage }

import type { MemberOffer, OfferListItem, BrowseCategory, OfferMedia } from '@gwc/contracts/offers'
import type { Redemption } from '@gwc/contracts/redemptions'
import { get, post, put } from '../lib/api'

/**
 * Browsing and redeeming merchant offers (feature 035) — the same four calls
 * for every kind of account, behind the mount that account's audience can reach.
 * A route has exactly one audience on the server, so the mount differs and
 * nothing else does.
 */
export type OffersKind = 'member' | 'staff' | 'merchant' | 'partner'

export const OFFERS_PREFIX: Record<OffersKind, string> = {
  member: '/member/offers',
  staff: '/admin/club-offers',
  merchant: '/merchant/club-offers',
  partner: '/partner/club-offers',
}

/**
 * The route segment of the offers list inside each portal. A merchant's own
 * offers already use `angebote`, so a merchant's or partner's browsing page is
 * `angebote-entdecken`.
 */
export const OFFERS_LIST_SEGMENT: Record<OffersKind, string> = {
  // Staff browse at `angebote-entdecken` too: `angebote` is marketplace moderation in the staff console.
  member: 'angebote', staff: 'angebote-entdecken', merchant: 'angebote-entdecken', partner: 'angebote-entdecken',
}

export function clubOffersApi(kind: OffersKind) {
  const prefix = OFFERS_PREFIX[kind]
  const query = (params: Record<string, string | undefined>) => {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
    return entries.length === 0 ? '' : `?${new URLSearchParams(entries).toString()}`
  }
  return {
    /**
     * `q` is a text search (feature 042), sent only when it has something in it. `signal` lets the page
     * abandon a request a newer one has replaced, so an old answer cannot overwrite a newer one.
     */
    list: (categoryId?: string, cursor?: string | null, q?: string, signal?: AbortSignal) =>
      get(`${prefix}${query({ categoryId, cursor: cursor ?? undefined, q: q || undefined })}`, { signal }) as Promise<{ items: OfferListItem[]; nextCursor: string | null }>,
    categories: () => get(`${prefix}/categories`) as Promise<{ items: BrowseCategory[] }>,
    detail: (id: string) => get(`${prefix}/${id}`) as Promise<MemberOffer>,
    /** `requestId` is made once per tap and reused on a retry: the server answers a repeat with the original. */
    redeem: (id: string, requestId: string) => post(`${prefix}/${id}/redemptions`, { requestId }) as Promise<Redemption>,
    mine: (cursor?: string | null) =>
      get(`${prefix}/redemptions${query({ cursor: cursor ?? undefined })}`) as Promise<{ items: Redemption[]; nextCursor: string | null }>,
  }
}

/**
 * A super admin choosing which of an offer's existing files leads (feature 042).
 *
 * A standalone export, not a member of `clubOffersApi(kind)`: that object exists for
 * every kind of account, and this route exists only for staff. The server narrows it to
 * a super admin; the page only decides whether to show the control.
 */
export const setOfferMainMediaAsStaff = (id: string, assetId: string) =>
  put(`/admin/offers/${id}/main-media`, { assetId }) as Promise<OfferMedia>

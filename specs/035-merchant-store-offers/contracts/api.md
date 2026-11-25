# API Contracts: Merchant Stores, Categorised Offers and Redemption Reports

Types live in `@gwc/contracts` (`offers.ts`, `stores.ts`, `redemptions.ts`, `errors.ts`, `permissions.ts`). Errors are RFC 9457 problem+json and clients branch on `type`. Every route declares `config.auth`. "Audience" is the token audience; `staff` routes also name a module and flag.

## Merchant (audience `merchant`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/merchant/store` | Own store (creates nothing). 404 `store-not-found` before it exists |
| POST | `/merchant/store` | Create the store. 409 `store-exists` if the organisation already has one |
| PATCH | `/merchant/store` | Edit description and opening hours. Body carries `version`; stale → 409 |
| PUT | `/merchant/store/cover` | `{ assetId }`. Must be an image within 2% of 16:9, else 422 `cover-aspect-ratio`; the previous cover stays |
| PUT | `/merchant/store/media` | Replace the gallery: `{ assetIds: string[0..10] }`; an 11th → 422 `offer-media-limit` (shared code) |
| GET | `/merchant/offers` | Own offers, any state, with category and media |
| POST | `/merchant/offers` | Create a draft. `categoryId` required |
| PATCH | `/merchant/offers/:id` | Edit own offer (title, description, type, value, window, conditions, limits, category) |
| PUT | `/merchant/offers/:id/media` | Replace the ordered set: `{ assetIds: string[1..10] }` |
| POST | `/merchant/offers/:id/publish` | `draft → published`, no approval step. Refused while the store is inactive (`store-inactive`). Queues nothing itself: the existing trigger inserts the one notification (`offer:<id>`), so publishing again never notifies again |
| POST | `/merchant/offers/:id/withdraw` | `published → withdrawn` |
| PUT | `/merchant/offers/order` | `{ ids: string[] }` display order |
| GET | `/merchant/reports/redemptions` | Own organisation only. Query: `offerId`, `categoryId`, `from`, `to`, `cursor` |
| GET | `/merchant/categories` | Visible categories for the offer form |
| POST | `/media/merchant` | Existing upload route, reused. Merchant caps: photo < 1 MiB, video < 5 MiB, else 413 `media-too-large`. Progress is client-side |
| GET | `/media/merchant/:id` | Processing status of the caller's own asset (identical 404 for anyone else's) |
| DELETE | `/media/merchant/:id` | Delete the caller's own asset that nothing uses; 409 `media-in-use` when a store, offer or logo still references it |

Another organisation's offer or store answers an identical 404 (`guardOrganisationScope`).

## Browse and redeem (one handler set, registered per audience)

Paths: member `/member/offers…`, staff `/admin/club-offers…`, merchant `/merchant/club-offers…`, partner `/partner/club-offers…`.

| Method | Suffix | Purpose |
|---|---|---|
| GET | `` | Visible offers; `categoryId`, `cursor`. Thumbnails only |
| GET | `/categories` | Visible categories with offer counts |
| GET | `/:id` | One visible offer (the existing member detail route is kept) |
| POST | `/:id/redemptions` | Body `{ requestId: uuid }`. 201 with `{ id, reference, redeemedAt }`; the same `requestId` returns the original with 200 |
| GET | `/redemptions` | The caller's own redeemed items (paged) |

Problem types: `offer-not-available` (expired, withdrawn, store inactive, not visible; indistinguishable from unknown), `offer-sold-out`, `per-person-limit-reached`, `own-offer` (merchant on its own organisation's offer), `account-not-active`.

## Staff (audience `staff`, module `merchant_offers`)

| Method | Path | Flag | Purpose |
|---|---|---|---|
| GET | `/admin/stores` | read | All stores with organisation name, active flag and offer counts |
| PUT | `/admin/stores/:id/active` | status | `{ active: false \| true \| 0 \| 1, reason }`; reason required when deactivating. Audited. Idempotent |
| GET | `/admin/offer-categories` | read | All categories (including hidden) with counts |
| POST | `/admin/offer-categories` | write | `{ slug, nameDe, nameEn }` |
| PATCH | `/admin/offer-categories/:id` | edit | Rename, reorder (`position`), hide or show (`visible`) |
| GET | `/admin/reports/redemptions` | read | Platform report. Query adds `organisationId`. Totals over the whole filtered set |

There is no category delete route. A non-superadmin without the grant is refused. No staff route edits a redemption.

## Report shape (both report routes)

```
{
  totals: { count: number, estimatedSavingCents: number | null },
  byOffer: [{ offerId, title, categoryId, count }],
  rows: [{ id, reference, redeemedAt, offerId, offerTitle, categoryId,
           redeemerKind: 'member'|'staff'|'merchant'|'partner', redeemerName }],
  nextCursor: string | null
}
```

`redeemerName` is a handle, "First L." or a staff/organisation display name. It never includes an email, mobile number, legal name or id of the account. The admin total for a period equals the sum of the merchant totals (SC-007).

## Public (no route)

The landing carousel adds no route. `/` and `/en` carry `<!--gwc:partners-->…<!--/gwc:partners-->`. Each entry is `{ name, logo (derivative, with width/height), href? }`. Merchants have no `href`. The section is absent when empty. `/media/:checksum/:variant.:ext` remains the only way to fetch a logo.

## Compatibility

- `GET /member/offers/:id` keeps its shape; `memberOfferSchema` gains `category`, `media[]` (derivatives) and `perPersonLimit`, all additive.
- `redemptions.member_id` disappears from the database; nothing in the API exposed it.
- The permission module list gains `merchant_offers`. `tests/authz/matrix.test.ts` and the console's permission editor are updated from `MODULES`.

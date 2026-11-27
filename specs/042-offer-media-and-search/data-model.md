# Data Model: Offer Media Gallery, Fallback Image and Search

**Feature**: 042-offer-media-and-search | **Date**: 2026-11-27

This feature adds **no table and no column**. It adds four indexes, one derived rule (the *lead* of an offer's media), one operation on existing rows, and client-side constants. Everything below refers to structures that already exist unless marked **new**.

## 1. Existing tables this feature reads or writes

### `offers` (migration 015, extended by 046)

| Column | Used for |
|---|---|
| `id`, `state`, `valid_from`, `valid_until`, `store_id`, `organisation_id` | unchanged; `VISIBLE_OFFER` still decides who may see an offer |
| `title text NOT NULL` (<= 160 by the request schema) | searched |
| `description text NULL` (<= 4000 by the request schema) | searched; `NULL` never matches |
| `published_at` | unchanged keyset ordering `(published_at DESC, id DESC)` |
| `updated_at` | the edit-conflict version. **Not** moved by a main-media change |

### `offer_media` (migration 046)

`(offer_id, asset_id, position)`, primary key `(offer_id, position)`, `position BETWEEN 0 AND 9`, `offer_id` cascades on delete, `asset_id` restricts.

Invariants this feature relies on and preserves:
- at most ten rows per offer (`position` bound);
- positions are dense from 0 after any operation in this feature (the operation below rewrites them 0..n-1);
- there is no unique constraint on `(offer_id, asset_id)`, but the application prevents repeats: `setOfferMedia` calls `loadOwnedAssets` (`modules/media/application/owned-assets.ts`), which refuses a repeated id with `400 validation-failed` ("The same file appears more than once"). So an offer's set holds each asset at most once, and the new operation, which only moves rows that exist, cannot create a repeat. No constraint is added by this feature.

### `assets` (migration 003)

`state IN ('processing','ready','failed')`. Only `ready` assets are delivered (`loadMediaItems`).

### `marketplace_listings` (migration 019)

| Column | Used for |
|---|---|
| `title text` (3 to 140 by CHECK) | searched |
| `body text` (10 to 8000 by CHECK) | searched. This is the "description" members write |
| `state` | unchanged: only `active` is browsable |
| `created_at`, `id` | unchanged keyset ordering |

### `audit_log`

One row per main-media change: `action = 'offer_updated'`, `target_type = 'offer'`, `target_id = offer id`, `actor_kind = 'merchant' | 'admin'` (the `account_kind` enum; a staff account is `'admin'`), `detail = { offerChange: { changed: ['mainMedia'], assetId } }`. `offerChange` is already in `SAFE_DETAIL_KEYS` (`ops/audit.ts`), so no allowlist change.

## 2. New: indexes (migration `049_offer_marketplace_search.sql`)

```text
CREATE EXTENSION IF NOT EXISTS pg_trgm;

offers_title_trgm_idx        ON offers               USING gin (title       gin_trgm_ops) WHERE state = 'published'
offers_description_trgm_idx  ON offers               USING gin (description gin_trgm_ops) WHERE state = 'published'
listings_title_trgm_idx      ON marketplace_listings USING gin (title       gin_trgm_ops) WHERE state = 'active'
listings_body_trgm_idx       ON marketplace_listings USING gin (body        gin_trgm_ops) WHERE state = 'active'
```

- **Partial on the live state**, so a draft, a withdrawn offer or a hidden listing is never in the index and cannot be reached through it; and the index stays small.
- Each predicate is a literal conjunct of the query's own `WHERE` (`o.state = 'published'` inside `VISIBLE_OFFER`; `l.state = 'active'` in marketplace browse), which is what lets the planner use a partial index.
- `IF NOT EXISTS` on indexes follows the house style (`CREATE INDEX IF NOT EXISTS`). The extension line has no fallback on purpose: see research R11.
- Rollback: `DROP INDEX` the four; the extension may stay.

## 3. Derived rule: the *lead* of an offer's media

**The lead is the first item, by `position`, whose asset is `ready`.** It is defined once as the SQL fragment `LEAD_OFFER_ASSET` (research R7) and drives:

| Surface | Reads the lead as |
|---|---|
| Offers list card | `OfferListItem.thumbnail` (the lead as a `MediaItem`; a video's `posterUrl` is its still picture), or `null` |
| Offer detail | `MemberOffer.media[0]`, because the detail returns every ready item in order, which begins with the lead |
| Redemption list / redeem response | `thumbnailUrl` (unused by both clients today; unified for consistency) |

Consequence, stated as a rule the tests assert: for any offer, `list.thumbnail?.assetId === detail.media[0]?.assetId`, including when the first stored item is still processing (both skip it).

`thumbnail: null` and `media: []` both mean **"no usable media; the client shows the fallback"** (R1/R3). They never mean "an error".

## 4. New operation: set the main media

**Input**: `offerId`, `assetId`, and the actor (a merchant scoped to one organisation, or a super admin).

**Algorithm (one transaction)**:

1. `SELECT id FROM offers WHERE id = $offer [AND organisation_id = $org] FOR UPDATE`. No row: standard 404 (identical for "not yours" and "does not exist").
2. `SELECT asset_id FROM offer_media WHERE offer_id = $offer ORDER BY position`.
3. If `assetId` is not in that list: refuse `422 offers/media-not-attached`; nothing changes.
4. If it is already first: stop, nothing written, no audit entry (idempotent).
5. New order = `[assetId, ...the rest in their existing relative order]`.
6. `DELETE FROM offer_media WHERE offer_id = $offer`, then insert `(offer, asset, 0..n-1)`.
7. Write the audit entry in the same transaction (`auditInTransaction`).
8. Return the ready items in the new order.

**State transitions**: none. Offer `state` is untouched; this is not publishing or withdrawing.

**Concurrency**: the row lock serialises two changes to one offer; the later one sees the earlier one's order and applies on top, so the offer is never left with a missing or duplicated item (spec US3 scenario 8). A concurrent `PUT /merchant/offers/:id/media` (replace whole set) takes the same `FOR UPDATE` lock, so the two cannot interleave.

## 5. Search text (transient, never stored)

| Property | Rule |
|---|---|
| Source | the `q` query parameter on four offers mounts and on `GET /marketplace/listings` |
| Normalisation | trimmed; split on whitespace; terms compared case-insensitively and de-duplicated |
| Bounds | empty = no search; otherwise 2 to 80 characters and at most 6 terms |
| Escaping | `\`, `%`, `_` in each term are escaped, then wrapped as `%term%` |
| Predicate | for every term, `(title ILIKE term OR description ILIKE term)`; terms combined with `AND`; the whole appended with `AND` to the existing visibility and filter predicates |
| Retention | none. Not written to the database, the audit log, the fault records or the logs (R15) |

## 6. Client-side constants and assets (not database)

| Item | Where it lives |
|---|---|
| `OFFER_MEDIA_ASPECT = { width: 16, height: 9 }` | `@gwc/contracts/offers` (new export) |
| `SEARCH_MIN_LENGTH = 2`, `SEARCH_MAX_LENGTH = 80`, `SEARCH_MAX_TERMS = 6`, `searchQuerySchema` | `@gwc/contracts/search` (new module, new `exports` entry) |
| Fallback image | `client/src/assets/offer-fallback.webp` and `expo-client/german-world-club/assets/offer-fallback.webp` (byte-identical, test-enforced) |
| Debounce 300 ms, "send only when empty or >= 2 chars" | each client (UI timing, not a business rule) |

## 7. Entities and their relationships

```text
Offer 1 ──── 0..10 OfferMedia ──── 1 Asset(state)         lead = first ready by position
Offer 1 ──── 1 Store, 1 Organisation                        visibility unchanged (VISIBLE_OFFER)
MarketplaceListing 1 ──── 0..n ListingMedia                  unchanged; listing media is not changed by this feature
FallbackImage                                                belongs to the clients; no relationship to any Offer
```

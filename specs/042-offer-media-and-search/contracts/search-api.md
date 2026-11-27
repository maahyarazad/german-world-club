# Contract: Text search on the offers and marketplace lists

**Feature**: 042-offer-media-and-search | Shared types live in `@gwc/contracts/search` (new, needs an `exports` entry in `packages/contracts/package.json`), `@gwc/contracts/offers` and `@gwc/contracts/marketplace`.

## Endpoints that gain `q`

| Method and path | Audience | Existing parameters kept | Handler |
|---|---|---|---|
| `GET /member/offers` | member | `categoryId`, `cursor` | `redemptions/controller.ts` `list` |
| `GET /admin/club-offers` | any staff (`anyStaff`) | same | same handler set |
| `GET /merchant/club-offers` | merchant | same | same |
| `GET /partner/club-offers` | partner | same | same |
| `GET /marketplace/listings` | member | `category`, `mode`, `cursor`, `limit`, category-specific filters | `marketplace/controller.ts` `browse` |

No route is added, removed or re-postured. No public (signed-out) route accepts `q`.

## Request

```text
q   string, optional.
    Trimmed by the server. Empty or absent  -> no search (the list is exactly as before).
    Otherwise 2..80 characters and at most 6 whitespace-separated terms.
```

Shared definition (the server's route schema and both clients import it):

```ts
// @gwc/contracts/search
export const SEARCH_MIN_LENGTH = 2
export const SEARCH_MAX_LENGTH = 80
export const SEARCH_MAX_TERMS = 6
export const searchQuerySchema = z.string().trim().max(SEARCH_MAX_LENGTH)
  .refine((v) => v === '' || v.length >= SEARCH_MIN_LENGTH, 'at least 2 characters')
  .refine((v) => v.split(/\s+/).filter(Boolean).length <= SEARCH_MAX_TERMS, 'at most 6 words')
  .optional()
```

Offers: `offerListQuerySchema` gains `q: searchQuerySchema`.
Marketplace: the route's `.loose()` querystring schema gains `q: searchQuerySchema`, **and `'q'` is added to `RESERVED`** in `marketplace/controller.ts` (otherwise it is read as a category-specific filter and answers 400 "'q' is not a filter"). `ListingQuery` gains `q?: string`.

## Semantics

| Rule | Detail |
|---|---|
| Fields | Offers: `title`, `description`. Listings: `title`, `body` (the member's description). Nothing else. |
| Case | Not case-sensitive. |
| Part of a word | A term matches anywhere inside a word or across the text (`rad` matches `Fahrrad`). |
| Several terms | Every term must be found, each in the title **or** the description. |
| Literals | `%`, `_` and `\` in a term are matched as themselves. |
| Accents | Not folded: `Cafe` does not match `Café`. |
| Filters | ANDed with every existing filter and with visibility. |
| Order and paging | Unchanged: offers `published_at DESC, id DESC`; listings `created_at DESC, id DESC`; same opaque `nextCursor`. A cursor from one search used with another is harmless: the order is the same and the predicate is re-applied. |
| Visibility | The search predicate is only ever an `AND` after the visibility predicate. A record the requester could not see without `q` is never returned and its existence is not revealed (offers: `VISIBLE_OFFER`; listings: `state = 'active'` and an active owner). |

## Response

Unchanged. `offerListSchema` (`{ items, nextCursor }`) and the marketplace page (`{ items, nextCursor }`) keep their shapes; `q` adds no field. Category counts from `GET <prefix>/categories` are **not** narrowed by the search.

## Errors

| Case | Status | Problem type |
|---|---|---|
| `q` is one character after trimming | 400 | `validation-failed` |
| `q` longer than 80 characters | 400 | `validation-failed` |
| `q` with more than 6 terms | 400 | `validation-failed` |
| Anything else about the request | as today | as today |

A search that matches nothing is **200 with `items: []` and `nextCursor: null`**, not an error.

## Logging and privacy

- The request serializer in `plugins/01-logging.ts` writes `?q=[redacted]` in `req.url`; all other parameters are logged as before.
- The text is never stored, audited or placed in a fault record.
- Residual: a reverse proxy's own access log (outside this repository) sees the URL.

## Database

`pg_trgm` and four partial GIN indexes, `049_offer_marketplace_search.sql` (see `data-model.md` section 2). The queries still name their columns; `tests/marketplace/no-select-star` covers the new code.

## Performance budget

First page p95 under 300 ms at 50,000 `marketplace_listings` and 5,000 `offers`, for a three-or-more-character term and for a two-character term (which the trigram index cannot answer by itself; see research R11). Both run inside the existing `marketplace` and `member-read` request budgets; no outbound dependency is added.

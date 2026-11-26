# Contract: Staff listing endpoints

Module `marketplace_moderation`. `/admin` is already gated and never indexed. `write` and `edit` stay unused: nothing here changes what a member wrote.

## `GET /admin/marketplace/listings` (new)

`auth: { audience: 'staff', module: 'marketplace_moderation', flag: 'read' }`, budget `admin-read`.

Query:

| Param | Type | Notes |
|---|---|---|
| `state` | one of the marketplace states | optional |
| `category` | one of the categories | optional |
| `ownerId` | uuid | optional |
| `q` | string, 1 to 100 | optional. Case-insensitive substring of the title, `%` and `_` escaped. |
| `cursor` | opaque string | optional |
| `limit` | number | defaults to 25; bounded to 50 **in the handler**, like browse |

Response `200`:

```ts
type StaffListingPage = {
  items: StaffListingRow[]
  nextCursor: string | null
}
type StaffListingRow = {
  id: string
  title: string
  category: MarketplaceCategory
  mode: MarketplaceMode
  state: MarketplaceState
  hiddenFromState: 'draft' | 'active' | null   // null on legacy rows
  owner: { id: string; displayName: string | null }
  createdAt: string
  publishedAt: string | null
  expiresAt: string | null
  stateChangedAt: string
  openReports: number
}
```

Ordered `created_at DESC, id DESC`, keyset paged.

**Never returned**: email, mobile number, legal name, the contact value, storage keys, body text. The page lists; `GET /admin/marketplace/listings/:id` (existing) opens one.

**Merchant offers cannot appear**: they are different tables and this query reads only `marketplace_listings`.

A staff member without the grant gets the same refusal as on every other `/admin` route. A member token is refused at the audience check.

## `GET /admin/marketplace/listings/:id` (existing, extended)

Adds `hiddenFromState` and `openReports` to the existing response. Still returns the listing in any state.

## `POST /admin/marketplace/listings/:id/hide` (existing, extended)

Body `{ reason: string (3 to 2000) }`. The console labels this **Disable**.

- Now allowed from `draft` as well as `active`. Any other state is `403 validation-failed` ("Cannot hide a "<state>" listing"), as today.
- Records `hidden_from_state`.
- Audit `marketplace_listing_hidden`, `statusFrom` is the real prior state.
- Effect is on the next request: the listing leaves browse, detail, search, `/marktplatz` counts and notifications.

## `POST /admin/marketplace/listings/:id/restore` (existing, extended)

Body `{ reason }`. The console labels this **Enable**.

- Returns the listing to `hidden_from_state`; `NULL` means `active`.
- A listing hidden from `draft` returns to `draft` and is **not** published.
- Clears `hidden_from_state`.
- Audit `marketplace_listing_restored` with `statusTo` set to the actual state.

## `DELETE /admin/marketplace/listings/:id` and report routes

Unchanged.

## Console behaviour (display only)

- A new **All listings** tab beside the report queue: filters for state, category and owner, a title search, paged load-more.
- Row action **Disable** appears for `draft` and `active` when the staff member holds `status`; **Enable** for `hidden`. Both open the existing reason field. A single reason field is open per row.
- State pills reuse `LISTING_TONE`; copy goes through both catalogues.
- While loading, `PageLoader`; never a false "no listings".
- Failures go to `console.error('<Component>.<function>', …)`, not to state.
- The authz matrix test's pinned list includes the new route.

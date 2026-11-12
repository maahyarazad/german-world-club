# UI contract: Marketplace "New listing" panel

This feature adds no HTTP contract. Every call below is an existing feature-008 member route,
typed from `@gwc/contracts`. This file pins the user-facing behaviour that tests and review
check against.

## Routes consumed (unchanged)

| Call | Type | Used by |
|---|---|---|
| `GET /auth/me` | `MeResponse` | app (new caller); web already reads it through `useCapabilities` |
| `GET /marketplace/categories` | `CategoriesResponse` | web, app |
| `GET /marketplace/listings?category&mode&cursor` | `ListingPage` | web, app |
| `GET /marketplace/listings/:id` | `Listing` | app |
| `GET /marketplace/terms`, `POST /marketplace/terms/accept` | `TermsResponse` | web, app |
| `POST /marketplace/listings` | `CreateListingRequest` → `{ id }` | web, app; refused without `marketplace_post` |
| `POST /media`, `GET /media/:id` | `Asset` | web, app |
| `POST /marketplace/listings/:id/media` | `{ assetId }` | web, app |

## Web: `/konsole/mitglied` (member area index)

| Element | Contract |
|---|---|
| Header button | `PageHeader actions`, top right. Label `memberMarketplace.newListing`. `aria-haspopup="dialog"`, `aria-expanded` reflects the drawer. **Not rendered** without `marketplace_post`. |
| Drawer | A `<dialog>` opened with `showModal()`, `aria-labelledby` its heading (`memberMarketplace.composeTitle`). Anchored to the right edge, full height, `min(560px, 100vw)` wide. Enters from the right, exits to the right, with no transition under `prefers-reduced-motion`. |
| Close | Close button (`memberMarketplace.close`), Escape, or a click on the backdrop. Focus returns to the header button. |
| Draft | Kept across close and reopen while the page is mounted. |
| Publish, all media attached | Drawer closes, the page shows `memberMarketplace.posted`, the list reloads, and the form is cleared. |
| Publish, some media failed | Drawer stays open with failed items and `memberMarketplace.mediaRetry`. The list still reloads, because the listing exists. |
| Page without the form | Header, filters and list only. No inline compose card. |

## Mobile: `(member)/marketplace`

| Element | Contract |
|---|---|
| Tab | Second in the bar: Threads, **Marketplace**, Activity, Events, Profile. Label `tabs.marketplace`. |
| `marketplace/index` | Category chips (all + each category) and mode chips (all, offer, request), a paged list with pull-to-refresh, and empty state `marketplace.empty`. A row opens `marketplace/listing/[id]`. |
| Header right | Text button `marketplace.newListing`, only when `/auth/me` permissions include `marketplace_post`. Re-checked on focus. |
| `marketplace/new` | `presentation: 'card'`, `animation: 'slide_from_right'`, title `marketplace.composeTitle`. Back, swipe and hardware back close it, and the input is discarded. |
| Form | Category and mode chips; title; description; the category's `fields` (text/number → TextField, enum → Chips, boolean → Switch, date → DatePartsField); vehicle features; photos with alt text (at most `LISTING_MEDIA_MAX`); contact method chips; optional expiry (DatePartsField); terms acceptance when `acceptedVersion !== version`. |
| Publish enabled | Categories and terms loaded, terms accepted, title ≥ 3 chars, body ≥ 10 chars, not busy. These are the web's thresholds, and the server re-checks all of them. |
| Publish, all media attached | `router.back()`. The index reloads on focus and shows the new listing. |
| Publish, some media failed | Stay on the screen with failed items and `marketplace.mediaRetry`, attaching to the same listing id. |
| `marketplace/listing/[id]` | The shared `ListingDetail` component (also used by `activity/listing/[id]`). Read-only. |

## Strings

Every key exists in `de` and `en` on its face. On the web, `npm run -w client test:i18n` and
`tests/i18n-parity.test.ts` enforce that. On the app, `tsc` enforces it because `de` is typed
against `en`. The new keys are listed in `quickstart.md` §Strings for review, not here.

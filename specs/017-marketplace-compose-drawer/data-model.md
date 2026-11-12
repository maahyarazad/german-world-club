# Data model: Marketplace "New listing" panel, web and mobile

**No persisted change.** No migration, table, column or trigger. Listings, categories, terms
and media are feature 008's (`specs/008-marketplace/data-model.md`) and are read and written
through the existing member routes unchanged.

## Shared constant (contracts)

| Name | Where | Value | Replaces |
|---|---|---|---|
| `LISTING_MEDIA_MAX` | `packages/contracts/src/marketplace.ts` | `20` | `MAX_MEDIA_PER_LISTING` in `server/src/modules/marketplace/application/media.ts` **and** `client/src/member/MediaPicker.tsx` (R10) |

The `marketplace_listing_media` CHECK constraint stays the authority. The constant is early
feedback and must equal it, and the server's existing media test covers that limit.

## Client state (not persisted)

### Web: `Marketplace` page

| State | Type | Notes |
|---|---|---|
| `composeOpen` | `boolean` | Drives `Drawer open`. Never true without `marketplace_post`, because the drawer is not rendered then. |
| `posted` | `boolean` | Moved up from `ComposeListing` (R4). Set when `onPosted({ complete: true })`, cleared when the drawer reopens. |

`ComposeListing` keeps every field it has today. Because the drawer never unmounts it (R3),
that state now outlives a close.

### Mobile: `marketplace/new` screen

The same fields as the web form, typed from `CreateListingRequest`: `category`, `mode`,
`title`, `body`, `details`, `features` (vehicle only), `contactMethod`, `expiresAt`, plus:

| State | Type | Notes |
|---|---|---|
| `media` | `(Picked & { alt: string; status: MediaStatus })[]` | `Picked` from `src/lib/pick-media.ts`. `status` is `pending → uploading → processing → attached / failed`, as on the web. |
| `attachingTo` | `string \| null` | The created listing's id while media are attaching or have failed, so Retry never creates a second listing (R11). |
| `loadFailed` | `boolean` | Categories or terms could not be loaded. Publish stays disabled. |

The screen's state is discarded when it is popped (spec edge case). There is no draft
storage.

### Mobile: capability snapshot

`MeResponse['permissions']` from `GET /auth/me`, re-read on each focus of the Marketplace
screen. It is used only to show or hide the New listing button (R9).

# Contract: Member listing endpoints (changes)

Types live in `@gwc/contracts/marketplace`. Problems are RFC 9457; clients branch on `type`, never `detail`. All routes are `audience: 'member'`.

## `POST /marketplace/listings` (changed)

New optional body field:

| Field | Type | Meaning |
|---|---|---|
| `publish` | boolean, optional | Omitted or `true`: the listing is `active` now (today's behaviour). `false`: stored as `draft`, visible only to the owner and staff. |

Response `201` is unchanged and its `state` reports which. A draft still needs accepted terms and still takes one place in the quota. A job offer is still `422 marketplace/mode-not-allowed`.

## `PATCH /marketplace/listings/:id` (changed)

| Field | Type | Meaning |
|---|---|---|
| `version` | string, **required** | The `version` last read for this listing. |
| `published` | boolean, optional | `true` publishes, `false` unpublishes, absent leaves the state alone. |
| `title`, `body`, `category`, `details`, `features`, `contactMethod`, `expiresAt` | as today | Every field optional; present-and-`null` on `expiresAt` means unlimited. |

Response `200`: the listing as the owner sees it (the usual listing fields plus `version`, `stateChangedAt`, `canEdit`, `canPublish`, `moderated`). The full read with `details`, `features` and `media` is `GET /marketplace/mine/:id`.

| Status | `type` | When |
|---|---|---|
| 404 | `not-found` | Absent **or** someone else's. Same status, body and headers. |
| 409 | `marketplace/not-editable` (new) | State is `hidden`, `sold`, `filled` or `withdrawn`. |
| 409 | `conflict` | `version` is stale. Nothing was written. |
| 422 | `marketplace/mode-not-allowed` | Category change, or publishing a draft job offer. |
| 400 | `validation-failed` | A field is invalid, or the expiry is in the past while publishing (`expiresAt must be in the future to publish`). Per-field problems as today. |

Rules, all decided by the server:

- Editable states are `draft`, `active` and `expired`.
- `published: true` on `hidden` is refused with the same 409 as an edit.
- `published: true` on `expired` needs a null or future `expiresAt` in the same request (or already stored).
- Field changes and the publish change are one transaction and one version bump.
- Publish or unpublish writes `marketplace_listing_state_changed`.

## `GET /marketplace/mine/:id` (new)

Owner's full view of one listing in **any** state. 404 for absent or not-owned.

```ts
type OwnListing = Listing & {
  state: MarketplaceState
  version: string           // pass back on PATCH
  canEdit: boolean          // state in draft | active | expired
  canPublish: boolean       // state in draft | expired
  moderated: boolean        // state === 'hidden'
  expiresAt: string | null  // null = unlimited
}
```

It never returns the contact value, only the preference, as `Listing` does today.

## `GET /marketplace/mine` (unchanged route, now used)

Summaries of the caller's listings in every state, newest state change first. Both clients start calling it. It gains `version`, `canEdit` and `canPublish` per item so the list can show the Edit button without a second request.

## Media (unchanged)

`POST /marketplace/listings/:id/media` and `DELETE …/media/:assetId` keep working, and now also require an editable state. They do not change `version`.

## Client behaviour (display only)

- Web drawer and app screen show **Publish** as a checkbox/switch. It is checked for `active`, unchecked for `draft`, disabled with an explanation when `moderated`.
- On `409 conflict` the form says the listing changed and offers Reload. It does not retry.
- Failures are logged with `console.error('<Component>.<function>', error instanceof ApiError ? error.problem : error)` and stored in no state. `HANDLE_REQUIRED` and sign-in redirects keep their existing handling.

# Contracts: member posting, no job offers

## HTTP (all `audience: 'member'`)

| Route | Change in 021 |
|---|---|
| `POST /marketplace/listings` | No longer `requires: 'marketplace_post'`. Refuses `422 marketplace/mode-not-allowed` when `mode` isn't in `modesFor(category)` (a job offer). Nothing is stored, and no quota is reserved. Other refusals are unchanged: terms not accepted, quota, validation, rate limit. |
| `PATCH /marketplace/listings/:id` | Refuses `422 marketplace/mode-not-allowed` when a category change would make the listing a job offer. Edits to an existing job offer that keep it one are accepted. |
| `POST /marketplace/listings/:id/media`, `DELETE …/media/:assetId` | No longer `requires: 'marketplace_post'`. Ownership is still 404. |
| `GET /marketplace/categories` | Each category gains `modes: ('offer' \| 'request')[]` (job: `['request']`). |
| `GET /auth/me` | No longer reports `marketplace_post` (the key is stripped). |

Problem (new, in `@gwc/contracts/errors`):

```text
MARKETPLACE_MODE_NOT_ALLOWED
  type:   https://…/problems/marketplace/mode-not-allowed
  title:  'Mode not allowed for this category'
  status: 422
  detail: English, e.g. "Members cannot offer a job; post a job request instead."
```

A database `check_violation` on `marketplace_no_new_job_offer` maps to the same problem.

Merchant, partner and staff tokens are still refused on every member listing route, as today.

## Web console (`client/src/member/Marketplace.tsx`)

| Where | What |
|---|---|
| Page header | **Neues Inserat / New listing** for every member. It no longer depends on a permission. |
| Compose drawer, mode | Only the selected category's `modes`. Changing category to Job switches the mode to Request. |
| Compose drawer, note | When the category allows one mode (Job): **„Hier kannst du Arbeit suchen. Stellenangebote sind für Mitglieder nicht möglich.“ / "You can look for work here. Job offers aren't available to members."** |
| Refusal `mode-not-allowed` | Logged (`console.error('ComposeListing.submit', problem)`) and shown as the same note. |
| Browse filters | Unchanged. Job and both modes stay filterable. |

## App (`expo-client/german-world-club`)

| Where | What |
|---|---|
| `(member)/marketplace/index.tsx` | New listing in the header for every member. |
| `(member)/marketplace/new.tsx` | Mode chips from `activeDef.modes`, auto-switch, the same note and refusal handling. |

Strings in both catalogues on both faces: `memberMarketplace.jobOfferNote` (web) and
`marketplace.jobOfferNote` (app).

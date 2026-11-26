# Data Model: Marketplace Listing Management

One table changes. No table is added.

## `marketplace_listings` (existing)

| Column | Change | Notes |
|---|---|---|
| `state` | unchanged | `draft`, `active`, `sold`, `filled`, `withdrawn`, `expired`, `hidden` |
| `published_at` | semantics widened | `NULL` for a listing never published. Kept when unpublished. Set with `COALESCE(published_at, now())` on publish. Existing `CHECK (state <> 'active' OR published_at IS NOT NULL)` still holds. |
| `hidden_from_state` | **new**, `marketplace_state NULL` | The state the listing was in when staff disabled it. `draft` or `active`. `NULL` on legacy hidden rows and on every non-hidden row. |
| `updated_at` | unchanged | Doubles as the **version token** (see below). Every edit that changes a field bumps it. |

### Migration `048_marketplace_listing_management.sql`

Re-runnable, like 042.

- `ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS hidden_from_state marketplace_state`.
- `CHECK (hidden_from_state IS NULL OR (state = 'hidden' AND hidden_from_state IN ('draft','active')))`, added `NOT VALID` then validated, so legacy rows (`NULL`) pass.
- `CREATE INDEX IF NOT EXISTS marketplace_listings_staff_idx ON marketplace_listings (created_at DESC, id DESC)` for the all-states staff list.
- No backfill: `NULL` already means "restore to `active`", the old behaviour.
- No trigger change. The job-offer trigger (`draft` to `active` refused for a job offer) stays the guarantee behind publish.

## State machine

```
            create(publish=false)        create(publish=true)
                     │                          │
                     ▼                          ▼
   ┌──────────── draft ◄──── owner: unpublish ── active ──► sold | filled | withdrawn   (owner, terminal)
   │               │ ───── owner: publish ─────►   │
   │               │                               ├──► expired   (expiry job: expires_at IS NOT NULL AND <= now())
   │               │                               │       │
   │               │                               │       └── owner: edit + publish + new expiry ──► active
   │               ▼                               ▼
   └── staff: disable ──────────────► hidden ◄── staff: disable
                                         │
                                         └── staff: enable ──► hidden_from_state (draft or active); NULL means active
```

| From | To | Who | Condition |
|---|---|---|---|
| (none) | `draft` | owner | create with `publish = false` |
| (none) | `active` | owner | create with `publish = true` (default) |
| `draft` | `active` | owner | `expires_at` null or in the future; not a job offer |
| `active` | `draft` | owner | none |
| `expired` | `active` | owner | same save sets a null or future `expires_at` |
| `active` | `sold`/`filled`/`withdrawn` | owner | unchanged, terminal |
| `active`, `draft` | `hidden` | staff (`status`) | reason of 3 or more characters; records `hidden_from_state` |
| `hidden` | `hidden_from_state` or `active` | staff (`status`) | reason required; clears `hidden_from_state` |
| any | removed | staff (`delete`) | unchanged |

**Editable by the owner**: `draft`, `active`, `expired`. Everything else is `409 marketplace/not-editable`.

**Publishable by the owner**: `draft`, `expired`, `active` (to unpublish). Never `hidden`.

## Version token

`version` = `to_char(updated_at, …)` at microsecond precision, produced by the database (a JS `Date` keeps milliseconds). The edit loads the row `FOR UPDATE` and compares. A mismatch is `409 CONFLICT`. Media attach and detach do not bump it (research R5).

## Derived flags on the own-listing response

Computed on the server from `state` and `expires_at`, sent so clients show the right controls without re-implementing the rules.

| Flag | True when |
|---|---|
| `canEdit` | state in `draft`, `active`, `expired` |
| `canPublish` | state in `draft`, `expired`. `active` shows the box as already checked. |
| `moderated` | state is `hidden` |

## Visibility (unchanged, and why that matters)

Browse, detail, the public summary, the expiry job and the notification paths all filter `state = 'active'` already. A draft or hidden listing is therefore invisible everywhere with no code change in those paths. This is the reason R1 uses states rather than a second flag.

## Audit

Written after commit, never inside the transaction. Keys are the allowlisted `statusFrom`, `statusTo` and `reason`.

| Action | Actor | Written when |
|---|---|---|
| `marketplace_listing_state_changed` | member | publish or unpublish through the edit |
| `marketplace_listing_hidden` | admin | staff disable (existing) |
| `marketplace_listing_restored` | admin | staff enable (existing); `statusTo` is now the restored state |

## Entities from the spec, mapped

| Spec entity | Realised as |
|---|---|
| Member listing | `marketplace_listings` plus its category detail table, media and features |
| Moderation entry | existing `audit_log` rows for the two actions above (no new table) |
| Staff listing view | read-only projection in `GET /admin/marketplace/listings`; owner display name only |

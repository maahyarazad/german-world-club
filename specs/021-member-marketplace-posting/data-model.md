# Data model: Every member can post on the Marketplace, except job offers

No new table or column. One migration: `server/migrations/042_member_marketplace_posting.sql`.

## `marketplace_listings` (feature 008), with a new trigger

| Column | Change |
|---|---|
| `category` (`marketplace_category`) | none |
| `mode` (`marketplace_mode`) | none |
| `state` (`marketplace_state`) | none |

**Trigger** `marketplace_listings_no_new_job_offer`, `BEFORE INSERT OR UPDATE OF category, mode,
state`, `FOR EACH ROW`.

It raises `check_violation` with constraint name `marketplace_no_new_job_offer` when
`NEW.category = 'job' AND NEW.mode = 'offer'` and one of these holds:

| Case | Condition | Why |
|---|---|---|
| New listing | `TG_OP = 'INSERT'` | FR-004 |
| Becoming a job offer | `OLD.category IS DISTINCT FROM 'job' OR OLD.mode IS DISTINCT FROM 'offer'` | FR-004, an edit into job |
| Publishing a legacy draft | `OLD.state = 'draft' AND NEW.state = 'active'` | FR-009 |

Every other update of an existing job offer passes (FR-008):

| Transition | Who |
|---|---|
| `active → filled / withdrawn` | owner |
| `active → expired` | `marketplace-expiry` |
| `active ↔ hidden` (hide, restore, remove) | moderation |
| title, body and detail edits | owner |

A CHECK constraint is deliberately not used: Postgres re-evaluates it on every update of the row,
which would block exactly those transitions (research R4).

The migration also:
- sets `SET LOCAL client_min_messages = warning` around `DROP TRIGGER IF EXISTS`, as in 040, so
  re-runs are quiet;
- runs `UPDATE members SET permissions = permissions - 'marketplace_post' WHERE permissions ? 'marketplace_post'`,
  which retires the key (research R2). `members` refuses DELETE, not UPDATE.

## Category definition (`@gwc/contracts/marketplace`)

```text
CategoryDef { category, fields, modes: readonly MarketplaceMode[] }
  vehicle  → ['offer', 'request']
  property → ['offer', 'request']
  job      → ['request']
  general  → ['offer', 'request']
modesFor(category) → CATEGORY_DEFS[category].modes
```

Validation rule: `modesFor(category).includes(mode)`, checked on create and on a category change
in edit. `tests/marketplace/definitions.test.ts` asserts each list is non-empty and a subset of
`MARKETPLACE_MODES`.

## Member permissions (`members.permissions` jsonb)

`marketplace_post` is retired. It leaves `MEMBER_PERMISSIONS` and the stored rows, and is
consulted nowhere. `thread_moderate` is unchanged.

## Demo seed

- `PLAN` in `seed/marketplace.ts` is built from `modesFor(category)`, so it has no job-offer slots.
  - The `job/offer/filled` and `job/offer/expired` history slots go.
  - `job/request/filled` stays.
- Owners are active demo members with completed profiling. The history rule is unchanged.

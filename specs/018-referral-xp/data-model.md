# Data model: Referral links and XP

One migration, `server/migrations/040_referrals.sql`. Four new tables, one new column on
`membership_applications`, one new `admin_module` value, and triggers. Shapes shared with the
clients go in `packages/contracts/src/referrals.ts` (exported as `@gwc/contracts/referrals`).

## Types

```sql
ALTER TYPE admin_module ADD VALUE IF NOT EXISTS 'referrals';     -- R12
CREATE TYPE referral_link_state AS ENUM ('active', 'retired', 'disabled');
CREATE TYPE xp_entry_kind       AS ENUM ('award', 'reversal');
```

`owner_kind` reuses `account_kind` (`member | admin | merchant | partner`). Staff are `admin`,
as everywhere else in the schema.

## `referral_links`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_kind` | account_kind NOT NULL | |
| `owner_id` | uuid NOT NULL | No FK, polymorphic (R6) |
| `code` | text NOT NULL **UNIQUE** | `^[0-9A-HJKMNP-TV-Z]{8}$`, stored normalised (R7). Unique over every code ever issued, so a retired code is never reissued. |
| `state` | referral_link_state NOT NULL DEFAULT 'active' | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `state_changed_at` | timestamptz | Set on leaving `active` |
| `disabled_by` | uuid → admin_users | Only when `disabled` |
| `disabled_reason` | text | 1–500 chars, only when `disabled` |

**Constraints**
- Partial unique index `(owner_kind, owner_id) WHERE state = 'active'`: at most one active link
  per person (FR-002).
- `CHECK ((state = 'disabled') = (disabled_by IS NOT NULL AND disabled_reason IS NOT NULL))`.
- Trigger `referral_links_transition`:
  - On `UPDATE`, only `state` (with `state_changed_at`, `disabled_by`, `disabled_reason`) may
    change, and only `active → retired` or `active → disabled`. A link that has left `active`
    is final. `code`, `owner_*` and `created_at` never change.
  - `DELETE` is refused.

**State transitions**

```text
          replace (owner)            disable (staff, reason)
 active ──────────────────▶ retired       active ──────────▶ disabled
   ▲
   └── created on first GET by the owner, or on replace (the new one)
```

Replacing a link is one transaction: retire the current link, then insert the new one. The
partial unique index makes a concurrent double-replace fail one side.

## `membership_applications.pending_referral_link_id`

| Column | Type | Notes |
|---|---|---|
| `pending_referral_link_id` | uuid → referral_links, NULL | Written by `register` (overwritten on resume). Read once by `verify-mobile`. |

It only means anything before `members.mobile_verified_at` is set. After that the `referrals` row
is the record. The column is left as written: it is not evidence of anything, and clearing it
would be an extra write for no reader.

## `referrals`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `link_id` | uuid NOT NULL → referral_links | The link actually used |
| `referrer_kind` | account_kind NOT NULL | Copied from the link, so lists don't need a join to answer "whose" |
| `referrer_id` | uuid NOT NULL | |
| `referee_member_id` | uuid NOT NULL **UNIQUE** → members | One referrer per person, ever (R4) |
| `created_at` | timestamptz NOT NULL DEFAULT now() | The moment registration completed (mobile verified) |

- Immutable: a trigger refuses `UPDATE` and `DELETE` (R5).
- `CHECK` that `(referrer_kind, referrer_id)` matches the link's owner is enforced by a
  `BEFORE INSERT` trigger, because a CHECK can't read another table.
- Index `(referrer_kind, referrer_id, created_at DESC)` for "my referrals".

**Stage, computed on read (R14)** and never stored:

| Stage | Source |
|---|---|
| `registered` | the `referrals` row exists, dated `referrals.created_at` |
| `approved` | `membership_applications.state = 'approved'`, dated `reviewed_at` |
| `joined` | `member_profiling.completed_at IS NOT NULL`, dated `completed_at` |
| `did_not_join` | `membership_applications.state = 'denied'`, dated `reviewed_at`. The reason is never selected. |

## `xp_entries`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_kind` | account_kind NOT NULL | |
| `owner_id` | uuid NOT NULL | |
| `kind` | xp_entry_kind NOT NULL | |
| `amount` | integer NOT NULL | `award`: > 0. `reversal`: < 0 and equal to minus the award it cancels. |
| `referral_id` | uuid NOT NULL → referrals | |
| `reverses_entry_id` | uuid **UNIQUE** → xp_entries | Only on `reversal` |
| `rate_id` | uuid → referral_xp_rates | Only on `award`. The rate in force at that moment. |
| `reason` | text NOT NULL | `award`: "referral". `reversal`: the staff reason, 1–500 chars. |
| `created_by` | uuid → admin_users | Only on `reversal` |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

**Constraints**
- Partial unique index `(referral_id) WHERE kind = 'award'`: one award per referral (R4, SC-003).
- `UNIQUE (reverses_entry_id)`: one reversal per award (FR-020).
- `CHECK` per kind:
  - `award`: `amount > 0`, `rate_id` set, and `reverses_entry_id` and `created_by` NULL.
  - `reversal`: `amount < 0`, `reverses_entry_id` and `created_by` set, and `rate_id` NULL.
- A `BEFORE INSERT` trigger on reversals checks that the target is an `award`, that it has the
  same owner and referral, and that `amount = -target.amount`.
- An award's owner must equal its referral's referrer (`BEFORE INSERT` trigger).
- Immutable: `UPDATE` and `DELETE` are refused (R5).
- Index `(owner_kind, owner_id, created_at DESC)`.

**Balance (FR-015)**: `SELECT COALESCE(SUM(amount), 0) FROM xp_entries WHERE owner_kind = $1 AND
owner_id = $2`. It is never stored.

## `referral_xp_rates`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `xp` | integer NOT NULL CHECK (xp BETWEEN 1 AND 100000) | |
| `effective_from` | timestamptz NOT NULL DEFAULT now() | |
| `set_by` | uuid → admin_users, NULL | NULL only on the migration's initial row |
| `reason` | text NOT NULL | 1–500 chars |

- Immutable (R5). The rate in force is the row with the greatest `(effective_from, id)`.
- The migration inserts `(100, now(), NULL, 'initial rate')`.

## Contracts (`@gwc/contracts/referrals`)

```ts
REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH = 8
normaliseReferralCode(input: string): string | null   // R7; null when not a well-formed code
formatReferralCode(code: string): string                // "ABCD-EFGH"
REFERRAL_STAGES = ['registered', 'approved', 'joined', 'did_not_join'] as const

referralLinkSchema      { code, url, createdAt }
referralSummarySchema   { link, xpBalance, counts: Record<Stage, number> }
referralSchema          { id, refereeName, stage, registeredAt, approvedAt, joinedAt, endedAt, xpAwarded }
xpEntrySchema           { id, kind, amount, reason, referralId, createdAt }
page<T>                 { items: T[], nextCursor: string | null }   // keyset on (created_at, id)

// staff
staffReferralOwnerSchema   { ownerKind, ownerId, name, link: { id, code, state } | null, xpBalance, counts }
disableLinkRequestSchema   { reason }
reverseXpRequestSchema     { reason }
xpRateSchema               { xp, effectiveFrom, setBy: name | null, reason }
setXpRateRequestSchema     { xp, reason }
```

`registerRequestSchema` (onboarding) gains `referralCode: z.string().max(20).optional()`, and
the server normalises it. `RegistrationDraft` in the app picks it up automatically, since it is
`Partial<RegisterRequest>`.

`permissions.ts`: `MODULES` gains `'referrals'`, with a comment saying which flags are used
(R12).

## Seed classification (`server/src/seed/tables.ts`)

`referral_links`, `referrals`, `xp_entries` and `referral_xp_rates` go under **SEEDED**, and
follow the consistent-history rule (R18). None of them is a credential: a code only names a link,
it doesn't sign anyone in.

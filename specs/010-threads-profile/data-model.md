# Data Model: Threads and Profiles

**Feature**: `010-threads-profile` | Builds on 009's migrations `022_member_profile.sql` and
`024_threads.sql`.

Two new migrations, split by domain as 008 did:

- `026_profiles.sql` — handles, links, designations, organisation profiles, avatars
- `027_threads_social.sql` — post media, quotes, mentions, blocks, mutes, activity cursor

`026` comes first because `027`'s mention resolution needs `members.handle`.

---

## 1. Profile (`026_profiles.sql`)

### 1.1 `members` (ALTER)

| Column | Type | Rule |
|---|---|---|
| `handle` | `citext` | `UNIQUE`, nullable until chosen. CHECK `handle ~ '^[a-z0-9._]{3,30}$' AND handle !~ '^\.|\.$'` |
| `handle_changed_at` | `timestamptz` | Set whenever `handle` changes. A trigger sets it, so no caller can forget |
| *(avatar)* | — | **Moved to `member_avatars (member_id PK, asset_id FK RESTRICT)`** during implementation: a foreign key from `members` to `assets` put `members` downstream of the media test reset's `TRUNCATE assets … CASCADE`. It also keeps a write path off the row with the password hash |

**Rules**
- A handle change within 30 days of `handle_changed_at` is refused. This is enforced in
  `application/handle.ts` under `SELECT … FOR UPDATE` on the member row.
- The reserved list lives in `@gwc/contracts/profile` (`RESERVED_HANDLES`).
- A handle is **not** released when a member ends. `members` rows are never deleted, so the
  handle stays unique to them, which prevents impersonating a former member.

### 1.2 `member_links` (NEW)

| Column | Type | Rule |
|---|---|---|
| `member_id` | `uuid` | FK `members` RESTRICT |
| `position` | `smallint` | `0–2`. PK `(member_id, position)` |
| `url` | `text` | CHECK `url ~ '^https://' AND char_length(url) <= 200` |
| `label` | `text` | nullable, ≤ 40 |

Replacing links is delete-and-insert inside one transaction (`PUT /profile/me/links`).

### 1.3 `member_designations` (NEW)

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid` PK | |
| `member_id` | `uuid` | FK `members` RESTRICT |
| `designation` | `member_designation` enum | `('influencer')`. An enum, so a new designation is a migration and a review |
| `granted_at` / `granted_by` / `grant_reason` | `timestamptz` / `uuid → admin_users` / `text` | reason non-blank |
| `revoked_at` / `revoked_by` / `revoke_reason` | nullable trio | all three NULL or all three set (CHECK) |

- `UNIQUE (member_id, designation) WHERE revoked_at IS NULL` means at most one active
  designation. A grant against an active one is `ON CONFLICT DO NOTHING`, which makes it
  a no-op (US6 #2).
- Rows are never deleted. The platform has no separate application role to
  revoke a grant from, so this is a trigger (the `audit_log` mechanism): DELETE
  is refused, and a revoked row is final.

### 1.4 `organisation_profiles` (NEW)

| Column | Type | Rule |
|---|---|---|
| `organisation_id` | `uuid` PK | FK `organisations` RESTRICT |
| `display_name` | `text` | 1–120 |
| `about` | `text` | ≤ 1000, nullable |
| `website` | `text` | https, ≤ 200, nullable |
| `city` | `text` | ≤ 120, nullable |
| `logo_asset_id` | `uuid` | FK `assets` RESTRICT, nullable |
| `updated_at` / `updated_by` | `timestamptz` / `uuid → organisation_users` | |

**Why a separate table**: `organisations` carries `fee_tier` and contract dates (research
R11). The projection members may see is a table of its own, so no query on it can reach
contract data.

---

## 2. Threads (`027_threads_social.sql`)

### 2.1 `thread_posts` (ALTER)

| Change | Rule |
|---|---|
| `+ quote_of_id uuid REFERENCES thread_posts(id) ON DELETE RESTRICT` | nullable |
| body CHECK relaxed | `thread_posts_body_length` becomes `char_length(btrim(body)) <= 500`. The "non-empty body **or** ≥1 media" rule cannot be a row CHECK, because media is another table. It is enforced by a `DEFERRABLE INITIALLY DEFERRED` constraint trigger at commit, so it holds even for an ad-hoc insert (Principle IV) |
| CHECK `quote_of_id IS NULL OR quote_of_id <> id` | |
| immutability trigger extended | `quote_of_id`, `reply_to_id`, `root_id` and `author_id` join `body` as immutable |

Index: `thread_posts (quote_of_id) WHERE quote_of_id IS NOT NULL`, for activity and quote
counts.

### 2.2 `thread_post_media` (NEW)

| Column | Type | Rule |
|---|---|---|
| `post_id` | `uuid` | FK `thread_posts` CASCADE. Posts are never hard-deleted, so this is only a declaration |
| `asset_id` | `uuid` | FK `assets` **RESTRICT**. Bytes are only ever removed by `modules/media` |
| `position` | `smallint` | `0–9` |

PK `(post_id, position)`, `UNIQUE (post_id, asset_id)`, index `(asset_id)`.

Immutability has two parts:

- UPDATE and DELETE are refused by the same trigger (there is no application
  role to revoke grants from; `audit_log` uses the same mechanism).
- A `BEFORE INSERT` trigger refuses a link unless the post row was written by the
  **current transaction**: `xmin::text = (txid_current() % 4294967296)::text` on the post
  row. A later "attach" is a different transaction and cannot pass. The check does not
  depend on `created_at`, so the seeder, which stamps historical `created_at` values, is
  unaffected as long as it inserts a post and its media in one transaction.
  `tests/threads/media-immutable.test.ts` asserts both halves: an insert in the same
  transaction succeeds, and one in a later transaction fails.

### 2.3 `thread_post_mentions` (NEW)

| Column | Type | Rule |
|---|---|---|
| `post_id` | `uuid` | FK `thread_posts` CASCADE |
| `member_id` | `uuid` | FK `members` RESTRICT |
| `handle_as_written` | `citext` | the span the client links |
| `created_at` | `timestamptz` | = post's `created_at`. It drives Activity |

PK `(post_id, member_id)`, index `(member_id, created_at DESC)`. At most 20 per post,
enforced in application code (and bounded by the parser).

### 2.4 `member_blocks` / `member_mutes` (NEW)

| Table | Columns | Rule |
|---|---|---|
| `member_blocks` | `blocker_id`, `blocked_id`, `created_at` | PK pair, CHECK distinct, index `(blocked_id)` |
| `member_mutes` | `muter_id`, `muted_id`, `created_at` | PK pair, CHECK distinct |

Inserting a block deletes `member_follows` rows in both directions **in the same
transaction** (application code, one statement each, covered by a test).

### 2.5 `member_activity_cursor` (NEW)

| Column | Type | Rule |
|---|---|---|
| `member_id` | `uuid` PK | FK `members` |
| `seen_at` | `timestamptz` | only moves forward: `ON CONFLICT … SET seen_at = GREATEST(old, new)` |

---

## 3. The one visibility predicate

009's `VISIBLE_POST` becomes, for viewer `$1`:

```
p.state = 'visible'
AND <VISIBLE_MEMBER on the author>
AND NOT EXISTS (SELECT 1 FROM member_blocks b
                 WHERE (b.blocker_id = $1 AND b.blocked_id = p.author_id)
                    OR (b.blocker_id = p.author_id AND b.blocked_id = $1))
```

It is used for posts, quoted embeds, reply lists, profile tabs, activity actors and mention
resolution, **in exactly one exported constant**. Feed queries additionally apply
`NOT EXISTS member_mutes`.

---

## 4. State transitions

`thread_posts.state` is unchanged from 009:

```
visible ──staff hide──▶ hidden ──staff restore──▶ visible
visible|hidden ──staff remove──▶ removed   (final)
visible ──author delete──▶ deleted          (final)
```

Designation:

```
(none) ──grant(reason)──▶ active ──revoke(reason)──▶ revoked (row kept) ──grant──▶ new active row
```

---

## 5. Counters and quotas

- Media storage is already metered by `media.stored_bytes` (`db/counters.ts`) at upload
  time. Attaching adds nothing.
- Post rate is a **rate limit**, not a quota: `write-heavy` bucket, as in 009. Nothing in
  the business description caps posts per member.

---

## 6. Seed manifest (`src/seed/tables.ts`)

| Table | Seeded? | Why |
|---|---|---|
| `member_links`, `member_designations`, `organisation_profiles`, `thread_post_media`, `thread_post_mentions` | yes | demo content. The designation's audit entry is stamped `granted_at` |
| `member_blocks`, `member_mutes`, `member_activity_cursor` | no | no seeded fact implies them (consistent-history rule) |

---

## 7. Rules added to 007's "must survive Zod removal" list

These rules are expressed in 010's Zod schemas today, and each must reappear as a handler
check when 007 Phase 6 runs: handle format, link URL scheme/length, media count ≤ 10, body
≤ 500, `tab` enum, about ≤ 1000, website scheme, and designation reason non-blank. All
except media count and `tab` are also DB CHECKs. Those two need handler checks.

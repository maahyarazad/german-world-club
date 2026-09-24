# Research: Threads and Profiles on Web and Mobile

**Feature**: `010-threads-profile` | **Date**: 2026-09-23

Each finding records a **Decision**, its **Rationale**, and the **Alternatives considered**.
No NEEDS CLARIFICATION remains. The spec's assumptions A-1 to A-5 are the resolved defaults,
and R1 and R2 below explain the two that shape the schema.

---

## R1 — Base branch: build on 009, not on `main`

**Decision**: Cut `010-threads-profile` from `009-expo-client`. Merging 009 into `main` first
is preferred.

**Rationale**: `thread_posts`, `member_follows`, `/profile/*`, the Expo app's `(member)`
routes and the root `workspaces` entry for `expo-client/german-world-club` exist only on
009. On `main`, `expo-client/` is still in `.gitignore`.

**Alternatives**: *Rebuild on `main`* — duplicates 009 and guarantees a conflict on every
file it touches. *Wait for 009 to merge* — cleanest; this plan does not require it, but
the quickstart assumes 009's migrations 020–025 are applied.

**Operational note**: Switching a working tree from `main` to any 009-based branch replaces
the ignored local `expo-client/` directory with the tracked one. Back it up, or use a
separate worktree.

---

## R2 — Who may author: members only (A-1)

**Decision**: Threads routes stay `audience: 'member'`. Merchants and partners get the Profile
section only.

**Rationale**: An organisation author means `thread_posts.author_id` splits into two
nullable FKs with a CHECK, every visibility rule doubles, and `config.auth.audience` must
accept a list. `plugins/10-auth.ts` resolves a single `TOKEN_AUDIENCE`, and 008 already
declined that surgery (008 Complexity Tracking, "Members only sell"). §5's separation of
commercial counterparties from members points the same way.

**Alternatives**: *Organisation "brand accounts" that post* — possible later as its own
feature. The clean shape is an `author_kind` + `organisation_author_id` pair, added when
the product asks for it. *Read-only feed for organisations* — shows member content to
commercial counterparties, which §5 and Principle VI's disclosure clause both resist.

---

## R3 — Influencer is a designation, not an audience (A-2)

**Decision**: New table `member_designations` with `designation = 'influencer'`. It holds
`granted_at/by/reason` and `revoked_at/by/reason`, with a partial unique index on
`(member_id, designation) WHERE revoked_at IS NULL`.

**Rationale**: An influencer signs in as a member, and everything a member can do they can
do. A fifth audience would duplicate every member route. A table rather than a boolean
keeps grant history in the row, and the affiliate-link feature can reference the active
designation. The rule "no columns nothing writes" is satisfied, because the staff grant
endpoint writes it.

**Alternatives**: *`members.is_influencer boolean`* — loses who and when, and history
would then live only in the audit log. *A new `account_kind`* — a token-audience change for a
badge.

---

## R4 — Media on posts: link table, attached at create time only

**Decision**: `thread_post_media (post_id, asset_id, position 0–9)`, PK `(post_id,
position)`, plus a unique `(post_id, asset_id)`. `POST /threads/posts` accepts `media:
[{assetId}]`, and the post and its links are inserted in one transaction. There is no
attach or detach endpoint.

**Rationale**: 009's trigger makes posts immutable (§8: nobody rewrites). Media is part of
what was said, so it is immutable too, and a later-attach endpoint would be an edit. Doing
it in the create transaction also makes SC-004 (no orphan posts) structural. The
ownership + `ready` checks copy `marketplace/application/media.ts`, but inside the create
transaction.

**Alternatives**: *Reuse `marketplace_listing_media` generically* — separate domains; 008
set the precedent of one link table per owner. *Draft post + attach + publish* — this is
drafts, which A-4 excludes.

The uniqueness is a real constraint here, where 008 had to refuse it in code. 008's primary
key had to stay `position`, and a second UNIQUE is allowed alongside it, so 010 adds one.

---

## R5 — Video in the feed

**Decision**: Feed and thread responses carry the `poster` variant plus the playable `webm`
variant. Clients render the poster and play muted on tap (web) or on visibility (mobile,
muted). Nothing autoplays with sound.

**Rationale**: FR-040 in 008 sets the same rule. `derive-video.ts` already emits a poster.

---

## R6 — Quote posts: a column, and a tombstone when the quoted post is not visible

**Decision**: `thread_posts.quote_of_id uuid NULL REFERENCES thread_posts ON DELETE
RESTRICT`. The response embeds `quoted: ThreadPostSummary | { unavailable: true } | null`.
Visibility of the quoted post is evaluated with the **same** `VISIBLE_POST` predicate,
including blocks (R10), in the same query.

**Rationale**: The same visibility rule belongs in one place (009's comment). A tombstone
rather than a 404 of the whole quote is correct: the quoting post is itself visible, and
Principle III forbids fallback content *for a URL that does not exist*, not a placeholder
inside a real resource. SC-005 asserts that no hidden body leaks.

**Alternatives**: *Snapshot the quoted body into the quote* — a cached copy of member content
that moderation could not reach. Principle III rejects it.

---

## R7 — Handles and mentions

**Decision**:
- `members.handle citext UNIQUE`, `members.handle_changed_at timestamptz`. CHECK
  `handle ~ '^[a-z0-9._]{3,30}$'` and not `^\.|\.$`. The reserved list (`admin`, `gwc`,
  `support`, `staff`, `konsole`, `threads`, …) lives in `@gwc/contracts/profile` and is
  enforced in `application/`, with a unit test that the list and the DB CHECK agree on
  format.
- `thread_post_mentions (post_id, member_id, handle_as_written)`, PK `(post_id, member_id)`.
  Parsing happens server-side at create time. At most 20 distinct handles resolve, and
  locked, ended or blocking members do not resolve.
- The 30-day change limit is a DB CHECK-free rule enforced under `SELECT … FOR UPDATE` on
  the member row. It is a correctness property, not a rate limit.

**Rationale**: Mentions keyed by member survive handle changes. `handle_as_written` lets the
client link exactly the text span that was written. A handle is required to author because
mentions only resolve against handles. An author without one would be unmentionable in
replies to their own posts.

**Alternatives**: *Mentions by display name* — not unique. *Store resolved handles in the body
as markup* — the body is immutable, so a rename would leave dead markup forever.

---

## R8 — Activity: computed on read, not stored

**Decision**: `GET /threads/activity` is a keyset-paginated `UNION ALL` over `thread_likes`,
replies (`thread_posts.reply_to_id` on my posts), quotes, `thread_reposts`,
`thread_post_mentions` and `member_follows`, filtered to the viewer and to visible actors.
`member_activity_cursor (member_id PK, seen_at)` holds the unread boundary. `POST
/threads/activity/seen` moves it forward (it never moves back:
`GREATEST(seen_at, $2)`).

**Rationale**: 009 chose computed counts over stored counters so moderation never has to fix
drift. An activity table is the same trade: every unlike, unfollow, hide or block would have
to delete the matching rows. Delivery is on read (CLAUDE.md: real-time transport is a later
feature), and push can later subscribe to the same sources after commit.

**Alternatives**: *`notifications` table written in the action's transaction* — needed once
push exists. Adding it now would be columns nothing reads in real time. *Reuse
`modules/messaging` system notifications* — messaging's CLAUDE.md note anticipates this. It
is the right home once transport exists, so R8 is designed so its query can become that
feed's source.

**Performance**: Every source already has an index on its target column except
`thread_reposts (post_id)`, covered by its PK, and mentions `(member_id, post_id)`, which
is added. The query is bounded at 20 rows per page with a keyset on `(at, kind, id)`.

---

## R9 — Profile tabs and the Media tab

**Decision**: `GET /threads/members/:id/posts?tab=threads|replies|media|reposts`, extending
009's route with a `tab` query that defaults to `threads` so existing callers are
unchanged. `media` is `EXISTS (thread_post_media)`, supported by index
`thread_post_media (post_id)` via the PK.

---

## R10 — Blocks and mutes

**Decision**: `member_blocks (blocker_id, blocked_id)` and `member_mutes (muter_id,
muted_id)`, directed, PK on the pair, `CHECK (a <> b)`. A block deletes follows in both
directions **in the same transaction** as the insert. The visibility predicate
`VISIBLE_POST` gains `NOT EXISTS (block either direction between viewer and author)`. Mutes
filter only feed queries.

**Rationale**: One predicate, one place (009). Blocks affect visibility, which is a
correctness rule. Mutes affect curation, which is a feed rule.

---

## R11 — Organisation public profile

**Decision**: `organisation_profiles (organisation_id PK FK, display_name, about, website,
city, logo_asset_id)`, 1:1, created on first edit. Edit requires `organisation_users.role IN
('owner','manager')`, loaded inside the transaction. Staff and non-matching orgs get 404
(`guardOrganisationScope`). Members read it at `GET /profile/organisations/:slug` when
`status = 'active'`.

**Rationale**: `organisations` holds contractual data (fee tier, contract dates) that no
member may see. A separate table makes the public projection explicit, and a `SELECT *` on
it cannot reach `fee_tier` because the column is not there. This is the Principle VI gap
closed by table design.

**Alternatives**: *Columns on `organisations`* — puts presentation next to contract data, one
careless query from disclosure.

---

## R12 — Web face: the member area gains Threads and Profile tabs

**Decision**: Extend `client/src/member/MemberLayout.tsx` with **Threads**, **Activity**,
**Profile** tabs. Routes are `/konsole/mitglied/threads`, `/konsole/mitglied/threads/:id`,
`/konsole/mitglied/aktivitaet`, `/konsole/mitglied/profil`, and
`/konsole/mitglied/@:handle`. Merchant/partner consoles gain a **Profil** item. Reuse
`client/src/member/MediaPicker.tsx` (008) for uploads. The console is client-rendered and
gated (Tech Baseline permits it).

**Rationale**: `HOME_FOR_KIND` already routes members to `/konsole/mitglied`. The member area
is where a web member lives.

**Alternatives**: *A separate SPA entry* — a fifth Vite entry for a gated surface, with no
benefit over the existing shell.

---

## R13 — Mobile face: extend 009's `(member)` routes

**Decision**: Add media to `threads/compose.tsx` (expo-image-picker → the existing upload
API with bearer token), quote and activity screens, profile tabs, handle and avatar editing,
the organisation profile for merchant/partner sign-ins, and block/mute in the post-card
menu. Components: extend `post-card.tsx` with a media carousel and a quote embed.

**Rationale**: 009 built the navigation and API client. 010 fills in screens.

---

## R14 — Staff moderation screen (US7)

**Decision**: `client/src/console/admin/Threads.tsx`, modelled on
`client/src/console/admin/Marketplace.tsx` (008), gated by
`RequireGrant module="threads_moderation"`. The API is 009's `/admin/threads/*`, which 010
extends to include post media in the staff view.

---

## R15 — Demo seed

**Decision**: Extend `seed:demo` so that each member gets a handle (from the local part of
their `.demo.invalid` address) and ~20% get an avatar. The seed also adds posts with media
from the existing seeded assets, replies, quotes, likes, follows, mentions and one influencer
designation granted by a seeded staff account at a fixed timestamp.

- **Consistent history**: the influencer grant writes its audit entry at `granted_at`.
- **Not seeded**: blocks, mutes and the activity cursor. None is implied by another seeded
  fact.

---

description: "Task list for feature 010 — Threads and Profiles on Web and Mobile"
---

# Tasks: Threads and Profiles on Web and Mobile

**Input**: Design documents from `/specs/010-threads-profile/`

**Prerequisites**: plan.md, spec.md (8 stories; Clarifications 2026-09-23: members-only authorship), research.md (R1–R15), data-model.md, contracts/ (threads-api, profile-api, ui-surfaces), quickstart.md

**Tests**: Included. They are not optional here. The constitution's Workflow section requires
an automated check for every principle a change touches, spec SC-002 to SC-008 each name one,
and CLAUDE.md requires a counter-assertion wherever a test would otherwise pass against a
server that did nothing. Write each story's tests first and confirm they fail.

**Organization**: One phase per user story, in spec priority order (US1–US3 P1, US4–US6 P2,
US7–US8 P3).

**Base**: All paths are relative to the repo root **on a branch cut from `009-expo-client`**
(research R1). The server is TypeScript (`.ts`). Modules follow feature 006's
`routes.ts` / `controller.ts` / `application/` split. Zod is still present (007 Phase 6 not
run): keep schemas in `packages/contracts`, and duplicate every rule listed in data-model
§7 as a handler check.

**Standing rules for every task** (CLAUDE.md and constitution; not repeated per task):
- Every route declares `config.auth`, `budget` and `rateLimit`, or the server will not boot.
- Ownership and visibility refusals are `404`, indistinguishable from an absent id.
- Queries on response paths name their columns. Never `SELECT *`.
- Media is delivered as derivatives only, with width and height.
- No server-localised text. New problem types go in `packages/contracts/src/errors.ts`.
- Every UI string goes in both `client/src/i18n/de.ts` and `en.ts` (and the app's
  catalogue), read via `useTranslations()`.
- Comments explain *why*, especially where the obvious implementation is wrong.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: The user story the task belongs to (US1–US8)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Get onto the right base and add the one new client dependency.

- [X] T001 Back up the ignored local `expo-client/` directory (e.g. `cp -R expo-client ../expo-client.backup-2026-09-23`), because checking out a 009-based branch replaces it with the tracked copy (research R1). Then create branch `010-threads-profile` from `009-expo-client` (preferably after 009 is merged to `main`) and commit `specs/010-threads-profile/` onto it
- [X] T002 Verify the base: `npm install && npm run typecheck && npm run -w server migrate && npm run -w server test`. Confirm migrations 020–025 are applied and that `server/src/modules/threads/` and `server/src/modules/profile/` exist. Record any pre-existing failures in `specs/010-threads-profile/quickstart.md` under a "Known failures on base" note rather than fixing them here
- [X] T003 [P] Add `expo-image-picker` (the SDK 57-compatible version via `npx expo install expo-image-picker`) to `expo-client/german-world-club/package.json` and add the photo-library usage strings to `expo-client/german-world-club/app.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, shared contract types, the one visibility predicate, author/media
column fragments and the handle rule. Every story reads them.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Schema

- [X] T004 Write `server/migrations/026_profiles.sql` per data-model §1. It covers: `members.handle citext UNIQUE` with the format CHECK (`'^[a-z0-9._]{3,30}$'`, no leading or trailing `.`); `members.handle_changed_at` with a `BEFORE UPDATE` trigger that stamps it when `handle` changes; `members.avatar_asset_id` FK `assets` RESTRICT; `member_links` (PK `(member_id, position)`, position 0–2, https + ≤ 200 CHECK, label ≤ 40); enum `member_designation ('influencer')` and table `member_designations` with the all-or-nothing revoke CHECK and the partial unique index `(member_id, designation) WHERE revoked_at IS NULL`; `REVOKE DELETE` on `member_designations` from the app role; and `organisation_profiles` (PK/FK `organisation_id`, display_name 1–120, about ≤ 1000, website https ≤ 200, city ≤ 120, `logo_asset_id` FK `assets` RESTRICT, `updated_at`, `updated_by` FK `organisation_users`). Make it idempotent (`IF NOT EXISTS`, `DO $$ … duplicate_object`) like 024
- [X] T005 Write `server/migrations/027_threads_social.sql` per data-model §2. It must:
  - Add `thread_posts.quote_of_id` (FK self, RESTRICT), the not-self CHECK, and a partial index on `quote_of_id`.
  - Relax `thread_posts_body_length` to `<= 500`, and add a `DEFERRABLE INITIALLY DEFERRED` constraint trigger that raises unless `btrim(body) <> ''` or a `thread_post_media` row exists.
  - Extend `thread_posts_state_guard()` so that `quote_of_id`, `reply_to_id`, `root_id` and `author_id` are immutable, like `body`.
  - Create `thread_post_media` (PK `(post_id, position)`, `UNIQUE (post_id, asset_id)`, position 0–9, asset FK RESTRICT, index `(asset_id)`), `REVOKE UPDATE, DELETE` on it from the app role, and a `BEFORE INSERT` trigger that refuses unless the post row's `xmin::text = (txid_current() % 4294967296)::text`. Comment why: posts are immutable, and `created_at = now()` would break the seeder.
  - Create `thread_post_mentions` (PK `(post_id, member_id)`, `handle_as_written citext`, `created_at`, index `(member_id, created_at DESC)`).
  - Create `member_blocks` and `member_mutes` (PK pair, not-self CHECK, index on the second column), and `member_activity_cursor (member_id PK, seen_at)`.
- [X] T006 Add every new table to the manifest in `server/src/seed/tables.ts`, with the seeded/not-seeded classification from data-model §6 (`member_blocks`, `member_mutes` and `member_activity_cursor` are not seeded)

### Contracts (shared by server, web, Expo)

- [X] T007 [P] In `packages/contracts/src/threads.ts`, add `mediaItemSchema`/`MediaItem`, widen `threadAuthorSchema` with `handle`, `avatar` and `isInfluencer`, and widen `threadPostSchema` with `media`, `quoted` (the discriminated `QuotedPost`: `{unavailable:false, post}` or `{unavailable:true}`), `quoteCount` and `mentions`. Add `THREAD_MEDIA_MAX = 10`, and add `quoteOfId` and `media` to `createPostRequestSchema`, with a `.superRefine` enforcing body-or-media, no duplicate asset ids, and not both `replyToId` and `quoteOfId`. Shapes are in `contracts/threads-api.md`
- [X] T008 [P] In `packages/contracts/src/profile.ts`, add `HANDLE_PATTERN`, `RESERVED_HANDLES` (at least `admin, administrator, gwc, germanworldclub, support, staff, konsole, threads, profile, mitglied, api, root, system, moderator, help`), `HANDLE_CHANGE_DAYS = 30`, `profileLinkSchema`, `setHandleRequestSchema`, `setAvatarRequestSchema` and `setLinksRequestSchema` (≤ 3). Widen `memberProfileSchema` and `publicMemberProfileSchema` per `contracts/profile-api.md`
- [X] T009 [P] Add problem types `HANDLE_REQUIRED` (`handle-required`) and `HANDLE_CHANGE_TOO_SOON` (`handle-change-too-soon`) to `packages/contracts/src/errors.ts`, following the existing `PROBLEMS` entries

### Shared server pieces

- [X] T010 Create `server/src/modules/media/application/media-items.ts` exporting `loadMediaItems(client, assetIds[]) → Map<assetId, MediaItem>`. It must select only `id, kind, alt, width, height` from `assets` and variant rows from `asset_variants`, build URLs with `urlForVariant` from `format.ts`, never select `storage_key` or reference the original, and put a video's `poster` variant first. It is used by threads and profile alike
- [X] T011 In `server/src/modules/threads/application/threads.ts`, replace `VISIBLE_POST` with a viewer-aware predicate that adds the two-way `member_blocks` `NOT EXISTS` (data-model §3), and export it as the **single** definition. Add an exported `AUTHOR_COLUMNS(alias, prefix)` fragment selecting only `id, display_name, handle, avatar_asset_id` plus `EXISTS(active influencer designation)`. Update `POST_COLUMNS` and `toPost` to use it. Comment that this is the only place member columns are selected for threads (plan, Post-Phase 1 point 1)
- [X] T012 Extend `toPost` and every post-loading query in `server/src/modules/threads/application/threads.ts` to attach `media` (one batched `thread_post_media` lookup per page through `loadMediaItems`), `quoteCount`, `mentions` (empty until US5) and `quoted: null` (filled in US2). Keep 009's response fields and ordering unchanged
- [X] T013 Create `server/src/modules/profile/application/handle.ts`. `setHandle(app, {memberId, handle})` validates `HANDLE_PATTERN` and `RESERVED_HANDLES` in the handler (the Zod-survival rule), then, in a transaction, runs `SELECT handle, handle_changed_at … FOR UPDATE`. It refuses `HANDLE_CHANGE_TOO_SOON` when `handle_changed_at > now() - 30 days` and the handle is already set, maps the unique violation to `VALIDATION_FAILED` naming field `handle`, and returns the updated profile. `isHandleAvailable(app, handle)` returns the same `false` for taken and reserved
- [X] T014 Add `PUT /profile/me/handle` and `GET /profile/handles/:handle/available` to `server/src/modules/profile/routes.ts` and `controller.ts` (member audience, `member-write`/`member-read`, `write-heavy`/`member-api`)

### Foundational tests

- [X] T015 [P] `server/tests/profile/handle.test.ts`: the format, reserved, taken (case-insensitive) and 30-day rules; the first set is always allowed; an ended member's handle stays taken. Counter-assertion: a valid handle *is* stored and returned
- [X] T016 [P] `server/tests/threads/media-immutable.test.ts`: inserting `thread_post_media` in the post's transaction succeeds; in a later transaction it fails; `UPDATE`/`DELETE` are refused for the app role; a post with blank body and no media fails at commit, while the same post with one media row commits
- [X] T017 [P] `server/tests/ops/no-pii-in-social.test.ts`: call every route in `contracts/threads-api.md` and `contracts/profile-api.md` (except `GET /profile/me` for the caller) with a seeded viewer, serialize the bodies, and assert that none contains a seeded member's email, mobile or birthday, an organisation's `legal_name` or `fee_tier`, or any `storage_key`. Counter-assertion: the same scan finds the caller's own email in `GET /profile/me`. Extend the route list as each story lands

**Checkpoint**: Migrations apply, `npm run typecheck` passes, and the foundational tests are green.

---

## Phase 3: User Story 1 — Post with media, on web and mobile (Priority: P1) 🎯 MVP

**Goal**: A member posts text plus up to 10 photos or videos from the web or the app, and sees it on both.

**Independent Test**: A demo member uploads two photos on the web and posts. The app shows the post with both photos as derivatives, in order (quickstart scenarios 2–3).

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [X] T018 [P] [US1] `server/tests/threads/media.test.ts`:
  - 3 ready own photos are attached in order, and every item has width, height and variant URLs.
  - A `processing` asset gives 422, and the post row count is unchanged (SC-004 counter-assertion).
  - Another member's asset gives 404, byte-identical to an unknown uuid (status, body, headers).
  - 11 items gives 422, and a duplicate asset gives 422.
  - A media-only post succeeds.
  - A video item lists `poster` first.
  - No response body contains an original's storage key (SC-002).
- [X] T019 [P] [US1] Add a test to `server/tests/threads/threads.test.ts`: a member with no handle gets `422 handle-required` on `POST /threads/posts`, and after `PUT /profile/me/handle` the same request succeeds
- [X] T020 [P] [US1] Add `POST /threads/posts` with media, and `GET /threads/feed`, as members, merchants, partners, staff and anonymous, to `server/tests/authz/route-posture.test.ts` (SC-003, contracts/threads-api.md matrix)

### Implementation for User Story 1

- [X] T021 [US1] Create `server/src/modules/threads/application/compose.ts` with `createPost(app, {authorId, body, replyToId, quoteOfId, media, signal})`. In one `withTransaction` it:
  1. Loads the author's handle and refuses `HANDLE_REQUIRED` if it is null.
  2. Re-checks the Zod rules in code (body-or-media, ≤ 10, no duplicates).
  3. Loads assets with `uploaded_by = authorId AND uploader_kind = 'member'`: missing gives 404, and not `ready` gives 422 with a "still processing" detail.
  4. Loads the reply target under the visibility predicate (404 if not visible) and derives `root_id`, as 009's create does.
  5. Inserts the post and then its `thread_post_media` rows by position.
  6. Returns the post via the shared loader.

  Move 009's create logic here and delete it from `threads.ts`.
- [X] T022 [US1] Point `controller.create` in `server/src/modules/threads/controller.ts` at `compose.createPost`, and update the `POST /threads/posts` schema in `server/src/modules/threads/routes.ts` to the widened `createPostRequestSchema`
- [X] T023 [P] [US1] Web: create `client/src/member/threads/MediaGrid.tsx` (1 item full width, 2–4 in a grid, 5–10 in a horizontal scroll-snap carousel). Each `<img>` gets `srcset` from the variants plus width, height and alt. A video renders its poster with a play button and plays **muted** on click
- [X] T024 [P] [US1] Web: create `client/src/member/threads/PostCard.tsx`. It shows avatar, display name, `@handle`, influencer badge, relative time, body, `MediaGrid`, and like/reply/repost counts with the actions, rendering counts exactly as the server returns them
- [X] T025 [US1] Web: create `client/src/member/threads/Composer.tsx` as a modal. It has a textarea with a counter against `THREAD_POST_MAX`, and attachments through the existing `client/src/member/MediaPicker.tsx` (upload via `POST /media`, alt text required, poll until `ready`, reorder, remove, max `THREAD_MEDIA_MAX`). On `422 handle-required` it opens `HandleDialog`
- [X] T026 [P] [US1] Web: create `client/src/member/profile/HandleDialog.tsx`. It shows a live hint from `HANDLE_PATTERN`/`RESERVED_HANDLES`, calls `GET /profile/handles/:handle/available` (debounced), then `PUT /profile/me/handle`, and branches on problem `type`
- [X] T027 [US1] Web: create `client/src/member/threads/Feed.tsx` with **For you** (`scope=all`) and **Following** tabs, keyset "load more" via `nextCursor`, a compose button, and empty, loading and error states
- [X] T028 [US1] Web: register the routes `/konsole/mitglied/threads` in `client/src/console/routes.tsx` and add a **Threads** tab to `client/src/member/MemberLayout.tsx`, beside Marketplace
- [X] T029 [P] [US1] Web: add the `memberThreads` strings (tabs, composer, counter, media errors, handle dialog, empty states) to both `client/src/i18n/de.ts` and `client/src/i18n/en.ts`
- [X] T030 [P] [US1] Mobile: create `expo-client/german-world-club/src/components/media-carousel.tsx` with `expo-image` from variants, a fixed aspect ratio from width and height, and a paging carousel. Videos show the poster and play muted when visible
- [X] T031 [US1] Mobile: extend `expo-client/german-world-club/src/components/post-card.tsx` with avatar, handle, influencer badge and `media-carousel`
- [X] T032 [US1] Mobile: extend `expo-client/german-world-club/src/app/(member)/threads/compose.tsx` with `expo-image-picker` (multi-select, images and videos, max 10). It uploads each item via the app's API client to `POST /media` with the bearer token and an alt-text prompt, waits for `ready`, and posts with `media`. It handles `422 handle-required` by pushing a new `(member)/profile/handle.tsx` screen (create it, with the same behaviour as T026)
- [X] T033 [US1] Mobile: update `expo-client/german-world-club/src/app/(member)/threads/index.tsx` to render media, and add the For you / Following switch if 009 lacks it
- [X] T034 [P] [US1] Mobile: add the threads, compose and handle strings to the app's i18n catalogue (the file 009 uses under `expo-client/german-world-club/src/`), in both languages

**Checkpoint**: US1 works on both faces, `media.test.ts` is green, and `test:i18n` passes.

---

## Phase 4: User Story 2 — Converse: reply, like, repost, quote (Priority: P1)

**Goal**: Replies with media, likes, reposts and quote posts on both faces, with a tombstone for quoted posts that are no longer visible.

**Independent Test**: A posts. B replies with a photo and quotes it. A sees both with correct counts on web and mobile. Staff hide A's post, and B's quote shows "unavailable" (quickstart scenarios 4 and 6).

### Tests for User Story 2 ⚠️

- [X] T035 [P] [US2] `server/tests/threads/quotes.test.ts`:
  - A quote embeds the live quoted post, and `quoteCount` increments.
  - After staff hide, remove or author delete, or after the quoted author is locked, the embed is `{unavailable:true}`, and the serialized response contains **none** of the quoted body text, author id or asset ids (SC-005).
  - Quoting a non-visible post gives 404.
  - `replyToId` together with `quoteOfId` gives 422.
  - `GET /threads/posts/:id/quotes` lists only visible quotes.
  - Counter-assertion: before hiding, the body text *is* present.
- [X] T036 [P] [US2] Add to `server/tests/threads/threads.test.ts`: a reply with media carries `rootId` and media; a double like still counts one; `GET /threads/posts/:id/likes` lists likers with `ThreadAuthor` shape; a deleted post answers 404 to every route

### Implementation for User Story 2

- [X] T037 [US2] In `server/src/modules/threads/application/compose.ts`, accept `quoteOfId`: load the target under the visibility predicate (404 if not visible) and insert with `quote_of_id`
- [X] T038 [US2] In `server/src/modules/threads/application/threads.ts`, add a `LEFT JOIN LATERAL` for the quoted post, evaluated with the **same** visibility predicate. Build `quoted` as `{unavailable:false, post: summary}` when visible, `{unavailable:true}` when the row exists but is not visible (select **no** body, author or media columns in that case), and `null` when there is no quote. Batch the quoted post's media through `loadMediaItems`
- [X] T039 [US2] Add `listQuotes` and `listLikers` (keyset, 20 per page) to `server/src/modules/threads/application/threads.ts`, add their controller handlers, and add `GET /threads/posts/:id/quotes` and `GET /threads/posts/:id/likes` to `server/src/modules/threads/routes.ts` (read posture)
- [X] T040 [P] [US2] Web: create `client/src/member/threads/QuoteEmbed.tsx`, a bordered compact post, or an "unavailable" tombstone string from i18n
- [X] T041 [US2] Web: create `client/src/member/threads/PostView.tsx` at `/konsole/mitglied/threads/:id`. It shows the parent (or the "unavailable" tombstone), the post, and paginated replies, with a reply composer (reusing `Composer` with `replyToId`) and quote, like and repost actions. Register the route in `client/src/console/routes.tsx`, and add the quotes and likes list routes (`…/zitate`, `…/likes`) as simple lists
- [X] T042 [US2] Web: in `client/src/member/threads/PostCard.tsx`, add the Quote action (opens `Composer` with `quoteOfId`), render `QuoteEmbed`, and navigate to `PostView` on click
- [X] T043 [P] [US2] Mobile: create `expo-client/german-world-club/src/components/quote-embed.tsx`, and render it in `post-card.tsx`
- [X] T044 [US2] Mobile: extend `expo-client/german-world-club/src/app/(member)/threads/[id].tsx` with a media reply and a quote action (routing to `compose` with `quoteOfId`). Create `(member)/threads/[id]/quotes.tsx` and `(member)/threads/[id]/likes.tsx`
- [X] T045 [P] [US2] Add the quote, likes and "unavailable" strings to `client/src/i18n/{de,en}.ts` and the app catalogue

**Checkpoint**: US1 and US2 both work independently. SC-005 is green.

---

## Phase 5: User Story 3 — My profile, for every identity (Priority: P1)

**Goal**: Member (and influencer) profiles with avatar, handle, bio, links and tabs, plus merchant and partner organisation profiles that owners and managers can edit, on web and mobile.

**Independent Test**: Sign in as a member, a merchant owner, a merchant `staff` user and a partner, on web and mobile. Each sees their own profile, a member edits avatar, handle, bio and links, and the `staff`-role PATCH gets 404 (quickstart scenarios 9, 10, 12).

### Tests for User Story 3 ⚠️

- [X] T046 [P] [US3] `server/tests/profile/avatar.test.ts`: an own ready image is set and returned as `MediaItem`; another member's asset gives 404; a processing one gives 422; a video gives 422; `null` clears it; no original is referenced
- [X] T047 [P] [US3] `server/tests/profile/links.test.ts`: ≤ 3; https only; ≤ 200 characters; PUT replaces all in one transaction (a failing 3rd link leaves the old set intact, which is the counter-assertion)
- [X] T048 [P] [US3] `server/tests/profile/organisation.test.ts`: an owner and a manager can PATCH `/profile/{merchant,partner}/public` and upload a logo; a `staff`-role user gets 404, byte-identical to a non-member organisation; a merchant token on `/profile/partner/*` gets 401; `GET /profile/{kind}` includes `publicProfile` and `canEdit`; no `fee_tier`, `legal_name` or contract dates appear
- [X] T049 [P] [US3] Add to `server/tests/profile/profile.test.ts`: `GET /profile/me` includes `handle`, `handleChangeableAt`, `avatar`, `links` and `isInfluencer`; `GET /threads/members/:id/posts?tab=threads|replies|media|reposts` returns the right sets (media only has posts with media; replies only has posts with `reply_to_id`); no `tab` behaves like 009

### Implementation for User Story 3

- [X] T050 [US3] In `server/src/modules/profile/application/profile.ts`, add `setAvatar` (asset owned by the member, `kind = image`, `ready`, else 404/422) and `setLinks` (handler re-check of count, scheme and length, then delete and insert in one transaction). Widen `loadOwnProfile` with handle, `handleChangeableAt`, avatar via `loadMediaItems`, links and `isInfluencer`, naming every column
- [X] T051 [US3] Add `PUT /profile/me/avatar` and `PUT /profile/me/links` to `server/src/modules/profile/routes.ts` and `controller.ts`, and widen the `GET /profile/me` response schema
- [X] T052 [US3] Create `server/src/modules/profile/application/organisation.ts`. `loadOwnOrganisationProfile` adds `publicProfile` and `canEdit` (owner or manager). `updatePublicProfile` loads the `organisation_users` row and role inside the transaction and throws 404 unless the role is owner or manager and the organisation matches (reuse `guardOrganisationScope` from `server/src/authz/object-guards.ts`), then upserts `organisation_profiles` with `updated_by`. `uploadLogo` calls `modules/media/application/upload.ts` with `uploader_kind` set to the organisation principal and sets `logo_asset_id` once the asset is `ready` (or on the next PATCH with `logoAssetId`)
- [X] T053 [US3] In `server/src/modules/profile/routes.ts`, add `PATCH /profile/{merchant,partner}/public` and `POST /profile/{merchant,partner}/logo`, one registration per audience in the existing `for (const audience of ['merchant','partner'])` loop, using budget `media-upload` and bucket `upload` for the logo. Comment why a separate upload route exists (`/media` is member-only; `10-auth.ts` has one audience per route)
- [X] T054 [US3] In `server/src/modules/threads/application/threads.ts`, extend `loadMemberPosts` with the `tab` parameter (`threads` the default, 009 behaviour, then `replies`, `media` via `EXISTS thread_post_media`, and `reposts` from `thread_reposts` ordered by repost time), and add `tab` to the querystring schema in `server/src/modules/threads/routes.ts`
- [X] T055 [P] [US3] Web: create `client/src/member/profile/ProfileHeader.tsx` (avatar, name, `@handle`, influencer badge, bio, city and country, links, follower and following counts) and `client/src/member/profile/ProfileTabs.tsx` (Threads, Replies, Media, Reposts, each a paginated `PostCard` list; Media as a grid)
- [X] T056 [US3] Web: create `client/src/member/profile/MyProfile.tsx` at `/konsole/mitglied/profil`, composing the header and tabs for the caller
- [X] T057 [US3] Web: create `client/src/member/profile/EditProfile.tsx` at `/konsole/mitglied/profil/bearbeiten`. It edits bio, city, gender and country (existing PATCH), handle (reusing `HandleDialog` logic, showing `handleChangeableAt`), avatar (through `MediaPicker`, images only), and up to 3 links. Display name is read-only, with an i18n note that name changes go through a request (§3.2)
- [X] T058 [US3] Web: create `client/src/organisation/Profile.tsx`, shared by the merchant and partner consoles. It shows the user's name and role, and the organisation public profile with an edit form and logo upload shown only when `canEdit`. The server still decides, and a 404 on save shows a "not permitted" message. Add a **Profil** item to the merchant and partner console navigation and register `/konsole/haendler/profil` and `/konsole/partner/profil` in `client/src/console/routes.tsx`
- [X] T059 [US3] Web: add a **Profil** tab to `client/src/member/MemberLayout.tsx` and register the profile routes in `client/src/console/routes.tsx`
- [X] T060 [P] [US3] Web: add the profile, edit-profile and organisation-profile strings to `client/src/i18n/{de,en}.ts`
- [X] T061 [US3] Mobile: extend `expo-client/german-world-club/src/app/(member)/profile/index.tsx` with the avatar, handle, badge and links header and a four-tab segmented list, reusing `post-card`
- [X] T062 [US3] Mobile: extend `expo-client/german-world-club/src/app/(member)/profile/edit.tsx` with handle (link to `profile/handle.tsx`), avatar (`expo-image-picker`, image only, upload, then `PUT /profile/me/avatar`) and links (≤ 3)
- [X] T063 [US3] Mobile: create `expo-client/german-world-club/src/app/(organisation)/profile.tsx` (view, plus edit when `canEdit`, with logo upload through `POST /profile/{kind}/logo`), and link it from `(organisation)/_layout.tsx` and `(organisation)/index.tsx`
- [X] T064 [P] [US3] Mobile: add the profile and organisation strings to the app catalogue

**Checkpoint**: All four identities have a working Profile on both faces. The P1 scope is complete.

---

## Phase 6: User Story 4 — Other people's profiles and following (Priority: P2)

**Goal**: Open anyone's profile by id or handle, follow and unfollow, browse follower and following lists, and view active organisation profiles.

**Independent Test**: A follows B from B's profile on the web, and B's post appears in A's Following feed on mobile (quickstart scenario 7, first half).

### Tests for User Story 4 ⚠️

- [X] T065 [P] [US4] Add to `server/tests/profile/profile.test.ts`: `/profile/handles/:handle` has the same body as `/profile/members/:id`; locked and ended members give 404 on both; the public profile has no email, mobile or birthday; `/profile/organisations/:slug` gives 200 for active with a profile, and 404 for pending, suspended or ended, or with no profile row
- [X] T066 [P] [US4] Add to `server/tests/threads/threads.test.ts`: followers and following lists paginate and exclude invisible members; following B puts B's post in A's `following` feed (counter-assertion: absent before the follow)

### Implementation for User Story 4

- [X] T067 [US4] In `server/src/modules/profile/application/profile.ts`, widen `loadPublicProfile` (handle, avatar, links, `isInfluencer`, `isBlocked`, `isMuted`) and add `loadPublicProfileByHandle`. Both use the visibility predicate plus the two-way block check, returning 404 otherwise
- [X] T068 [US4] Create `loadOrganisationPublicProfile(slug)` in `server/src/modules/profile/application/organisation.ts`, selecting only `organisation_profiles` columns plus `organisations.slug` and `kind` where `status = 'active'`
- [X] T069 [US4] Add `GET /profile/handles/:handle` and `GET /profile/organisations/:slug` to `server/src/modules/profile/routes.ts` and `controller.ts` (member audience, read posture)
- [X] T070 [US4] Add `listFollowers` and `listFollowing` (keyset, `ThreadAuthor` items) to `server/src/modules/threads/application/threads.ts`, and add `GET /threads/members/:id/followers` and `/following` to `routes.ts` and `controller.ts`
- [X] T071 [US4] Web: create `client/src/member/profile/MemberProfile.tsx` at `/konsole/mitglied/@:handle` and `/konsole/mitglied/mitglieder/:id`, with the header, a follow/unfollow button (`PUT`/`DELETE /threads/follows/:id`) and tabs. Create `client/src/member/profile/FollowList.tsx` for `…/follower` and `…/folgt`, and `client/src/member/profile/OrganisationView.tsx` at `/konsole/mitglied/organisationen/:slug`. Register all of them in `client/src/console/routes.tsx`, and link author names and handles in `PostCard.tsx` to `MemberProfile`
- [X] T072 [US4] Mobile: extend `expo-client/german-world-club/src/app/(member)/threads/member/[id].tsx` with the new header and tabs. Create `…/member/[id]/followers.tsx`, `…/member/[id]/following.tsx` and `(member)/organisations/[slug].tsx`
- [X] T073 [P] [US4] Add the follow, follower list and organisation view strings to `client/src/i18n/{de,en}.ts` and the app catalogue

**Checkpoint**: Profiles are reachable from every post, and the follow graph works end to end.

---

## Phase 7: User Story 5 — Mentions and Activity (Priority: P2)

**Goal**: `@handle` mentions are resolved server-side, and an Activity inbox with an unread badge works on both faces.

**Independent Test**: A mentions B. B's Activity badge shows 1, and opening Activity clears it on both faces (quickstart scenario 5).

### Tests for User Story 5 ⚠️

- [X] T074 [P] [US5] `server/tests/threads/mentions.test.ts`:
  - Known handles are recorded with `handle_as_written`, and unknown ones are ignored while the body is unchanged.
  - Case-insensitive matching.
  - Only the first 20 distinct handles are recorded.
  - Locked or ended members and members blocked in either direction are not recorded.
  - After the mentioned member changes handle, `mentions[].memberId` is unchanged.
  - The email-like `a@b.c` is not a mention.
- [X] T075 [P] [US5] `server/tests/threads/activity.test.ts`:
  - Each kind appears (like, reply, quote, repost, mention, follow) newest first, with a stable keyset.
  - The viewer's own actions are excluded.
  - Actors who are locked, blocked, or whose post is hidden are excluded.
  - `unread` counts items after `seen_at`, and `POST /activity/seen` with an older timestamp does not move it back.
  - Counter-assertion: an unlike removes the like item, because activity is computed.

### Implementation for User Story 5

- [X] T076 [US5] Create `server/src/modules/threads/application/mentions.ts` exporting `parseMentions(body)`, using the regex from `contracts/threads-api.md` to get the first 20 distinct handles lowercased, and `resolveMentions(client, {authorId, handles})`, which applies the visibility predicate, excludes blocks both ways and returns `{memberId, handleAsWritten}`
- [X] T077 [US5] Call `parseMentions` and `resolveMentions` inside `compose.createPost` in `server/src/modules/threads/application/compose.ts`, and insert `thread_post_mentions` in the same transaction. Fill `mentions` in the post loader in `threads.ts`
- [X] T078 [US5] Create `server/src/modules/threads/application/activity.ts`. `loadActivity(viewerId, cursor)` is a `UNION ALL` over likes on my posts, replies to my posts, quotes of my posts, reposts of my posts, mentions of me and follows of me, with the actor filtered by the visibility predicate and the post by `VISIBLE_POST`, keyset `(at DESC, kind, id)`, 20 per page. `unreadCount(viewerId)` counts the same union after `member_activity_cursor.seen_at`. `markSeen(viewerId, upTo)` upserts `GREATEST(seen_at, upTo)`
- [X] T079 [US5] Add `GET /threads/activity`, `GET /threads/activity/unread` and `POST /threads/activity/seen` to `server/src/modules/threads/routes.ts` and `controller.ts`
- [X] T080 [US5] Web: in `client/src/member/threads/PostCard.tsx`, render mention spans from `mentions` (match `@handle_as_written` in the body) as links to `MemberProfile`. Do not parse the body to decide who was mentioned
- [X] T081 [US5] Web: create `client/src/member/threads/Activity.tsx` at `/konsole/mitglied/aktivitaet` (item per kind, "load more", calls `seen` with the newest `at` on open). Add an **Aktivität** tab with an unread badge to `MemberLayout.tsx`, polling `/threads/activity/unread` on focus and every 60 s while visible
- [X] T082 [US5] Mobile: render mention spans in `post-card.tsx`. Create the `(member)/activity.tsx` tab with a badge in `(member)/_layout.tsx`, using the same polling rule via `AppState`
- [X] T083 [P] [US5] Add the activity strings (one per kind, pluralised) to `client/src/i18n/{de,en}.ts` and the app catalogue

**Checkpoint**: Mentions and Activity work on both faces, with nothing stored beyond mentions and the cursor.

---

## Phase 8: User Story 6 — Staff grant the Influencer designation (Priority: P2)

**Goal**: Staff with `members.write` grant or revoke Influencer with a reason. It is audited, and the badge shows everywhere.

**Independent Test**: Staff grant A. The badge shows on web and mobile, and an audit entry `member.designation.granted` exists (quickstart scenario 8).

### Tests for User Story 6 ⚠️

- [X] T084 [P] [US6] `server/tests/profile/designations.test.ts`:
  - A grant without a reason gives 422, and a second grant is a no-op with one active row.
  - A revoke sets the revoke trio and keeps the row. A revoke with none active gives 404.
  - A new grant after a revoke creates a new row.
  - `DELETE FROM member_designations` as the app role is refused.
  - Audit entries are written for both actions.
  - Staff without `members.write` get 403, and a member token gets 401.
  - `isInfluencer` flips on posts and profiles (counter-assertion: false before the grant).

### Implementation for User Story 6

- [X] T085 [US6] Create `server/src/modules/profile/application/designations.ts` with `grant` (`INSERT … ON CONFLICT DO NOTHING` against the partial unique index, then an audit write via the existing audit helper), `revoke` (update the active row with the revoke trio, or 404 if none is active, then an audit write) and `history`
- [X] T086 [US6] Create `server/src/modules/profile/staff-routes.ts` and `staff-controller.ts` with `GET /admin/members/:id/designations` (`requires` `members.read`), and `POST` and `DELETE /admin/members/:id/designations/influencer` (`members.write`, reason in the body), then register them in the app bootstrap next to the other staff route plugins
- [X] T087 [US6] Web (staff): add an Influencer panel with history, a grant or revoke button and a reason field to the existing staff member detail screen under `client/src/console/admin/`. Gate it with `RequireGrant module="members" flag="write"`
- [X] T088 [P] [US6] Web and mobile: render the influencer badge from `isInfluencer` in `client/src/member/threads/PostCard.tsx`, `client/src/member/profile/ProfileHeader.tsx` and `expo-client/german-world-club/src/components/post-card.tsx`, if US1 and US3 did not already. Add the strings to both catalogues

**Checkpoint**: The influencer identity exists and is managed by staff.

---

## Phase 9: User Story 7 — Staff moderate Threads in the console (Priority: P3)

**Goal**: A console screen for 009's `/admin/threads/*` API, showing media and quotes.

**Independent Test**: A member reports a post. Staff with `threads_moderation` see it in `/konsole/admin/threads`, hide it with a reason, and the member gets 404.

- [X] T089 [P] [US7] Add to the existing 009 staff threads tests in `server/tests/threads/threads.test.ts` (or a new `server/tests/threads/moderation.test.ts`): `GET /admin/threads/posts/:id` includes `media` and `quoted` for hidden posts; staff without `threads_moderation.read` get 403
- [X] T090 [US7] In `server/src/modules/threads/application/moderate.ts`, include `media` (via `loadMediaItems`) and `quoted` (unconditional for staff) in the staff post view
- [X] T091 [US7] Web: create `client/src/console/admin/Threads.tsx`, modelled on `client/src/console/admin/Marketplace.tsx`. It has the open report queue, post detail with media, and hide, restore, remove and resolve actions, each needing a reason. Replace the `NotBuilt` route for threads moderation in `client/src/console/routes.tsx`, gated by `RequireGrant module="threads_moderation"`, and add the strings to `client/src/i18n/{de,en}.ts`

---

## Phase 10: User Story 8 — Block and mute (Priority: P3)

**Goal**: Members block (mutual invisibility, follows removed) or mute (hidden from their own feed).

**Independent Test**: A blocks B. B gets 404 for A's profile and posts, and follows in both directions are gone (quickstart scenario 7).

- [X] T092 [P] [US8] `server/tests/threads/blocks.test.ts`:
  - After A blocks B, B gets 404 on A's profile, posts, likes and quotes, and on mentioning or following A; A gets the same for B.
  - Follows in both directions are removed in the same transaction (counter-assertion: present before).
  - A mute removes B from A's feeds only, and A can still open B's profile.
  - Unblock restores visibility but not the follows.
- [X] T093 [US8] Create `server/src/modules/threads/application/relations.ts` with `block` (insert plus a delete of `member_follows` both ways, one transaction), `unblock`, `mute`, `unmute` and the lists. Add the `NOT EXISTS member_mutes` filter to both feed scopes in `threads.ts`, and add the like, repost, follow and quote guards so a block gives 404 (reusing the predicate)
- [X] T094 [US8] Add `PUT/DELETE /threads/blocks/:id`, `PUT/DELETE /threads/mutes/:id`, `GET /threads/blocks` and `GET /threads/mutes` to `server/src/modules/threads/routes.ts` and `controller.ts` (write and read postures)
- [X] T095 [US8] Web: add block and mute to a `PostCard` overflow menu and to `MemberProfile`, and create `client/src/member/profile/Privacy.tsx` at `/konsole/mitglied/profil/privatsphaere` listing blocked and muted members with undo. Add the strings to `client/src/i18n/{de,en}.ts`
- [X] T096 [US8] Mobile: add block and mute to the `post-card.tsx` action sheet and the member profile, create `(member)/profile/privacy.tsx`, and add the strings to the app catalogue

---

## Phase 11: Polish & Cross-Cutting Concerns

- [X] T097 Extend `seed:demo` (under `server/src/seed/`) per research R15:
  - Give every member a handle derived from the local part of their `@*.demo.invalid` address, de-duplicated.
  - Give about 20% an avatar from existing seeded image assets.
  - Add posts with 1–4 media (post and media in one transaction, because of the `xmin` trigger), replies, quotes, likes, follows and mentions.
  - Add one influencer designation granted by a seeded staff account, with its audit entry stamped at `granted_at`.
  - Add `organisation_profiles` for active seeded organisations.
  - Stay additive and idempotent. Do not touch the credential tables.
- [X] T098 [P] Extend `server/tests/seed/no-live-credentials.test.ts` and the seed consistency tests so the new tables follow the manifest, and blocks, mutes and the activity cursor are empty after `seed:demo`
- [X] T099 [P] Add `seed:perf` (`--members`, `--posts`) and `bench:feed` (p95 for both feed scopes, activity and unread) scripts to `server/package.json` with implementations under `server/scripts/`. Record the results in `specs/010-threads-profile/quickstart.md` against SC-006 (≤ 300 ms feed, ≤ 150 ms activity). Add indexes only if `EXPLAIN` shows sequential scans
- [X] T100 [P] Complete the route list in `server/tests/ops/no-pii-in-social.test.ts` and the access matrix in `server/tests/authz/route-posture.test.ts` for every route in both API contracts (SC-003)
- [X] T101 [P] Add every rule from data-model §7 to the survival list in `specs/007-typescript-migration/data-model.md` §4, so that 007 Phase 6 keeps them as handler checks
- [X] T102 [P] Update `CLAUDE.md` under "Things that will bite you" with short notes on: media is attached only in the creating transaction (the `xmin` trigger), quotes render a tombstone and never a snapshot, activity is computed, the visibility predicate is the single definition, and `organisation_profiles` is the only member-visible projection of an organisation
- [X] T103 Run the full gate: `npm run typecheck`, `npm test`, `npm run -w client test:i18n` and `npm run -w server verify:seo` (confirm `/threads` and `/profile` are still gated and never indexed). Then walk through `specs/010-threads-profile/quickstart.md` scenarios 1–12 on web and mobile

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (1)** → **Foundational (2)** → the story phases → **Polish (11)**.
- Foundational blocks every story: migrations, contract types, the visibility predicate, `AUTHOR_COLUMNS`, `loadMediaItems` and the handle rule.

### User story dependencies

| Story | Depends on | Notes |
|---|---|---|
| US1 (P1) | Foundational | MVP |
| US2 (P1) | Foundational. Reuses US1's `compose.ts`, `Composer`, `PostCard` | Server half is independent. The web half extends US1 components |
| US3 (P1) | Foundational | Independent of US1 and US2 server-side. The profile tabs render `PostCard` (US1) |
| US4 (P2) | US3 (profile header and tabs) | |
| US5 (P2) | US1 (`compose.ts`) | Activity lists quotes only once US2 is in |
| US6 (P2) | Foundational | Fully independent server-side. The badge needs US1 and US3 UI |
| US7 (P3) | Foundational | Independent |
| US8 (P3) | US4 (profile screen for the block button) | The server half is independent |

### Within each story

Tests first (and failing), then application, then routes and controller, then web, then mobile, then strings.

## Parallel Opportunities

- Phase 2: T007, T008 and T009 (contracts) in parallel; T015, T016 and T017 (tests) in parallel once T004 and T005 exist.
- Once Foundational is done, **US3, US6 and US7 server work** can proceed in parallel with US1, since they touch different files.
- Within a story, `[P]` web and mobile component tasks run in parallel with each other. The web and mobile faces are independent codebases over one API.

### Parallel example: User Story 1

```bash
# Tests together:
Task: "T018 media.test.ts"   Task: "T019 handle-required in threads.test.ts"   Task: "T020 route-posture rows"
# After T021–T022 (server), the faces together:
Task: "T023 web MediaGrid"   Task: "T024 web PostCard"   Task: "T026 web HandleDialog"
Task: "T030 mobile media-carousel"   Task: "T029 web strings"   Task: "T034 app strings"
```

### Parallel example: User Story 3

```bash
Task: "T046 avatar.test.ts"  Task: "T047 links.test.ts"  Task: "T048 organisation.test.ts"  Task: "T049 profile tabs tests"
Task: "T055 ProfileHeader/ProfileTabs"   Task: "T060 web strings"   Task: "T064 app strings"
```

## Implementation Strategy

### MVP first (US1)

1. Setup, then Foundational.
2. US1: post with media on web and mobile. **Stop and validate** with quickstart scenarios 1–3.
3. This alone is shippable: the web face gains Threads and both faces gain media.

### Incremental delivery

1. MVP (US1), then US2 (conversation), then US3 (profiles). **Phase 1 business scope is complete** at this point.
2. US4 and US5 (the social graph and activity), then US6 (influencer).
3. US7 and US8 (moderation console, safety).
4. Polish: seed, performance, documentation, full gate.

### Parallel team strategy

After Foundational: developer A takes US1 then US2 (threads), developer B takes US3 then US4 (profile), developer C takes US6 then US7 (staff), and mobile follows each server story as it lands.

## Notes

- Commit after each task or logical group, with a `feat(010):` or `test(010):` prefix, following 008 and 009.
- If a task reveals that a spec assumption (A-2 to A-5) is wrong, stop and run `/speckit-clarify`. Do not decide it inside the implementation.

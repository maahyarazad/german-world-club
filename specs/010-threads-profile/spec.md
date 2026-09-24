# Feature Specification: Threads and Profiles on Web and Mobile

**Feature Branch**: `010-threads-profile` (to be cut from `009-expo-client`, see Dependencies)

**Created**: 2026-09-23

**Status**: Draft

**Input**: User description: "add threads section for web application and the mobile application for logged in user - the thread part of the application is like exactly the Threads application from Meta: users can reply to each other, like and post media. Also add the Profile section | Phase 1 | **Profile** | Member, Partner, Merchant, Influencer | in both mobile and web application, as new plan 010"

## Context

`german-world-club-business-description.md` → *Core Server Functions and Identities* lists, for Phase 1:

| Function | Identities |
|---|---|
| **Profile** | Member, Partner, Merchant, Influencer |
| **Threads** | — |

Feature 009 (`009-expo-client`, **not yet merged into `main`**) shipped a first cut of both,
server and mobile only:

- **Threads (009)**: text posts ≤ 500 chars, nested replies, likes, reposts, follows,
  reports and a staff moderation API. No media, no @mentions, no quote posts, no web screens,
  no staff console screen.
- **Profile (009)**: own member profile (bio, city, gender, country), another member's
  public profile, and a read-only organisation profile for merchant/partner sign-ins. No
  avatar, no handle, no influencer identity, no web screens.

Feature 010 completes both into the Threads-like experience the user asked for, on **both**
faces: the web member area (`/konsole/mitglied/…`) and the Expo app.

## Clarifications

### Session 2026-09-23

- Q: Should merchants and partners be able to post, reply and like in Threads, or only have a Profile? → A: **Option A — members only** (influencers included). Merchants and partners get a Profile and no Threads access; organisation posting may come later as its own feature.

## Dependencies

- **D-1 — 009 must land first, or 010 is cut from it.** Every table, route and screen 010
  extends exists only on `009-expo-client`. 010 is planned against that branch. Merging 009
  into `main` before implementing 010 is the recommended order.
- **D-2 — Feature 007 Phase 6 (Zod removal) has not run.** 009's contracts still use Zod. 010
  follows the code as it is, and adds its rules to 007's list of rules that must survive the
  removal, as 008 did.

## Assumptions (defaults chosen at spec time; reversible via `/speckit-clarify`)

The request left these open. Each has a default so planning can proceed; each is a
one-line reversal in the spec, but reversing A-1 or A-2 changes the data model.

- **A-1 — Only members author in Threads.** *(Confirmed in Clarifications, 2026-09-23.)* Members, influencers included (A-2), post,
  reply, like, repost, quote and follow. Merchant and partner sign-ins get a **Profile**
  but **no Threads access** in 010. §5 is emphatic that a commercial counterparty is not a
  member. Letting an organisation post needs a second author type on every post and a route
  that accepts two token audiences, which `plugins/10-auth.ts` does not support. 008
  rejected the same change for the same reason.
- **A-2 — An influencer is a member with a staff-granted designation**, not a fifth token
  audience. The affiliate link (the separate Phase 1 item) is **out of scope**. The
  designation is what that later feature will hang the link off.
- **A-3 — Threads and profiles are gated and never indexed**, on every face. There is no
  public profile page. `/threads` and `/profile` are already declared gated in
  `seo/surfaces.ts`, and this feature keeps it that way.
- **A-4 — "Exactly like Threads" is scoped to its core loop**: feed (For you / Following),
  compose with media, reply, like, repost, quote, @mention, profile with tabs, follow,
  activity. **Not included**: polls, GIF search, drafts, editing a post, reply controls,
  private accounts, hashtags/topics, Fediverse, real-time transport, push for activity.
- **A-5 — "For you" is reverse-chronological across all members**, the `all` scope 009
  already built. No ranking algorithm: nothing in the business description asks for one, and
  a ranked feed is a product decision, not a default.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Post with media, on web and mobile (Priority: P1)

A signed-in member opens **Threads** in the web member area or the app, writes a post, and
attaches up to ten photos and/or videos. The post appears at the top of their feed and on
their profile.

**Why this priority**: Media is the headline gap in 009, and the web face has no Threads at
all. Without this there is no feature on the web.

**Independent Test**: Sign in as a demo member on the web. Upload two photos. Post. Sign in
as the same member in the app and see the post with both photos, delivered as derivatives.

**Acceptance Scenarios**:

1. **Given** a signed-in member, **When** they post text with 3 ready photos they uploaded,
   **Then** the post is created with the photos in the chosen order, and every photo is
   served as a derivative with explicit width and height.
2. **Given** an upload still `processing`, **When** it is attached, **Then** the post is
   refused with a retryable validation problem and **no post is created**. Post and media
   are one transaction.
3. **Given** an asset uploaded by another member, **When** its id is attached, **Then** the
   response is `404`, identical to an unknown asset id.
4. **Given** 11 attachments, **Then** the post is refused.
5. **Given** a video attachment, **Then** the feed shows its poster and never autoplays
   with sound.
6. **Given** the web member area, **Then** Threads is a tab beside Marketplace, and the
   feed offers **For you** and **Following**.

---

### User Story 2 — Converse: reply, like, repost, quote (Priority: P1)

A member opens a post, sees what it answers and its replies, replies with text and media,
likes, reposts or quotes it.

**Why this priority**: Replying to each other is the second thing the user named. The server
half exists in 009. The web half and quote posts do not.

**Independent Test**: Member A posts. Member B replies with a photo and quotes the post. A
sees both, and the like/reply/repost counts are correct on web and mobile.

**Acceptance Scenarios**:

1. **Given** a post, **When** a member likes it twice, **Then** it has one like. PUT is
   idempotent, as in 009.
2. **Given** a quote of a post that is later hidden by staff, **When** the quote is viewed,
   **Then** the quote is shown and the embedded post reads "unavailable". The hidden
   post's body, author and media are not sent.
3. **Given** a reply, **Then** it carries `rootId`, and the thread view loads it in one
   indexed lookup.
4. **Given** a deleted post, **Then** its id answers `404` on every face.

---

### User Story 3 — My profile, for every identity (Priority: P1)

Each signed-in identity has a **Profile** section on web and mobile:

- **Member**: avatar, display name (read-only, §3.2), unique `@handle`, bio, city, country,
  up to 3 links. Tabs: *Threads*, *Replies*, *Media*, *Reposts*. Follower and following
  counts.
- **Influencer**: the member profile plus an **Influencer** badge. No extra fields in 010.
- **Merchant / Partner**: the organisation's public-facing profile (logo, display name,
  about text, website, city) and the signed-in user's own name and role. Only an
  organisation **owner or manager** may edit the organisation's fields.

**Why this priority**: Profile is the first Phase 1 item and names four identities.

**Independent Test**: Sign in as each of the four demo identities on web and mobile. Each
sees its own profile. A member edits bio, avatar and handle, and the change shows on both
faces.

**Acceptance Scenarios**:

1. **Given** a member without a handle, **When** they open Threads to post, **Then** they are
   asked to choose one first. A handle is required to author a post, because mentions resolve
   against it.
2. **Given** a handle already taken (case-insensitively) or reserved, **Then** it is refused
   with a validation problem that names the field.
3. **Given** a handle changed less than 30 days ago, **Then** a further change is refused.
4. **Given** an organisation `staff` user, **When** they PATCH the organisation profile,
   **Then** `404`. The refusal is indistinguishable from an absent organisation, following
   the `guardOrganisationScope` precedent.
5. **Given** any profile response, **Then** it contains no email, mobile or birthday unless it
   is the caller's own member profile.

---

### User Story 4 — Other people's profiles and following (Priority: P2)

A member taps an author's name or `@handle`, sees their profile and tabs, follows or
unfollows them, and browses follower/following lists. A member can open a merchant or
partner profile from wherever the platform links one.

**Independent Test**: A follows B from B's profile on the web. B's post appears in A's
*Following* feed on mobile.

**Acceptance Scenarios**:

1. **Given** a locked or ended member, **Then** their profile and posts answer `404`, as
   009's `VISIBLE_MEMBER` rule already does.
2. **Given** an organisation whose status is not `active`, **Then** its profile answers `404`.
3. **Given** `/profile/handles/:handle`, **Then** it resolves to the same public profile as
   `/profile/members/:id`.

---

### User Story 5 — Mentions and Activity (Priority: P2)

A member writes `@handle` in a post. The mentioned member sees it under **Activity**,
together with new likes, replies, quotes, reposts and follows on their content. Activity has
an unread count.

**Independent Test**: A mentions B. B's Activity shows the mention and an unread count of 1.
Opening Activity clears the count on both faces.

**Acceptance Scenarios**:

1. **Given** `@unknownhandle`, **Then** the text posts as written and nothing is recorded or
   notified.
2. **Given** a member who later changes their handle, **Then** existing mentions still point
   to them. The mention records the member, not the string.
3. **Given** activity from a member who is since locked, **Then** it is not listed.
4. **Given** more than 20 mentions in one post, **Then** only the first 20 distinct handles
   are recorded. This bounds the fan-out a single post can cause.

---

### User Story 6 — Staff grant the Influencer designation (Priority: P2)

Staff with `members` write permission grant or revoke **Influencer** on a member, with a
reason. The grant is audited and the badge appears on both faces.

**Acceptance Scenarios**:

1. **Given** a grant without a reason, **Then** it is refused.
2. **Given** a member who is already an influencer, **Then** a second grant is a no-op, not a
   second row. At most one active designation, enforced by a partial unique index.
3. **Given** a revocation, **Then** the history row is kept (`revoked_at`), never deleted.

---

### User Story 7 — Staff moderate Threads in the console (Priority: P3)

The staff API exists since 009 (`/admin/threads/*`). This story adds the console screen: a
report queue plus hide, restore, remove and resolve, each with a reason.

**Acceptance Scenarios**:

1. **Given** staff without `threads_moderation.read`, **Then** the screen is not offered and
   the API refuses.
2. **Given** a hidden post with media, **Then** staff see the media. Members get `404`.

---

### User Story 8 — Block and mute (Priority: P3)

A member mutes (removes from their own feed) or blocks (mutual invisibility) another member.

**Acceptance Scenarios**:

1. **Given** A blocks B, **Then** B gets `404` for A's profile and posts, B cannot reply to,
   like, quote, mention or follow A, and any follow in either direction is removed in the
   same transaction.
2. **Given** A mutes B, **Then** B's posts leave A's feeds, but A can still open B's profile.
   B is not told.

### Edge Cases

- A post whose author is locked **after** another member quoted it: the quote shows
  "unavailable", as in US2 scenario 2.
- A member deletes a post that has replies: the replies stay, and their parent shows as
  "unavailable".
- An attached asset later fails processing: this cannot happen after attach, because only
  `ready` assets attach.
- Two members follow each other in the same instant: both rows exist, keyed on the pair.
- A member revokes their own like while the like count is on screen: the next response
  carries the recomputed count, and the client displays what the server returns.
- The same photo is attached twice to one post: refused, as in 008.

## Requirements *(mandatory)*

### Functional Requirements

**Threads**

- **FR-001**: Members MUST be able to create a top-level post, a reply, or a quote of another
  post. A post MUST carry a body of 1–500 characters, **or** at least one media item. A
  media-only post is allowed, as it is on Threads.
- **FR-002**: A post MAY carry up to **10** media items (images and/or videos), ordered, and
  attached **in the same transaction** that creates the post. Posts and their media are
  immutable after publication, as 009 already enforces for the body.
- **FR-003**: Only assets uploaded by the author and in state `ready` MAY be attached. Any
  other asset id MUST answer `404`, identical to an unknown id.
- **FR-004**: Media MUST be delivered only as derivatives, with dimensions, through the
  existing pipeline. A video's feed rendering MUST be its poster.
- **FR-005**: A quote MUST embed the quoted post only while that post is visible to the
  viewer. Otherwise the embed MUST be a tombstone carrying no body, author or media.
- **FR-006**: `@handle` mentions MUST be resolved at post time into mention records naming the
  member. At most 20 per post, and blocked members are never recorded.
- **FR-007**: The feed MUST offer `all` ("For you") and `following` scopes, keyset-paginated,
  and MUST exclude muted and blocked authors for the viewer.
- **FR-008**: A profile MUST list the member's posts in four tabs: Threads (top-level),
  Replies, Media (posts with media), Reposts.
- **FR-009**: **Activity** MUST list likes, replies, quotes, reposts, mentions and follows
  concerning the viewer, newest first, with an unread count. It is computed on read.
  Delivery is on read only in 010, and there is no push.
- **FR-010**: Threads routes MUST remain member-audience only (A-1).

**Profile**

- **FR-011**: Every member MUST be able to set a unique, case-insensitive `@handle` of 3–30
  characters from `[a-z0-9._]`. It cannot start or end with `.` and cannot be on the
  reserved list. It may be changed at most once per 30 days. A handle is required before
  authoring in Threads.
- **FR-012**: Members MUST be able to set an avatar from an image they uploaded. It is served
  as a derivative only.
- **FR-013**: Members MUST be able to set up to 3 profile links (https only, ≤ 200 chars
  each, with an optional label).
- **FR-014**: Merchant and partner sign-ins MUST see their organisation's profile. Owners and
  managers MUST be able to edit its public-facing fields (display name, about ≤ 1000 chars,
  website, city, logo).
- **FR-015**: Members MUST be able to view an `active` organisation's public profile by slug.
- **FR-016**: Another member's profile MUST NOT expose email, mobile or birthday.
- **FR-017**: Staff MUST be able to grant and revoke the Influencer designation with a reason.
  Both actions write to the audit log.

**Cross-cutting**

- **FR-018**: Every new route MUST declare `config.auth`, a budget and a rate-limit bucket.
  The boot gates enforce this.
- **FR-019**: All request/response types MUST live in `@gwc/contracts` and be imported by
  server, web and Expo alike.
- **FR-020**: All new UI strings MUST exist in both `de` and `en` catalogues on the web and
  in the app's catalogue. `test:i18n` must pass.
- **FR-021**: Queries on response paths MUST name their columns. No `SELECT *`.
- **FR-022**: Ownership and visibility refusals MUST be `404`, never `403`.
- **FR-023**: `seed:demo` MUST seed handles, avatars, follows, posts with media, likes,
  mentions and one influencer, following the consistent-history rule. It MUST NOT seed
  any credential table.

### Key Entities

- **Thread post** (009, extended): gains `quote_of_id`. Media is a separate ordered link
  table.
- **Post media**: post ↔ asset, position 0–9.
- **Mention**: post ↔ mentioned member, plus the handle as written.
- **Member handle**: on `members`, with a change timestamp.
- **Member link**: up to 3 per member.
- **Influencer designation**: member, granted/revoked by staff, with reasons.
- **Organisation profile**: public-facing fields of an organisation, 1:1.
- **Block / Mute**: directed member pairs.
- **Activity cursor**: per member, when Activity was last opened.

## Success Criteria *(mandatory)*

- **SC-001**: A member can post with media on the web and see it on mobile, and the reverse,
  in the demo seed. The quickstart covers both directions.
- **SC-002**: No thread or profile response references an asset's original. This is asserted
  by the existing media payload check extended to the new routes.
- **SC-003**: The access matrix covers every new route × {anonymous, member, influencer,
  merchant, partner, staff}, and each cell has its expected status.
- **SC-004**: A post with any invalid attachment creates no post row. Verified by a counter
  assertion before and after.
- **SC-005**: A hidden/removed/deleted quoted post's body never appears in any quote
  response. Verified by searching the serialized body.
- **SC-006**: Feed first page p95 ≤ 300 ms at 50k posts / 5k members in the perf seed.
- **SC-007**: `tsc --noEmit` passes across contracts, server, client and Expo, with no type
  redeclared locally.
- **SC-008**: `test:i18n` passes, and no new component imports a catalogue directly.

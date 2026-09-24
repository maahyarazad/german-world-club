# Implementation Plan: Threads and Profiles on Web and Mobile

**Branch**: `010-threads-profile` (cut from `main` after 009 merged) | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-threads-profile/spec.md`

## Summary

Complete the two Phase 1 functions that 009 started. **Threads** becomes the Threads-style
loop the user described: posts with up to ten photos/videos, replies, likes, reposts,
quotes, @mentions and an Activity inbox. **Profile** covers all four identities the
business description names: member, influencer (a staff-granted designation on a member),
merchant and partner. Both ship on **both faces**: the web member area gains Threads,
Activity and Profile tabs it does not have today, and the Expo app's 009 screens gain media,
quotes, profile tabs and editing.

Most of the machinery already exists. That includes 009's thread tables, follow graph,
visibility predicate and staff moderation API, 002's media pipeline, 008's upload picker
and link-table pattern, and the ownership-404 convention. The new pieces are two migrations,
about 25 routes, contract types and screens.

The central decisions are these. Media is attached **in the creating transaction**, never
later, because posts are immutable (R4). Quotes of a no-longer-visible post render a
**tombstone**, not a snapshot (R6). Mentions are keyed by **member**, not by string (R7).
Activity is **computed on read**, like 009's counts (R8). The organisation's public face
is **its own table**, so contract data cannot reach a member (R11).

## Technical Context

**Language/Version**: TypeScript on Node 22 (server, native type stripping), React 19 +
Vite (web), Expo SDK 57 / React Native 0.86.3 (mobile, from 009).

**Primary Dependencies**: Fastify 5, `pg`, sharp + the existing video derivation (media
pipeline), Zod (still present, since 007 Phase 6 has not run), expo-router, expo-image,
**expo-image-picker** (new to the app).

**Storage**: PostgreSQL. `026_profiles.sql` and `027_threads_social.sql`, following 009's
`025`.

**Testing**: Vitest (server; SQL suites skip loudly without a DB), the client's
`test:i18n` and component tests, `tsc --noEmit` across four projects.

**Target Platform**: Gated member surfaces only: web member area (`/konsole/mitglied`),
merchant/partner consoles, the Expo app, and one staff console screen. **No public surface
is added.**

**Project Type**: Feature work across the existing monorepo. It extends
`server/src/modules/threads/` and `server/src/modules/profile/` (feature 006's split),
`packages/contracts`, `client/src/member/`, and `expo-client/german-world-club/src/app/`.

**Performance Goals**: The feed's first page p95 is ≤ 300 ms at 50k posts / 5k members
(SC-006). Activity and unread are ≤ 150 ms p95. The unread endpoint is polled.

**Constraints**:
- Every route declares `config.auth`, a budget and a bucket, or the server does not boot.
- 404 for every ownership/visibility refusal.
- Derivatives only. No response references an original.
- Queries on response paths name their columns. This matters more here than in 008: a post
  response now joins author, avatar, quoted author and mentions.
- No localised server text. New problem types (`handle-required`,
  `handle-change-too-soon`) go in `@gwc/contracts/errors`, and clients translate on `type`.

**Scale/Scope**: 2 migrations with 7 new tables and 2 altered tables. About 25 routes
(18 new, 7 changed), about 14 web screens/components, and about 12 Expo screens/components.
8 user stories: 3×P1, 3×P2, 2×P3.

**Resolved at spec time** (spec Assumptions A-1 to A-5, research R1 to R3): members-only
authorship, influencer as a designation, gated and never indexed, the core-loop scope, and
a chronological "For you" feed. No NEEDS CLARIFICATION remains. Any of these can be revisited
with `/speckit-clarify` before `/speckit-tasks`. A-1 and A-2 are the ones that would change
the schema.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution **2.0.0**.

### Pre-Phase 0

**Result: PASS**, conditional on 009 (D-1).

| Principle | Verdict | Detail |
|---|---|---|
| I. One Rule Set, Three Clients | **PASS** | Every shape is in `@gwc/contracts` (FR-019). The Expo app is a workspace member on 009, so the condition 008 carried is already discharged there. Mention parsing, handle validation, media limits and visibility are server-side. Clients use `RESERVED_HANDLES`/`HANDLE_PATTERN` only for inline hints. |
| II. Declare Every Posture | **PASS** | Every new route declares `config.auth`. `/threads` and `/profile` keep their gated, never-indexed rows in `seo/surfaces.ts`, and no surface row is added or relaxed. Ownership (post author, asset uploader, organisation role) is checked against the loaded row inside the transaction. The org-role check follows `guardOrganisationScope`'s 404. |
| III. Published State Must Match Real State | **PASS** | Hidden, removed, deleted and blocked content is `404`. Quotes embed the live quoted post or a tombstone, never a snapshot (R6). Counts and activity are computed live (R8). |
| IV. Integrity Lives In The Database | **PASS** | The handle is unique by `citext UNIQUE`. At most one active designation, by partial unique index. Media is immutable by trigger (no UPDATE/DELETE; INSERT only in the creating transaction). "Body or media" is enforced by a deferred constraint trigger. Follows are removed on block in the same transaction. Members are never deleted and designations are never deleted. Grants and revokes are audited. |
| V. Failure Is Explicit And Bounded | **PASS** | No new outbound dependency. Uploads reuse the `mediaImage` breaker and its declared policy. New routes use the existing `threads`, `member-read` and `member-write` budgets, which the boot gate sums. |
| VI. The Server Shapes What Leaves It | **CONDITIONAL PASS** | Media is inherited from the pipeline: content inspection, metadata stripping, derivatives only, and dimensions on every item. **The amended clause is this feature's sharpest risk**: with no response schemas enforced by the framework, a post response joins five member-derived sources. It is mitigated by explicit columns, by `organisation_profiles` being a separate table (R11), and by an added assertion that no thread/profile response carries `email`, `mobile`, `birthday`, `legal_name`, `fee_tier` or `storage_key`. |
| Tech Baseline — real-time | **PASS** | Delivery is on read. There is no transport and no push. Nothing is notified before it is persisted. |
| Tech Baseline — public rendering | **N/A** | No public page. |
| Workflow — every principle verifiable | **PASS** | SC-002 to SC-005 and SC-007/008 each name an automated check. The access matrices in both API contracts become test tables. |
| Workflow — staff-editable where the business owns it | **PASS** | Staff own the influencer designation (US6) and moderation (US7). Organisations own their public profile (US3). |

### Post-Phase 1 re-check

Design did not change the verdict. Four points sharpen it:

1. **Principle VI.** `ThreadAuthor` now carries avatar and handle and appears up to four
   times per post (author, reposter, quoted author, mentions). A single shared
   `AUTHOR_COLUMNS` fragment, next to `POST_COLUMNS`, is the only place member columns are
   selected for threads. The no-PII assertion runs against every route in both contracts.
2. **Principle IV, media immutability** needed a mechanism that is not obvious. `created_at =
   now()` fails for the seeder, so the trigger compares the post row's `xmin` to the current
   transaction (data-model §2.2). It is worth a comment in the migration, because it looks
   odd.
3. **Principle II, logo upload.** `POST /media` is member-only, so organisations need their
   own upload route per audience. That is two new routes rather than widening `/media` to
   two audiences, which `10-auth.ts` cannot express.
4. **Principle III, handles are never released.** An ended member keeps their handle, so a
   newcomer cannot inherit a former member's mentions and identity.

## Project Structure

### Documentation (this feature)

```text
specs/010-threads-profile/
├── plan.md              # This file
├── spec.md              # Feature specification (8 stories, assumptions A-1 to A-5)
├── research.md          # Phase 0: R1–R15
├── data-model.md        # Phase 1: 2 migrations, predicate, seed manifest
├── quickstart.md        # Phase 1: validation guide
├── contracts/
│   ├── threads-api.md
│   ├── profile-api.md
│   └── ui-surfaces.md
└── tasks.md             # Phase 2: /speckit-tasks (not created here)
```

### Source Code (repository root, relative to 009)

```text
server/
├── migrations/
│   ├── 026_profiles.sql                 # NEW: handle, avatar, links, designations, org profiles
│   └── 027_threads_social.sql           # NEW: post media, quotes, mentions, blocks, mutes, activity cursor
├── src/modules/threads/
│   ├── routes.ts                        # + quotes, likes, followers/following, activity, blocks, mutes
│   ├── controller.ts
│   ├── staff-routes.ts                  # post view includes media + quoted
│   └── application/
│       ├── threads.ts                   # VISIBLE_POST + blocks; AUTHOR_COLUMNS; media/quote joins
│       ├── compose.ts                   # NEW: create post + media + mentions, one transaction
│       ├── mentions.ts                  # NEW: parse + resolve (≤ 20)
│       ├── activity.ts                  # NEW: computed union, cursor
│       ├── relations.ts                 # NEW: block / mute (+ follow removal)
│       └── moderate.ts
├── src/modules/profile/
│   ├── routes.ts                        # + handle, avatar, links, by-handle, org public, logo
│   ├── controller.ts
│   ├── staff-routes.ts                  # NEW: designations
│   └── application/
│       ├── profile.ts
│       ├── handle.ts                    # NEW: format, reserved, 30-day rule under row lock
│       ├── organisation.ts              # NEW: public profile, role check (404)
│       └── designations.ts              # NEW: grant / revoke + audit
├── src/seed/                            # demo: handles, avatars, media posts, mentions, influencer
└── tests/
    ├── threads/{media,quotes,mentions,activity,blocks,media-immutable}.test.ts
    ├── profile/{handle,avatar,links,organisation,designations}.test.ts
    └── ops/no-pii-in-social.test.ts     # Principle VI assertion

packages/contracts/src/
├── threads.ts                           # MediaItem, QuotedPost, ActivityItem, widened ThreadPost
├── profile.ts                           # handle constants, links, org public profile, designation
└── errors.ts                            # + handle-required, handle-change-too-soon

client/src/
├── member/
│   ├── MemberLayout.tsx                 # + Threads, Aktivität, Profil tabs
│   ├── threads/{Feed,PostView,Composer,PostCard,MediaGrid,QuoteEmbed,Activity}.tsx
│   ├── profile/{MyProfile,EditProfile,MemberProfile,FollowList,Privacy,OrganisationView}.tsx
│   └── MediaPicker.tsx                  # reused from 008
├── console/admin/Threads.tsx            # NEW: moderation (replaces NotBuilt)
├── console/admin/members/…              # + influencer grant/revoke panel
├── organisation/Profile.tsx             # NEW: merchant/partner profile + edit
└── i18n/{de,en}.ts                      # + threads, activity, profile strings, BOTH catalogues

expo-client/german-world-club/src/
├── app/(member)/threads/{index,compose,[id]}.tsx      # media, quotes
├── app/(member)/threads/[id]/{quotes,likes}.tsx       # NEW
├── app/(member)/threads/member/[id]/{followers,following}.tsx  # NEW
├── app/(member)/activity.tsx                          # NEW tab
├── app/(member)/organisations/[slug].tsx              # NEW
├── app/(member)/profile/{index,edit,privacy}.tsx      # tabs, handle, avatar, links
├── app/(organisation)/profile.tsx                     # NEW
└── components/{post-card,media-carousel,quote-embed}.tsx
```

**Structure Decision**: Extend 009's `threads` and `profile` modules in place, following
006's routes/controller/application split. Influencer designations live under `profile`
because they are a fact about a member's identity, not about threads. Organisation profile
logic also lives under `profile`, not `organisations`, because it is the *public
projection* of an organisation, and `organisations/` owns contract data. The web face goes
into the existing member shell (`client/src/member/`), where `HOME_FOR_KIND` already sends
members.

## Complexity Tracking

| Item | Why | Simpler alternative rejected because |
|---|---|---|
| **Planned against an unmerged branch** (D-1, R1) | Everything 010 extends is on 009 only. | *Plan against `main`*: would re-specify 009. *Wait for 009 to merge*: preferred, and the plan does not block on it. Merge 009 first if possible. |
| **Principle VI: responses unshaped** | Inherited from constitution 2.0.0. A post response is the widest join the platform serves to members. | *Response schemas for this module only*: removed again by 007 Phase 6. The mitigation is `AUTHOR_COLUMNS` plus the no-PII suite. |
| **Media immutability via `xmin` trigger** (data-model §2.2) | Posts are immutable, so their media must be too, and the rule must hold for an ad-hoc insert (Principle IV). | *No attach endpoint, trust the application*: an application-level check (Principle IV says no). *`created_at = now()` trigger*: breaks the seeder's historical timestamps. |
| **Two organisation upload routes** | `/media` is member-audience. An organisation needs a logo. | *Widen `/media` to several audiences*: `10-auth.ts` supports one audience per route, which 008 declined to change. |
| **Activity computed on read** (R8) | No stored notifications until transport exists. | *`notifications` table now*: every unlike, unfollow, hide and block would need a matching delete, which is drift for moderation to fix (009's reason for computed counts). |
| **Members-only authorship** (A-1, R2) | §5, and the single-audience limit of `10-auth.ts`. | *Organisation brand accounts*: a polymorphic author on every post. A separate feature if wanted. |

**Not justified because not violated**: Principles I, II, III, IV and V hold outright.

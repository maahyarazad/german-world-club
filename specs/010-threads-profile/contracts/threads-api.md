# Contract: Threads API (010 deltas over 009)

Types live in `packages/contracts/src/threads.ts`. Every route below is under the gated,
never-indexed `/threads` surface (`seo/surfaces.ts`, unchanged). All routes declare
`auth: { audience: 'member' }` and budget `threads`. Reads use the `member-api` bucket and
writes use `write-heavy`, as 009 does.

Errors are RFC 9457. Clients branch on `type`. **Every ownership or visibility refusal is
`404 not-found` and is indistinguishable from an absent id** (status, body, headers).

Legend: **NEW** route, **CHANGED** existing 009 route (backward compatible unless noted),
**KEPT** 009 route unchanged apart from the widened post shape.

---

## Shapes

```ts
// NEW
type MediaItem = {                         // @gwc/contracts/media — shared with profiles
  assetId: string
  kind: 'image' | 'video'
  alt: string
  width: number; height: number            // of the source, for aspect ratio
  durationMs: number | null
  variants: { variant: string; format: string; url: string; width: number; height: number }[]
  posterUrl: string | null                 // video only; kept OUT of variants (FR-040)
}

type ThreadAuthor = {
  id: string
  displayName: string | null
  handle: string | null                    // NEW
  avatar: MediaItem | null                 // NEW — derivatives only
  isInfluencer: boolean                    // NEW
}

type QuotedPost =
  | { unavailable: false; post: ThreadPostSummary }
  | { unavailable: true }                  // no body, author or media — SC-005

type ThreadPostSummary = Omit<ThreadPost, 'quoted' | 'likedByMe' | 'repostedByMe'>

type ThreadPost = {                        // 009 fields kept, plus:
  media: MediaItem[]                       // NEW, ordered, 0–10
  quoted: QuotedPost | null                // NEW
  quoteCount: number                       // NEW
  mentions: { memberId: string; handle: string }[]   // NEW — handle_as_written, lowercased;
                                                     // match the body case-insensitively
}

type CreatePostRequest = {
  body?: string                            // CHANGED: optional when media is non-empty
  replyToId?: string
  quoteOfId?: string                       // NEW — mutually exclusive with replyToId
  media?: { assetId: string }[]            // NEW, ≤ 10, order = position
}

type ActivityItem = {
  kind: 'like' | 'reply' | 'quote' | 'repost' | 'mention' | 'follow'
  at: string
  actor: ThreadAuthor
  post: ThreadPostSummary | null           // null for 'follow'
}
```

Validation (server, handler **and** Zod while it exists. See data-model §7):
`(body non-blank) OR (media.length ≥ 1)`; `media.length ≤ 10`; no duplicate `assetId`;
`replyToId` and `quoteOfId` are not both set.

---

## Routes

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/threads/feed?scope=all\|following&cursor=` | KEPT | Excludes muted and blocked authors. Items carry `media`, `quoted` |
| POST | `/threads/posts` | **CHANGED** | Body per `CreatePostRequest`. `201 ThreadPost`. Post + media + mentions in one transaction. Refused with `403 handle-required` when the author has no handle (same status as `profile-incomplete`). Asset not the author's or unknown → `404`; not `ready` → `400 validation-failed` (retryable, the marketplace's precedent); quoted/replied post not visible → `404` |
| GET | `/threads/posts/:id?cursor=` | KEPT | `ThreadView`; replies carry media |
| DELETE | `/threads/posts/:id` | KEPT | Author only, otherwise `404` |
| PUT/DELETE | `/threads/posts/:id/like` | KEPT | Refused `404` when blocked either direction |
| PUT/DELETE | `/threads/posts/:id/repost` | KEPT | As above |
| POST | `/threads/posts/:id/report` | KEPT | |
| GET | `/threads/posts/:id/quotes?cursor=` | **NEW** | `PostList` of visible quotes |
| GET | `/threads/posts/:id/likes?cursor=` | **NEW** | `{ items: ThreadAuthor[], nextCursor }` |
| GET | `/threads/members/:id/posts?tab=threads\|replies\|media\|reposts&cursor=` | **CHANGED** | `tab` defaults to `threads` (009 behaviour) |
| PUT/DELETE | `/threads/follows/:id` | KEPT | `PUT` refused `404` when blocked either direction |
| GET | `/threads/members/:id/followers?cursor=` | **NEW** | `{ items: ThreadAuthor[], nextCursor }` |
| GET | `/threads/members/:id/following?cursor=` | **NEW** | same |
| GET | `/threads/activity?cursor=` | **NEW** | `{ items: ActivityItem[], nextCursor, unread: number }` |
| POST | `/threads/activity/seen` | **NEW** | body `{ upTo: string }`. `204`. Moves forward only |
| GET | `/threads/activity/unread` | **NEW** | `{ unread: number }`, cheap, polled by the tab badge |
| PUT/DELETE | `/threads/blocks/:id` | **NEW** | `200 { blocked: boolean }`. PUT removes follows both ways in the same transaction |
| PUT/DELETE | `/threads/mutes/:id` | **NEW** | `200 { muted: boolean }` |
| GET | `/threads/blocks` · `/threads/mutes` | **NEW** | own lists, for settings |

## Staff (`/admin/threads/*`, 009)

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/admin/threads/reports` | KEPT | |
| GET | `/admin/threads/posts/:id` | **CHANGED** | Includes `media` and `quoted` regardless of state. Staff see hidden content |
| POST | `/admin/threads/posts/:id/{hide,restore,remove}` | KEPT | reason required, audited |
| POST | `/admin/threads/reports/:id/resolve` | KEPT | |

## Access matrix (SC-003)

An audience mismatch is **403**, not 401: the credential is valid, just not for this
interface (`plugins/10-auth.ts`).

| Principal | `/threads/*` | `/admin/threads/*` |
|---|---|---|
| anonymous | 401 | 401 |
| member / influencer | 2xx per route | 403 (audience) |
| merchant / partner | 403 (audience) | 403 (audience) |
| staff with `threads_moderation.read` | 403 (audience) | 2xx reads; hide/restore/resolve need `.status`, remove `.delete` |
| staff without | 403 (audience) | 403 |

## Mention parsing (server only)

`(?<![A-Za-z0-9_.@])@([A-Za-z0-9._]{3,30})` is matched on the body, trailing dots are dropped (sentence punctuation) and the handle is lowercased. The
server keeps the first 20 distinct handles, resolves them against `members.handle` under the
visibility predicate, and records the hits. The client links the spans in `mentions`. It
never parses to decide who was mentioned.

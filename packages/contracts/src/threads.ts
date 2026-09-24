import { z } from 'zod'
import { mediaItemSchema } from './media.ts'

/**
 * Threads — the member post feed that replaces the forum (§7, features 009
 * and 010).
 *
 * Short posts with up to ten photos or videos, nested replies, quotes, likes,
 * reposts, follows, @mentions and an Activity inbox. No categories and no
 * per-category moderators: staff moderate globally (§8), under the existing
 * `threads_moderation` module.
 *
 * Members only, influencers included (010 Clarifications, A-1). A merchant or
 * partner is not a member (§5) and has no Threads access.
 */

/** The same ceiling threads.com uses; §7 models the experience on it. */
export const THREAD_POST_MAX = 500

/** Photos and/or videos on one post — Threads' own carousel limit. */
export const THREAD_MEDIA_MAX = 10

/**
 * How many distinct @handles one post may notify. Bounds the fan-out a
 * single post can cause; the text itself is never truncated.
 */
export const THREAD_MENTIONS_MAX = 20

/**
 * The mention syntax, for a client to find the spans to LINK — never to
 * decide who was mentioned. The server resolves mentions at post time and
 * returns them in `mentions`; a span with no matching entry is plain text.
 */
export const MENTION_PATTERN = /(?<![A-Za-z0-9_.@])@([A-Za-z0-9._]{3,30})/g

export const FEED_SCOPES = Object.freeze(['following', 'all'] as const)

/** The four tabs of a profile's post list. */
export const PROFILE_TABS = Object.freeze(['threads', 'replies', 'media', 'reposts'] as const)

export const threadAuthorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().nullable(),
  handle: z.string().nullable(),
  avatar: mediaItemSchema.nullable(),
  isInfluencer: z.boolean(),
})

const threadPostFields = {
  id: z.string().uuid(),
  author: threadAuthorSchema,
  body: z.string(),
  replyToId: z.string().uuid().nullable(),
  rootId: z.string().uuid().nullable(),
  createdAt: z.string(),
  media: z.array(mediaItemSchema),
  mentions: z.array(z.object({ memberId: z.string().uuid(), handle: z.string() })),
  likeCount: z.number().int().nonnegative(),
  replyCount: z.number().int().nonnegative(),
  repostCount: z.number().int().nonnegative(),
  quoteCount: z.number().int().nonnegative(),
  isMine: z.boolean(),
}

/** A post as it appears embedded in a quote: no viewer state, no nesting. */
export const threadPostSummarySchema = z.object({
  ...threadPostFields,
  quoteOfId: z.string().uuid().nullable(),
})

/**
 * What a quote shows of the post it quotes.
 *
 * `unavailable` when that post is no longer visible to this viewer — hidden,
 * removed, deleted, its author locked, or a block between them. It then
 * carries NOTHING of the quoted post: no body, no author, no media. A snapshot
 * would be a copy of member content that moderation could not reach
 * (research R6).
 */
export const quotedPostSchema = z.discriminatedUnion('unavailable', [
  z.object({ unavailable: z.literal(false), post: threadPostSummarySchema }),
  z.object({ unavailable: z.literal(true) }),
])

export const threadPostSchema = z.object({
  ...threadPostFields,
  quoted: quotedPostSchema.nullable(),
  likedByMe: z.boolean(),
  repostedByMe: z.boolean(),
})

/** One row in the feed: a post, or somebody you follow reposting one. */
export const feedItemSchema = z.object({
  post: threadPostSchema,
  repostedBy: threadAuthorSchema.nullable(),
  activityAt: z.string(),
})

export const feedSchema = z.object({
  items: z.array(feedItemSchema),
  nextCursor: z.string().nullable(),
})

export const postListSchema = z.object({
  items: z.array(threadPostSchema),
  nextCursor: z.string().nullable(),
})

export const authorListSchema = z.object({
  items: z.array(threadAuthorSchema),
  nextCursor: z.string().nullable(),
})

/** A post in context: what it answers, and the direct replies to it. */
export const threadViewSchema = z.object({
  post: threadPostSchema,
  parent: threadPostSchema.nullable(),
  replies: z.array(threadPostSchema),
  nextCursor: z.string().nullable(),
})

/**
 * Body OR media: a media-only post is a real post, as on Threads. Media is
 * attached here, in the creating request, and never later — posts are
 * immutable, and attaching afterwards would be an edit (research R4).
 *
 * The server re-checks every rule in this refinement by hand; the refinement
 * is the client's early warning, not the enforcement (Principle I).
 */
export const createPostRequestSchema = z.object({
  body: z.string().trim().max(THREAD_POST_MAX).optional().default(''),
  replyToId: z.string().uuid().optional(),
  quoteOfId: z.string().uuid().optional(),
  media: z.array(z.object({ assetId: z.string().uuid() })).max(THREAD_MEDIA_MAX).optional().default([]),
}).superRefine((value, ctx) => {
  if (value.body.length === 0 && value.media.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['body'], message: 'A post needs text or at least one photo or video.' })
  }
  if (new Set(value.media.map((m) => m.assetId)).size !== value.media.length) {
    ctx.addIssue({ code: 'custom', path: ['media'], message: 'The same item is attached twice.' })
  }
  if (value.replyToId && value.quoteOfId) {
    ctx.addIssue({ code: 'custom', path: ['quoteOfId'], message: 'A post replies or quotes, not both.' })
  }
})

export const reportPostRequestSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
})

export const followStateSchema = z.object({
  following: z.boolean(),
  followers: z.number().int().nonnegative(),
})

// --- Activity -----------------------------------------------------------------

export const ACTIVITY_KINDS = Object.freeze(['like', 'reply', 'quote', 'repost', 'mention', 'follow'] as const)

/**
 * One thing that happened to you. Computed on read from the likes, posts,
 * reposts, mentions and follows themselves (research R8): an unlike removes
 * the item, a hidden post takes its items with it, and nothing needs fixing.
 */
export const activityItemSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  at: z.string(),
  actor: threadAuthorSchema,
  /** The post concerned — yours for like/repost/quote-of, theirs for reply/quote/mention. Null for a follow. */
  post: threadPostSummarySchema.nullable(),
})

export const activityPageSchema = z.object({
  items: z.array(activityItemSchema),
  nextCursor: z.string().nullable(),
  unread: z.number().int().nonnegative(),
})

export const unreadSchema = z.object({ unread: z.number().int().nonnegative() })

/** Moves the unread boundary forward only; an older `upTo` changes nothing. */
export const markSeenRequestSchema = z.object({ upTo: z.string().datetime({ offset: true }) })

// --- Blocks and mutes -----------------------------------------------------------

export const blockStateSchema = z.object({ blocked: z.boolean() })
export const muteStateSchema = z.object({ muted: z.boolean() })

// --- Staff moderation ---------------------------------------------------------

export const THREAD_REPORT_STATES = Object.freeze(['open', 'upheld', 'dismissed'] as const)

export const moderationReasonSchema = z.object({ reason: z.string().trim().min(3).max(2000) })

export type FeedScope = (typeof FEED_SCOPES)[number]
export type ProfileTab = (typeof PROFILE_TABS)[number]
export type ThreadAuthor = z.infer<typeof threadAuthorSchema>
export type ThreadPostSummary = z.infer<typeof threadPostSummarySchema>
export type QuotedPost = z.infer<typeof quotedPostSchema>
export type ThreadPost = z.infer<typeof threadPostSchema>
export type FeedItem = z.infer<typeof feedItemSchema>
export type Feed = z.infer<typeof feedSchema>
export type PostList = z.infer<typeof postListSchema>
export type AuthorList = z.infer<typeof authorListSchema>
export type ThreadView = z.infer<typeof threadViewSchema>
export type CreatePostRequest = z.input<typeof createPostRequestSchema>
export type ReportPostRequest = z.infer<typeof reportPostRequestSchema>
export type FollowState = z.infer<typeof followStateSchema>
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]
export type ActivityItem = z.infer<typeof activityItemSchema>
export type ActivityPage = z.infer<typeof activityPageSchema>
export type MarkSeenRequest = z.infer<typeof markSeenRequestSchema>

import { z } from 'zod'

/**
 * Threads — the member post feed that replaces the forum (§7, feature 009).
 *
 * Short posts, nested replies, likes, reposts and follows. No categories and
 * no per-category moderators: staff moderate globally (§8), under the existing
 * `threads_moderation` module.
 *
 * Not yet here, deliberately: @mentions and media attachments. Each needs
 * something that does not exist — a member handle to mention, and the
 * attachment table the media module would hang off — and a field on this shape
 * that nothing could fill would be a promise, not a feature.
 */

/** The same ceiling threads.com uses; §7 models the experience on it. */
export const THREAD_POST_MAX = 500

export const FEED_SCOPES = Object.freeze(['following', 'all'] as const)

export const threadAuthorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().nullable(),
})

export const threadPostSchema = z.object({
  id: z.string().uuid(),
  author: threadAuthorSchema,
  body: z.string(),
  replyToId: z.string().uuid().nullable(),
  rootId: z.string().uuid().nullable(),
  createdAt: z.string(),
  likeCount: z.number().int().nonnegative(),
  replyCount: z.number().int().nonnegative(),
  repostCount: z.number().int().nonnegative(),
  likedByMe: z.boolean(),
  repostedByMe: z.boolean(),
  isMine: z.boolean(),
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

/** A post in context: what it answers, and the direct replies to it. */
export const threadViewSchema = z.object({
  post: threadPostSchema,
  parent: threadPostSchema.nullable(),
  replies: z.array(threadPostSchema),
  nextCursor: z.string().nullable(),
})

export const createPostRequestSchema = z.object({
  body: z.string().trim().min(1).max(THREAD_POST_MAX),
  replyToId: z.string().uuid().optional(),
})

export const reportPostRequestSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
})

export const followStateSchema = z.object({
  following: z.boolean(),
  followers: z.number().int().nonnegative(),
})

// --- Staff moderation ---------------------------------------------------------

export const THREAD_REPORT_STATES = Object.freeze(['open', 'upheld', 'dismissed'] as const)

export const moderationReasonSchema = z.object({ reason: z.string().trim().min(3).max(2000) })

export type FeedScope = (typeof FEED_SCOPES)[number]
export type ThreadAuthor = z.infer<typeof threadAuthorSchema>
export type ThreadPost = z.infer<typeof threadPostSchema>
export type FeedItem = z.infer<typeof feedItemSchema>
export type Feed = z.infer<typeof feedSchema>
export type PostList = z.infer<typeof postListSchema>
export type ThreadView = z.infer<typeof threadViewSchema>
export type CreatePostRequest = z.infer<typeof createPostRequestSchema>
export type ReportPostRequest = z.infer<typeof reportPostRequestSchema>
export type FollowState = z.infer<typeof followStateSchema>

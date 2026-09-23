import {
  loadFeed, loadMemberPosts, loadThread, createPost, deleteOwnPost, setReaction, reportPost, setFollow,
  decodeCursor, isFeedCursor, isPostCursor,
} from './application/threads.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type { CreatePostRequest, FeedScope, ReportPostRequest } from '@gwc/contracts/threads'

/** Request and reply shaping for Threads. The rules live in `application/`. */
export function createThreadController(app: GwcApp) {
  const me = (request: GwcRequest) => String(request.principal!.id)
  const idOf = (request: GwcRequest) => (request.params as { id: string }).id
  const cursorOf = (request: GwcRequest) => (request.query as { cursor?: string }).cursor

  const reaction = (kind: 'like' | 'repost', on: boolean) => async (request: GwcRequest, reply: GwcReply) =>
    reply.send(await setReaction(app, { memberId: me(request), postId: idOf(request), kind, on, signal: request.deadlineSignal }))

  const follow = (on: boolean) => async (request: GwcRequest, reply: GwcReply) =>
    reply.send(await setFollow(app, { followerId: me(request), followeeId: idOf(request), on, signal: request.deadlineSignal }))

  return {
    feed: async (request: GwcRequest, reply: GwcReply) => {
      const q = request.query as { scope?: FeedScope; cursor?: string }
      return reply.send(await loadFeed(app, {
        viewerId: me(request),
        scope: q.scope ?? 'following',
        cursor: decodeCursor(q.cursor, isFeedCursor),
        signal: request.deadlineSignal,
      }))
    },

    memberPosts: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await loadMemberPosts(app, {
        viewerId: me(request), authorId: idOf(request),
        cursor: decodeCursor(cursorOf(request), isPostCursor), signal: request.deadlineSignal,
      })),

    thread: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await loadThread(app, {
        viewerId: me(request), postId: idOf(request),
        cursor: decodeCursor(cursorOf(request), isPostCursor), signal: request.deadlineSignal,
      })),

    create: async (request: GwcRequest, reply: GwcReply) => {
      const body = request.body as CreatePostRequest
      const post = await createPost(app, {
        authorId: me(request), body: body.body, replyToId: body.replyToId,
        requestId: request.id, signal: request.deadlineSignal,
      })
      return reply.code(201).send(post)
    },

    remove: async (request: GwcRequest, reply: GwcReply) => {
      await deleteOwnPost(app, { authorId: me(request), postId: idOf(request), requestId: request.id, signal: request.deadlineSignal })
      return reply.code(204).send()
    },

    like: reaction('like', true),
    unlike: reaction('like', false),
    repost: reaction('repost', true),
    unrepost: reaction('repost', false),

    report: async (request: GwcRequest, reply: GwcReply) => {
      const { reason } = request.body as ReportPostRequest
      await reportPost(app, { memberId: me(request), postId: idOf(request), reason, requestId: request.id, signal: request.deadlineSignal })
      return reply.code(202).send({ reported: true })
    },

    follow: follow(true),
    unfollow: follow(false),
  }
}

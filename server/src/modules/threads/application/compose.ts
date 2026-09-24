import { PROBLEMS } from '@gwc/contracts/errors'
import { THREAD_MEDIA_MAX, THREAD_POST_MAX } from '@gwc/contracts/threads'
import { withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { loadVisiblePost, loadVisiblePostRow, notFound } from './threads.ts'
import { parseMentions, resolveMentions } from './mentions.ts'
import type { GwcApp } from '../../../app.ts'
import type { ThreadPost } from '@gwc/contracts/threads'

/**
 * Creating a post — the one write path for what a member says (feature 010).
 *
 * The post, its media and its mentions are ONE transaction. That is not only
 * tidy: the database refuses media on a post from any other transaction
 * (027_threads_social.sql), because posts are immutable and attaching later
 * would be an edit; and a post with no text commits only if its media rows
 * exist by COMMIT. So a request whose attachments fail leaves no post behind
 * (SC-004).
 */
export async function createPost(
  app: GwcApp,
  { authorId, body: rawBody = '', replyToId, quoteOfId, media = [], requestId, signal }:
    {
      authorId: string
      body?: string
      replyToId?: string
      quoteOfId?: string
      media?: readonly { assetId: string }[]
      requestId?: string
      signal?: AbortSignal
    },
): Promise<ThreadPost> {
  // Re-checked by hand, not trusted from the request schema: feature 007
  // Phase 6 removes the schemas, and these rules must outlive them
  // (data-model §7).
  const body = typeof rawBody === 'string' ? rawBody.trim() : ''
  // Guarded for the day the request schema no longer guarantees an array.
  const assetIds = Array.isArray(media) ? media.map((m) => String(m?.assetId)) : []
  if (body.length > THREAD_POST_MAX) {
    throw refuse(PROBLEMS.VALIDATION_FAILED, `A post is at most ${THREAD_POST_MAX} characters.`)
  }
  if (body.length === 0 && assetIds.length === 0) {
    throw refuse(PROBLEMS.VALIDATION_FAILED, 'A post needs text or at least one photo or video.')
  }
  if (assetIds.length > THREAD_MEDIA_MAX) {
    throw refuse(PROBLEMS.VALIDATION_FAILED, `A post carries at most ${THREAD_MEDIA_MAX} photos or videos.`)
  }
  if (new Set(assetIds).size !== assetIds.length) {
    throw refuse(PROBLEMS.VALIDATION_FAILED, 'The same item is attached twice.')
  }
  if (replyToId && quoteOfId) {
    throw refuse(PROBLEMS.VALIDATION_FAILED, 'A post replies or quotes, not both.')
  }

  const postId = await withTransaction(app.pg, async (client) => {
    // A handle first: mentions resolve against handles, and an author without
    // one could not be mentioned back in their own conversation.
    const { rows: author } = await client.query('SELECT handle FROM members WHERE id = $1', [authorId])
    if (!author[0]?.handle) {
      throw refuse(PROBLEMS.HANDLE_REQUIRED, 'Choose a handle before posting.')
    }

    // Only the author's own uploads, and only once they are ready. Anything
    // else is refused like an unknown id: a stranger's asset id must not be a
    // way to republish their photo, nor to learn that it exists.
    if (assetIds.length > 0) {
      const { rows: assets } = await client.query(
        `SELECT id, state FROM assets
          WHERE id = ANY($1::uuid[]) AND uploaded_by = $2 AND uploader_kind = 'member'`,
        [assetIds, authorId],
      )
      if (assets.length !== assetIds.length) throw refuse(PROBLEMS.NOT_FOUND, 'No such media.')
      const pending = assets.find((a) => a.state !== 'ready')
      if (pending) {
        // A retry, not a refusal — which is why it is not a 404.
        throw refuse(PROBLEMS.VALIDATION_FAILED,
          `An attachment is still ${pending.state}; post it once it is ready.`)
      }
    }

    // Answering or quoting something you cannot see is refused like it does
    // not exist — the same predicate the reader uses, blocks included.
    let rootId: string | null = null
    if (replyToId) {
      const parent = await loadVisiblePostRow(client, authorId, replyToId)
      if (!parent) throw notFound()
      rootId = parent.root_id ? String(parent.root_id) : String(parent.id)
    }
    if (quoteOfId && !(await loadVisiblePostRow(client, authorId, quoteOfId))) throw notFound()

    const { rows } = await client.query(
      `INSERT INTO thread_posts (author_id, body, reply_to_id, root_id, quote_of_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [authorId, body, replyToId ?? null, rootId, quoteOfId ?? null],
    )
    const id = String(rows[0]!.id)

    if (assetIds.length > 0) {
      await client.query(
        `INSERT INTO thread_post_media (post_id, asset_id, position)
         SELECT $1, asset_id, ord - 1 FROM unnest($2::uuid[]) WITH ORDINALITY AS t(asset_id, ord)`,
        [id, assetIds],
      )
    }

    const mentions = await resolveMentions(client, { authorId, handles: parseMentions(body) })
    if (mentions.length > 0) {
      await client.query(
        `INSERT INTO thread_post_mentions (post_id, member_id, handle_as_written)
         SELECT $1, member_id, handle FROM unnest($2::uuid[], $3::text[]) AS t(member_id, handle)`,
        [id, mentions.map((m) => m.memberId), mentions.map((m) => m.handleAsWritten)],
      )
    }
    return id
  }, { signal })

  await app.audit({
    action: 'thread_post_created', outcome: 'allowed', requestId,
    actorId: authorId, actorKind: 'member', targetType: 'thread_post', targetId: postId,
  })
  return (await loadVisiblePost(app.pg, authorId, postId))!
}

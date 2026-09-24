import { useState } from 'react'
import type { ThreadAuthor, ThreadPost } from '@gwc/contracts/threads'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import { useTranslations } from '../../i18n/index'
import PostCard from './PostCard'
import Composer from './Composer'

type Entry = { post: ThreadPost; repostedBy?: ThreadAuthor | null; key: string }

/**
 * A list of posts with the reply and quote composers wired in — shared by the
 * feed, profile tabs, quotes and replies, so every list behaves the same.
 */
export function PostList({ entries, loading, failed, hasMore, onMore, onRetry, empty, onUpdate, onRemove, onHideAuthor, onPosted }: {
  entries: readonly Entry[]
  loading: boolean
  failed: boolean
  hasMore: boolean
  onMore: () => void
  onRetry: () => void
  empty: string
  onUpdate: (post: ThreadPost) => void
  onRemove: (postId: string) => void
  onHideAuthor?: (authorId: string) => void
  onPosted?: (post: ThreadPost) => void
}) {
  const t = useTranslations()
  const [replyTo, setReplyTo] = useState<ThreadPost | null>(null)
  const [quote, setQuote] = useState<ThreadPost | null>(null)

  return (
    <div>
      {failed && (
        <Callout variant="gold" title={t.memberThreads.loadFailed}>
          <Button className="mt-2" variant="secondary" onClick={onRetry}>{t.memberThreads.retry}</Button>
        </Callout>
      )}
      {!failed && !loading && entries.length === 0 && <p className="py-8 text-center text-[13px] text-text-muted">{empty}</p>}
      {entries.map((entry) => (
        <PostCard
          key={entry.key}
          post={entry.post}
          repostedBy={entry.repostedBy}
          onChange={onUpdate}
          onRemoved={onRemove}
          onReply={setReplyTo}
          onQuote={setQuote}
          onHideAuthor={onHideAuthor}
        />
      ))}
      {hasMore && (
        <div className="flex justify-center py-4">
          <Button variant="secondary" disabled={loading} onClick={onMore}>{t.memberThreads.loadMore}</Button>
        </div>
      )}
      <Composer
        open={replyTo !== null || quote !== null}
        replyTo={replyTo}
        quote={quote}
        onClose={() => { setReplyTo(null); setQuote(null) }}
        onPosted={(created) => {
          // A reply raises the parent's count; the server's number arrives on
          // the next read, and until then the list shows what it had.
          onPosted?.(created)
        }}
      />
    </div>
  )
}

export default PostList

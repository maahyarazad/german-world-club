import { useState } from 'react'
import type { FeedItem, FeedScope, ThreadPost } from '@gwc/contracts/threads'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import { useTranslations } from '../../i18n/index'
import { usePaged } from './usePaged'
import PostList from './PostList'
import Composer from './Composer'

/**
 * The Threads feed in the web member area (US1).
 *
 * "For you" is every member's posts, newest first; "Following" is the people
 * you follow and what they reposted (spec A-5). Both are the server's lists —
 * nothing is filtered or ranked here.
 */
export function Feed() {
  const t = useTranslations()
  const [scope, setScope] = useState<FeedScope>('all')
  const [composing, setComposing] = useState(false)
  const feed = usePaged<FeedItem>(`/threads/feed?scope=${scope}`)

  const update = (post: ThreadPost) =>
    feed.setItems((items) => items.map((i) => (i.post.id === post.id ? { ...i, post } : i)))

  const tab = (value: FeedScope, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={scope === value}
      onClick={() => setScope(value)}
      className={`flex-1 border-b-2 py-2.5 text-[13px] font-semibold ${scope === value ? 'border-navy text-text' : 'border-transparent text-text-muted'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageHeader title={t.memberThreads.title} subtitle={t.memberThreads.subtitle}
        actions={<Button onClick={() => setComposing(true)}>{t.memberThreads.compose}</Button>} />
      <div role="tablist" className="flex border-b border-hairline">
        {tab('all', t.memberThreads.forYou)}
        {tab('following', t.memberThreads.following)}
      </div>
      <PostList
        entries={feed.items.map((i) => ({ post: i.post, repostedBy: i.repostedBy, key: `${i.post.id}:${i.repostedBy?.id ?? ''}` }))}
        loading={feed.loading}
        failed={feed.failed}
        hasMore={feed.hasMore}
        onMore={feed.more}
        onRetry={feed.reload}
        empty={scope === 'following' ? t.memberThreads.emptyFollowing : t.memberThreads.empty}
        onUpdate={update}
        onRemove={(id) => feed.setItems((items) => items.filter((i) => i.post.id !== id))}
        onHideAuthor={(authorId) => feed.setItems((items) => items.filter((i) => i.post.author.id !== authorId))}
        onPosted={() => feed.reload()}
      />
      <Composer open={composing} onClose={() => setComposing(false)} onPosted={() => feed.reload()} />
    </div>
  )
}

export default Feed

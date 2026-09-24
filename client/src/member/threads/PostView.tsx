import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { ThreadAuthor, ThreadPost, ThreadView } from '@gwc/contracts/threads'
import { get } from '../../lib/api'
import Callout from '../../components/ui/Callout'
import { fill } from '../../lib/format'
import { useTranslations } from '../../i18n/index'
import PostCard from './PostCard'
import PostList from './PostList'
import Avatar from './Avatar'
import AuthorLine from './AuthorLine'
import { usePaged } from './usePaged'

/**
 * A post in context (US2): what it answers, the post, and its direct replies,
 * oldest first so the conversation reads top to bottom. A post this member
 * cannot see is the server's 404, rendered as "not available" — never as a
 * guess about why.
 */
export function PostView() {
  const t = useTranslations()
  const { id } = useParams()
  const [view, setView] = useState<ThreadView | null>(null)
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    try {
      setView((await get(`/threads/posts/${id}`)) as ThreadView)
      setMissing(false)
    } catch {
      setMissing(true)
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  if (missing) return <Callout variant="neutral" title={t.memberThreads.unavailable}><Link to="/konsole/mitglied/threads" className="text-navy">{t.memberThreads.back}</Link></Callout>
  if (!view) return null

  const update = (post: ThreadPost) => setView((v) => v && ({
    ...v,
    post: v.post.id === post.id ? post : v.post,
    parent: v.parent?.id === post.id ? post : v.parent,
    replies: v.replies.map((r) => (r.id === post.id ? post : r)),
  }))

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <Link to="/konsole/mitglied/threads" className="mb-2 text-[13px] text-navy">← {t.memberThreads.back}</Link>
      {view.post.replyToId && !view.parent && <p className="py-2 text-[13px] text-text-muted">{t.memberThreads.unavailable}</p>}
      {view.parent && <PostCard post={view.parent} onChange={update} />}
      <PostCard post={view.post} onChange={update} onRemoved={() => setMissing(true)} />
      <h2 className="mt-4 text-[13px] font-semibold uppercase tracking-[0.06em] text-text-muted">{t.memberThreads.replies}</h2>
      <PostList
        entries={view.replies.map((post) => ({ post, key: post.id }))}
        loading={false}
        failed={false}
        hasMore={false}
        onMore={() => {}}
        onRetry={load}
        empty={t.memberThreads.noReplies}
        onUpdate={update}
        onRemove={() => void load()}
        onPosted={() => void load()}
      />
    </div>
  )
}

/** Visible quotes of a post (US2). */
export function QuotesView() {
  const t = useTranslations()
  const { id } = useParams()
  const list = usePaged<ThreadPost>(`/threads/posts/${id}/quotes`)
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <Link to={`/konsole/mitglied/threads/${id}`} className="mb-2 text-[13px] text-navy">← {t.memberThreads.back}</Link>
      <h1 className="text-[18px] font-semibold text-text">{t.memberThreads.quotes}</h1>
      <PostList
        entries={list.items.map((post) => ({ post, key: post.id }))}
        loading={list.loading} failed={list.failed} hasMore={list.hasMore} onMore={list.more} onRetry={list.reload}
        empty={t.memberThreads.empty}
        onUpdate={(post) => list.setItems((items) => items.map((p) => (p.id === post.id ? post : p)))}
        onRemove={(pid) => list.setItems((items) => items.filter((p) => p.id !== pid))}
      />
    </div>
  )
}

/** A list of members — likers, followers, following, blocked, muted. */
export function AuthorList({ url, title, empty, action }: {
  url: string
  title: string
  empty: string
  action?: (author: ThreadAuthor, drop: () => void) => React.ReactNode
}) {
  const t = useTranslations()
  const list = usePaged<ThreadAuthor>(url)
  return (
    <section className="flex flex-col">
      <h1 className="mb-2 text-[18px] font-semibold text-text">{title}</h1>
      {!list.loading && list.items.length === 0 && <p className="py-6 text-[13px] text-text-muted">{empty}</p>}
      <ul>
        {list.items.map((author) => (
          <li key={author.id} className="flex items-center gap-3 border-b border-hairline py-3">
            <Avatar author={author} size={36} alt={fill(t.memberProfile.avatarAlt, { name: author.displayName ?? '' })} />
            <div className="min-w-0 flex-1"><AuthorLine author={author} /></div>
            {action?.(author, () => list.setItems((items) => items.filter((a) => a.id !== author.id)))}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function LikesView() {
  const t = useTranslations()
  const { id } = useParams()
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <Link to={`/konsole/mitglied/threads/${id}`} className="mb-2 text-[13px] text-navy">← {t.memberThreads.back}</Link>
      <AuthorList url={`/threads/posts/${id}/likes`} title={t.memberThreads.likes} empty={t.memberThreads.empty} />
    </div>
  )
}

export default PostView

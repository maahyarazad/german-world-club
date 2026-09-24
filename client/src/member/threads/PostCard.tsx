import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { ThreadAuthor, ThreadPost } from '@gwc/contracts/threads'
import { del, post as send, put, ApiError } from '../../lib/api'
import { describeProblem } from '../../lib/problems'
import { fill, formatDateTime, formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Field, { FormMessage } from '../../components/ui/Field'
import { useLocale, useTranslations } from '../../i18n/index'
import Avatar from './Avatar'
import AuthorLine from './AuthorLine'
import PostBody from './PostBody'
import MediaGrid from './MediaGrid'
import QuoteEmbed from './QuoteEmbed'
import Modal from './Modal'

/**
 * One post in any list — feed, thread, profile tab, quotes (US1/US2).
 *
 * Every count is rendered exactly as the server returned it. A like or repost
 * sends the state it wants (PUT on, DELETE off) and then shows the post the
 * server answers with, so a double click or a retried request cannot leave
 * the button and the number disagreeing.
 *
 * `isMine` and the author decide what the menu OFFERS; the server decides
 * what is allowed, and answers a stranger's delete like a missing post.
 */
export function PostCard({ post, repostedBy, onChange, onRemoved, onReply, onQuote, onHideAuthor }: {
  post: ThreadPost
  repostedBy?: ThreadAuthor | null
  onChange: (post: ThreadPost) => void
  onRemoved?: (postId: string) => void
  onReply?: (post: ThreadPost) => void
  onQuote?: (post: ThreadPost) => void
  /** After a mute or block: the list should drop this author's posts. */
  onHideAuthor?: (authorId: string) => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const failed = (err: unknown) =>
    setError(err instanceof ApiError ? describeProblem(err.problem, locale).title : t.memberThreads.loadFailed)

  const toggle = async (kind: 'like' | 'repost', on: boolean) => {
    try {
      const url = `/threads/posts/${post.id}/${kind}`
      onChange((await (on ? put(url) : del(url))) as ThreadPost)
    } catch (err) { failed(err) }
  }

  const remove = async () => {
    setMenu(false)
    if (!window.confirm(t.memberThreads.deleteConfirm)) return
    try { await del(`/threads/posts/${post.id}`); onRemoved?.(post.id) } catch (err) { failed(err) }
  }

  const relate = async (relation: 'blocks' | 'mutes') => {
    setMenu(false)
    if (relation === 'blocks' && !window.confirm(t.memberProfile.blockConfirm)) return
    try { await put(`/threads/${relation}/${post.author.id}`); onHideAuthor?.(post.author.id) } catch (err) { failed(err) }
  }

  const report = async () => {
    try {
      await send(`/threads/posts/${post.id}/report`, { reason: reason.trim() })
      setReporting(false)
      setReason('')
      setNotice(t.memberThreads.reported)
    } catch (err) { failed(err) }
  }

  const count = (n: number) => (n > 0 ? formatNumber(n, locale) : '')
  const action = 'flex items-center gap-1 rounded-card px-2 py-1 text-[12px] text-text-muted hover:bg-ground hover:text-text'

  return (
    <article className="flex gap-3 border-b border-hairline px-1 py-4">
      <Link to={`/konsole/mitglied/mitglieder/${post.author.handle ?? post.author.id}`} className="shrink-0">
        <Avatar author={post.author} alt={fill(t.memberProfile.avatarAlt, { name: post.author.displayName ?? '' })} />
      </Link>
      <div className="min-w-0 flex-1">
        {repostedBy && (
          <p className="mb-0.5 text-[11px] text-text-muted">
            ↻ {fill(t.memberThreads.repostedBy, { name: repostedBy.displayName ?? `@${repostedBy.handle ?? ''}` })}
          </p>
        )}
        <div className="flex items-start justify-between gap-2">
          <AuthorLine author={post.author}>
            <Link to={`/konsole/mitglied/threads/${post.id}`} className="text-[12px] text-text-muted hover:underline">
              <time dateTime={post.createdAt}>{formatDateTime(post.createdAt, locale)}</time>
            </Link>
          </AuthorLine>
          <div className="relative">
            <button type="button" aria-label={t.memberThreads.more} aria-expanded={menu} onClick={() => setMenu(!menu)} className={action}>
              ⋯
            </button>
            {menu && (
              <ul role="menu" className="absolute right-0 z-10 mt-1 w-48 rounded-card border border-hairline bg-surface py-1 shadow-lg">
                {post.isMine ? (
                  <li><button type="button" role="menuitem" className="w-full px-3 py-2 text-left text-[13px] hover:bg-ground" onClick={remove}>{t.memberThreads.delete}</button></li>
                ) : (
                  <>
                    <li><button type="button" role="menuitem" className="w-full px-3 py-2 text-left text-[13px] hover:bg-ground" onClick={() => { setMenu(false); setReporting(true) }}>{t.memberThreads.report}</button></li>
                    <li><button type="button" role="menuitem" className="w-full px-3 py-2 text-left text-[13px] hover:bg-ground" onClick={() => relate('mutes')}>{t.memberProfile.mute}</button></li>
                    <li><button type="button" role="menuitem" className="w-full px-3 py-2 text-left text-[13px] hover:bg-ground" onClick={() => relate('blocks')}>{t.memberProfile.block}</button></li>
                  </>
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="cursor-pointer" onClick={() => navigate(`/konsole/mitglied/threads/${post.id}`)}>
          <PostBody body={post.body} mentions={post.mentions} />
        </div>
        <MediaGrid media={post.media} />
        {post.quoted && <QuoteEmbed quoted={post.quoted} />}

        <div className="mt-2 flex flex-wrap gap-1">
          <button type="button" className={action} onClick={() => toggle('like', !post.likedByMe)} aria-pressed={post.likedByMe}
            aria-label={post.likedByMe ? t.memberThreads.unlike : t.memberThreads.like}>
            <span aria-hidden className={post.likedByMe ? 'text-tint-danger-fg' : ''}>{post.likedByMe ? '♥' : '♡'}</span>{count(post.likeCount)}
          </button>
          <button type="button" className={action} onClick={() => onReply?.(post)} aria-label={t.memberThreads.reply}>
            <span aria-hidden>💬</span>{count(post.replyCount)}
          </button>
          <button type="button" className={action} onClick={() => toggle('repost', !post.repostedByMe)} aria-pressed={post.repostedByMe}
            aria-label={post.repostedByMe ? t.memberThreads.unrepost : t.memberThreads.repost}>
            <span aria-hidden className={post.repostedByMe ? 'text-tint-success-fg' : ''}>↻</span>{count(post.repostCount)}
          </button>
          <button type="button" className={action} onClick={() => onQuote?.(post)} aria-label={t.memberThreads.quote}>
            <span aria-hidden>❝</span>
            {post.quoteCount > 0 && <Link to={`/konsole/mitglied/threads/${post.id}/zitate`} onClick={(e) => e.stopPropagation()}>{count(post.quoteCount)}</Link>}
          </button>
        </div>

        {notice && <p role="status" className="mt-1 text-[12px] text-text-muted">{notice}</p>}
        {error && <FormMessage>{error}</FormMessage>}
      </div>

      <Modal title={t.memberThreads.report} open={reporting} onClose={() => setReporting(false)}>
        <Field label={t.memberThreads.reportReason} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReporting(false)}>{t.memberThreads.cancel}</Button>
          <Button disabled={reason.trim().length < 3} onClick={report}>{t.memberThreads.report}</Button>
        </div>
      </Modal>
    </article>
  )
}

export default PostCard

import { Link } from 'react-router'
import type { QuotedPost } from '@gwc/contracts/threads'
import { useLocale, useTranslations } from '../../i18n/index'
import { formatDateTime } from '../../lib/format'
import AuthorLine from './AuthorLine'
import Avatar from './Avatar'
import PostBody from './PostBody'
import MediaGrid from './MediaGrid'
import { fill } from '../../lib/format'

/**
 * The quoted post inside a quote (US2, FR-005).
 *
 * `unavailable` renders a tombstone and nothing else. The server sends
 * nothing of a quoted post that is no longer visible — this component has no
 * body, author or media to show even if it wanted to (research R6, SC-005).
 */
export function QuoteEmbed({ quoted }: { quoted: QuotedPost }) {
  const t = useTranslations()
  const { locale } = useLocale()
  if (quoted.unavailable) {
    return (
      <p className="mt-2 rounded-card border border-hairline bg-ground px-3 py-2.5 text-[13px] text-text-muted">
        {t.memberThreads.unavailable}
      </p>
    )
  }
  const { post } = quoted
  return (
    <div className="mt-2 rounded-card border border-hairline px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Avatar author={post.author} size={20} alt={fill(t.memberProfile.avatarAlt, { name: post.author.displayName ?? '' })} />
        <AuthorLine author={post.author}>
          <span className="text-[12px] text-text-muted">{formatDateTime(post.createdAt, locale)}</span>
        </AuthorLine>
      </div>
      <Link to={`/konsole/mitglied/threads/${post.id}`} className="block">
        <PostBody body={post.body} mentions={post.mentions} />
      </Link>
      <MediaGrid media={post.media} />
    </div>
  )
}

export default QuoteEmbed

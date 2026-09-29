import { useEffect } from 'react'
import { Link } from 'react-router'
import type { ActivityItem } from '@gwc/contracts/threads'
import { post, ApiError } from '../../lib/api'
import PageHeader from '../../components/ui/PageHeader'
import { fill, formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../i18n/index'
import { usePaged } from './usePaged'
import Avatar from './Avatar'
import { profilePath } from './AuthorLine'

/**
 * Activity (US5): what happened to you, newest first — computed by the
 * server from the likes, replies, quotes, reposts, mentions and follows
 * themselves. Opening it moves the unread boundary to the newest item shown;
 * the server only ever moves it forward.
 */
export function Activity({ onSeen }: { onSeen?: () => void }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const list = usePaged<ActivityItem>('/threads/activity')
  const newest = list.items[0]?.at

  useEffect(() => {
    if (!newest) return
    void post('/threads/activity/seen', { upTo: newest }).then(() => onSeen?.())
      .catch((err) => console.error('Activity.markSeen', err instanceof ApiError ? err.problem : err))
  }, [newest, onSeen])

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageHeader title={t.memberActivity.title} />
      {!list.loading && list.items.length === 0 && <p className="py-8 text-center text-[13px] text-text-muted">{t.memberActivity.empty}</p>}
      <ul>
        {list.items.map((item) => {
          const name = item.actor.displayName ?? `@${item.actor.handle ?? ''}`
          const target = item.post ? `/konsole/mitglied/threads/${item.post.id}` : profilePath(item.actor)
          return (
            <li key={`${item.kind}:${item.post?.id ?? ''}:${item.actor.id}:${item.at}`} className="border-b border-hairline">
              <Link to={target} className="flex gap-3 py-3 hover:bg-ground">
                <Avatar author={item.actor} size={36} alt={fill(t.memberProfile.avatarAlt, { name })} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-text">{fill(t.memberActivity.kinds[item.kind], { name })}</p>
                  {item.post?.body && <p className="truncate text-[13px] text-text-muted">{item.post.body}</p>}
                  <time dateTime={item.at} className="text-[11px] text-text-muted">{formatDateTime(item.at, locale)}</time>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
      {list.hasMore && <button type="button" className="py-3 text-[13px] text-navy" onClick={list.more}>{t.memberThreads.loadMore}</button>}
    </div>
  )
}

export default Activity

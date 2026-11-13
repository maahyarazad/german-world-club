import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { Conversation, InboxPage } from '@gwc/contracts/messaging'
import { get, ApiError } from '../../lib/api'
import { fill, formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../i18n/index'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import PageHeader from '../../components/ui/PageHeader'
import StatusPill from '../../components/ui/StatusPill'

/**
 * Messages: every conversation about a listing, newest activity first
 * (feature 020, US3). There is no real-time transport (008): what is new shows
 * when the page is opened, and the email is the timely channel.
 */
export function Inbox() {
  const t = useTranslations()
  const { locale } = useLocale()
  const [items, setItems] = useState<Conversation[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  // Only whether loading failed — never what the server said (CLAUDE.md).
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (cursor: string | null) => {
    setFailed(false)
    try {
      const page = (await get(`/messages/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)) as InboxPage
      setItems((current) => (cursor ? [...(current ?? []), ...page.items] : page.items))
      setNext(page.nextCursor)
    } catch (error) {
      console.error('Inbox.load', error instanceof ApiError ? error.problem : error)
      setFailed(true)
    }
  }, [])

  useEffect(() => { void load(null) }, [load])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.memberMessages.title} subtitle={t.memberMessages.subtitle} />
      {failed && (
        <Card>
          <p className="text-[14px] text-text-muted">{t.memberMessages.loadFailed}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void load(null)}>{t.memberMessages.retry}</Button>
        </Card>
      )}
      {items && items.length === 0 && <p className="py-6 text-center text-[13px] text-text-muted">{t.memberMessages.empty}</p>}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                to={`/konsole/mitglied/nachrichten/${c.id}`}
                className="block rounded-card border border-hairline bg-surface p-4 hover:bg-ground"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className={`text-[15px] text-text ${c.unreadCount > 0 ? 'font-semibold' : ''}`}>
                    {c.subject.title ?? t.memberMessages.listingGone}
                  </p>
                  {c.unreadCount > 0 && (
                    <StatusPill tone="info">{fill(t.memberMessages.unread, { n: c.unreadCount })}</StatusPill>
                  )}
                </div>
                <p className="mt-1 text-[13px] text-text-muted">{c.counterpart?.displayName ?? ''}</p>
                {c.lastMessage && <p className="mt-1 line-clamp-2 text-[13px] text-text">{c.lastMessage.excerpt}</p>}
                <time dateTime={c.lastMessageAt} className="mt-1 block text-[11px] text-text-muted">
                  {formatDateTime(c.lastMessageAt, locale)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {next && <Button variant="quiet" onClick={() => void load(next)}>{t.memberMessages.loadMore}</Button>}
    </div>
  )
}

export default Inbox

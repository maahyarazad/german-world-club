import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { PROBLEMS } from '@gwc/contracts/errors'
import { MESSAGE_MAX } from '@gwc/contracts/messaging'
import type { ConversationView, Message } from '@gwc/contracts/messaging'
import { get, post, ApiError } from '../../lib/api'
import { fill, formatDateTime } from '../../lib/format'
import { useCapabilities } from '../../lib/capabilities'
import { useLocale, useTranslations } from '../../i18n/index'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import { FormMessage } from '../../components/ui/Field'

/**
 * One conversation about a listing (feature 020, US3): the messages in order,
 * the member's own on the right, and a reply box. Opening it marks it read on
 * the server. Still answerable after the listing closed (008 FR-027).
 */
export function Conversation() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { id } = useParams()
  const { snapshot } = useCapabilities()
  const me = snapshot?.kind === 'member' ? String(snapshot.id) : null

  const [view, setView] = useState<ConversationView | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [missing, setMissing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [slowDown, setSlowDown] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const v = (await get(`/messages/conversations/${id}`)) as ConversationView
      setView(v)
      // Newest first from the server; oldest first on screen.
      setMessages([...v.messages].reverse())
    } catch (error) {
      console.error('Conversation.load', error instanceof ApiError ? error.problem : error)
      if (error instanceof ApiError && error.problem?.type === PROBLEMS.NOT_FOUND.type) setMissing(true)
      else setFailed(true)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  const send = async () => {
    const text = body.trim()
    if (!text) return
    setBusy(true)
    setSlowDown(false)
    try {
      const sent = (await post(`/messages/conversations/${id}/messages`, { body: text })) as Message
      setMessages((current) => [...current, sent])
      setBody('')
    } catch (error) {
      console.error('Conversation.send', error instanceof ApiError ? error.problem : error)
      setSlowDown(error instanceof ApiError && error.problem?.type === PROBLEMS.RATE_LIMITED.type)
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <Link to="/konsole/mitglied/nachrichten" className="text-[13px] text-navy">← {t.memberMessages.back}</Link>
  )

  if (missing) return <div className="flex flex-col gap-4">{back}<Callout variant="neutral" title={t.memberMessages.notFound}>{null}</Callout></div>
  if (failed) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="text-[14px] text-text-muted">{t.memberMessages.loadFailed}</p>
        <Button variant="secondary" onClick={() => void load()}>{t.memberMessages.retry}</Button>
      </div>
    )
  }
  if (!view) return null

  const other = view.conversation.counterpart?.displayName ?? ''
  const title = view.conversation.subject.title

  return (
    <div className="flex flex-col gap-4">
      {back}
      <header>
        <h1 className="text-[20px] font-semibold text-text">{other}</h1>
        <p className="text-[13px] text-text-muted">
          {title ? fill(t.memberMessages.about, { title }) : t.memberMessages.listingGone}
        </p>
      </header>

      <ol className="flex flex-col gap-3">
        {messages.map((m) => {
          const mine = m.senderId === me
          return (
            <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-card border px-4 py-3 ${mine ? 'border-navy bg-navy text-text-on-dark' : 'border-hairline bg-surface text-text'}`}>
                <p className="whitespace-pre-wrap text-[14px]">{m.body}</p>
                <p className={`mt-1 text-[11px] ${mine ? 'text-text-on-dark-muted' : 'text-text-muted'}`}>
                  {mine ? t.memberMessages.you : other} · <time dateTime={m.createdAt}>{formatDateTime(m.createdAt, locale)}</time>
                </p>
              </div>
            </li>
          )
        })}
      </ol>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => { e.preventDefault(); void send() }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">{t.memberMessages.replyPlaceholder}</span>
          <textarea
            value={body}
            maxLength={MESSAGE_MAX}
            rows={3}
            placeholder={t.memberMessages.replyPlaceholder}
            onChange={(e) => setBody(e.target.value)}
            className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[14px] text-text"
          />
        </label>
        {slowDown && <FormMessage tone="danger">{t.memberRequests.slowDown}</FormMessage>}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !body.trim()}>{t.memberMessages.send}</Button>
        </div>
      </form>
    </div>
  )
}

export default Conversation

import { useState } from 'react'
import { Link } from 'react-router'
import { PROBLEMS } from '@gwc/contracts/errors'
import { MESSAGE_MAX } from '@gwc/contracts/messaging'
import type { InquireResponse } from '@gwc/contracts/messaging'
import type { Listing } from '@gwc/contracts/marketplace'
import { post, ApiError } from '../lib/api'
import { fill } from '../lib/format'
import { useTranslations } from '../i18n/index'
import Button from '../components/ui/Button'
import { FormMessage } from '../components/ui/Field'
import Modal from './threads/Modal'

/**
 * "Send request" on a listing card (feature 020, US1).
 *
 * Shown on someone else's listing that can be contacted. The server decides
 * regardless: an own, closed or blocked listing is refused there, and this
 * only avoids offering what would be refused. A request is a message in a
 * conversation about the listing; sending a second one continues the same
 * conversation (008's inquiry is idempotent per member and listing).
 *
 * Two refusals are shown, because the member cannot do anything sensible
 * without knowing them: the listing no longer takes requests, and "slow down".
 * Everything else is logged, not stored (CLAUDE.md).
 */
export function ListingRequest({ listing, memberId }: { listing: Listing; memberId: string | undefined }) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'closed' | 'slowDown' | 'failed' | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)

  if (!memberId || listing.owner?.id === memberId || !listing.contact?.available) return null

  if (conversationId) {
    return (
      <p className="mt-3 text-[13px] text-text">
        {t.memberRequests.sent}{' · '}
        <Link to={`/konsole/mitglied/nachrichten/${conversationId}`} className="font-semibold text-navy hover:underline">
          {t.memberRequests.openConversation}
        </Link>
      </p>
    )
  }

  const send = async () => {
    const text = body.trim()
    if (!text) return
    setBusy(true)
    setNotice(null)
    try {
      const sent = (await post(`/marketplace/listings/${listing.id}/inquire`, { body: text })) as InquireResponse
      setConversationId(sent.conversationId)
      setOpen(false)
      setBody('')
    } catch (error) {
      console.error('ListingRequest.send', error instanceof ApiError ? error.problem : error)
      const type = error instanceof ApiError ? error.problem?.type : undefined
      setNotice(type === PROBLEMS.GONE.type ? 'closed' : type === PROBLEMS.RATE_LIMITED.type ? 'slowDown' : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" className="mt-3" onClick={() => setOpen(true)}>{t.memberRequests.send}</Button>
      <Modal title={fill(t.memberRequests.dialogTitle, { title: listing.title })} open={open} onClose={() => setOpen(false)}>
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">{t.memberRequests.placeholder}</span>
          <textarea
            value={body}
            maxLength={MESSAGE_MAX}
            rows={5}
            placeholder={t.memberRequests.placeholder}
            onChange={(e) => setBody(e.target.value)}
            className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[14px] text-text"
          />
          <span className="self-end text-[11px] text-text-muted">
            {fill(t.memberRequests.counter, { n: body.length, max: MESSAGE_MAX })}
          </span>
        </label>
        {notice && <FormMessage tone="danger">{t.memberRequests[notice]}</FormMessage>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>{t.memberRequests.cancel}</Button>
          <Button disabled={busy || !body.trim()} onClick={() => void send()}>{t.memberRequests.submit}</Button>
        </div>
      </Modal>
    </>
  )
}

export default ListingRequest

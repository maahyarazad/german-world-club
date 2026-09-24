import { useEffect, useRef, useState } from 'react'
import { PROBLEMS } from '@gwc/contracts/errors'
import { MEDIA_MAX_BYTES } from '@gwc/contracts/media'
import { THREAD_MEDIA_MAX, THREAD_POST_MAX } from '@gwc/contracts/threads'
import type { ThreadPost } from '@gwc/contracts/threads'
import { get, post, ApiError } from '../../lib/api'
import { describeProblem } from '../../lib/problems'
import { fill } from '../../lib/format'
import Button from '../../components/ui/Button'
import Field, { FormMessage } from '../../components/ui/Field'
import Modal from './Modal'
import QuoteEmbed from './QuoteEmbed'
import HandleDialog from '../profile/HandleDialog'
import { MEDIA_TYPES } from '../MediaPicker'
import { useLocale, useTranslations } from '../../i18n/index'

/**
 * Writing a post, a reply or a quote, with up to ten photos or videos
 * (US1/US2).
 *
 * Media is uploaded FIRST, one file at a time through the ordinary upload
 * route, and the post is created only once every item is `ready` — the post
 * and its media are one transaction on the server, and a post cannot gain
 * media afterwards (research R4). A video comes back `processing`; the
 * composer waits for it, bounded, rather than posting without it.
 *
 * The limits imported here (length, count, size, types) are for early
 * feedback only. The server re-checks every one (Principle I).
 */

type Pending = { key: string; file: File; alt: string; preview: string }
type Asset = { id: string; state: string }

let counter = 0

async function uploadReady(item: Pending): Promise<string> {
  const form = new FormData()
  // Alt BEFORE the file: the server reads the fields that precede the file part.
  form.append('alt', item.alt.trim())
  form.append('file', item.file)
  let asset = (await post('/media', form)) as Asset
  for (let waited = 0; asset.state === 'processing' && waited < 120_000; waited += 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    asset = (await get(`/media/${asset.id}`)) as Asset
  }
  if (asset.state !== 'ready') throw new Error(`asset ${asset.id} is ${asset.state}`)
  return asset.id
}

export function Composer({ open, onClose, onPosted, replyTo, quote }: {
  open: boolean
  onClose: () => void
  onPosted: (post: ThreadPost) => void
  replyTo?: ThreadPost | null
  quote?: ThreadPost | null
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [body, setBody] = useState('')
  const [media, setMedia] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [askHandle, setAskHandle] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  // Asset ids already uploaded in this session of the composer, so a retry
  // after a refusal does not upload the same files twice.
  const uploaded = useRef(new Map<string, string>())

  useEffect(() => () => { for (const m of media) URL.revokeObjectURL(m.preview) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    for (const m of media) URL.revokeObjectURL(m.preview)
    setBody(''); setMedia([]); setError(null); setStatus(null); uploaded.current.clear()
  }

  const add = (files: FileList | null) => {
    const picked = [...(files ?? [])]
    if (picked.some((f) => !MEDIA_TYPES.includes(f.type))) return setError(t.memberThreads.mediaUnsupported)
    if (picked.some((f) => f.size > MEDIA_MAX_BYTES)) return setError(t.memberThreads.mediaTooLarge)
    if (media.length + picked.length > THREAD_MEDIA_MAX) {
      return setError(fill(t.memberThreads.mediaTooMany, { max: THREAD_MEDIA_MAX }))
    }
    setError(null)
    setMedia([...media, ...picked.map((file) => ({ key: `m${(counter += 1)}`, file, alt: '', preview: URL.createObjectURL(file) }))])
  }

  const submit = async () => {
    if (media.some((m) => !m.alt.trim())) return setError(t.memberThreads.mediaAltMissing)
    setBusy(true)
    setError(null)
    try {
      const assetIds: string[] = []
      if (media.length > 0) setStatus(t.memberThreads.mediaUploading)
      for (const item of media) {
        const id = uploaded.current.get(item.key) ?? await uploadReady(item)
        uploaded.current.set(item.key, id)
        assetIds.push(id)
      }
      setStatus(t.memberThreads.posting)
      const created = (await post('/threads/posts', {
        body: body.trim(),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        ...(quote ? { quoteOfId: quote.id } : {}),
        media: assetIds.map((assetId) => ({ assetId })),
      })) as ThreadPost
      reset()
      onPosted(created)
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.problem.type === PROBLEMS.HANDLE_REQUIRED.type) {
        // The server's answer, not a guess from local state: open the
        // username dialog, and post again once one is chosen.
        setAskHandle(true)
      } else if (err instanceof ApiError) {
        setError(describeProblem(err.problem, locale).title)
      } else {
        setError(t.memberThreads.mediaFailed)
      }
    } finally {
      setBusy(false)
      setStatus(null)
    }
  }

  const title = replyTo ? t.memberThreads.replyTitle : quote ? t.memberThreads.quoteTitle : t.memberThreads.composeTitle
  const empty = body.trim().length === 0 && media.length === 0

  return (
    <>
      <Modal title={title} open={open && !askHandle} onClose={onClose}>
        <label className="sr-only" htmlFor="composer-body">{t.memberThreads.placeholder}</label>
        <textarea
          id="composer-body"
          value={body}
          maxLength={THREAD_POST_MAX}
          rows={4}
          placeholder={t.memberThreads.placeholder}
          onChange={(e) => setBody(e.target.value)}
          className="w-full resize-y rounded-card border border-hairline bg-surface px-3 py-2.5 text-[14px] text-text"
        />
        <p className="-mt-2 text-right text-[11px] text-text-muted">
          {fill(t.memberThreads.counter, { count: body.length, max: THREAD_POST_MAX })}
        </p>

        {quote && <QuoteEmbed quoted={{ unavailable: false, post: { ...quote, quoteOfId: quote.quoted && !quote.quoted.unavailable ? quote.quoted.post.id : null } }} />}

        {media.length > 0 && (
          <ul className="grid grid-cols-2 gap-2">
            {media.map((item) => (
              <li key={item.key} className="flex flex-col gap-1.5">
                {item.file.type.startsWith('video/')
                  ? <video src={item.preview} muted width={240} height={180} className="aspect-[4/3] w-full rounded-card object-cover" />
                  : <img src={item.preview} alt={item.alt} width={240} height={180} className="aspect-[4/3] w-full rounded-card object-cover" />}
                <Field
                  label={t.memberThreads.mediaAlt}
                  value={item.alt}
                  onChange={(e) => setMedia(media.map((m) => (m.key === item.key ? { ...m, alt: e.target.value } : m)))}
                />
                <Button variant="quiet" onClick={() => { URL.revokeObjectURL(item.preview); setMedia(media.filter((m) => m.key !== item.key)) }}>
                  {t.memberThreads.mediaRemove}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error && <FormMessage>{error}</FormMessage>}
        {status && <p role="status" className="text-[12px] text-text-muted">{status}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" disabled={busy || media.length >= THREAD_MEDIA_MAX} onClick={() => input.current?.click()}>
            {t.memberThreads.addMedia}
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept={MEDIA_TYPES.join(',')}
            aria-label={t.memberThreads.addMedia}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => { add(e.target.files); e.target.value = '' }}
          />
          <div className="flex gap-2">
            <Button variant="quiet" onClick={onClose}>{t.memberThreads.cancel}</Button>
            <Button disabled={busy || empty} onClick={submit}>{busy ? t.memberThreads.posting : t.memberThreads.post}</Button>
          </div>
        </div>
      </Modal>
      <HandleDialog
        open={askHandle}
        current={null}
        onClose={() => setAskHandle(false)}
        onSaved={() => { setAskHandle(false); void submit() }}
      />
    </>
  )
}

export default Composer

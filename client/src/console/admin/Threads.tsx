import { useCallback, useEffect, useState } from 'react'
import { get, post, ApiError } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type { MediaItem } from '@gwc/contracts/media'
import PageHeader from '../../components/ui/PageHeader'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Field from '../../components/ui/Field'
import StatusPill from '../../components/ui/StatusPill'
import { useLocale, useTranslations } from '../../i18n/index'
import MediaGrid from '../../member/threads/MediaGrid'

type Report = { id: string; postId: string; reason: string; createdAt: string; postBody: string; postState: string }
type StaffPost = {
  id: string; authorDisplayName: string | null; body: string; state: string; stateReason: string | null
  createdAt: string; media: MediaItem[]
  quoted: { id: string; body: string; state: string; media: MediaItem[] } | null
}
type Action = 'hide' | 'restore' | 'remove' | 'upheld' | 'dismissed'

const STATE_TONE = { visible: 'success', hidden: 'pending', removed: 'danger', deleted: 'neutral' } as const

/**
 * Threads moderation (US7), on 009's `/admin/threads/*` API.
 *
 * Staff see what they judge, including a hidden post's photos. Every action
 * needs a reason, which goes to the audit log; nothing here edits what a
 * member wrote, and no endpoint exists that could (§8).
 */
export function ThreadsModeration() {
  const t = useTranslations()
  const { locale } = useLocale()
  const [reports, setReports] = useState<Report[]>([])
  const [open, setOpen] = useState<{ report: Report; post: StaffPost } | null>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    const body = (await get('/admin/threads/reports?state=open')) as { items: Report[] }
    setReports(body.items)
  }, [])
  useEffect(() => { void load().catch((err) => console.error('ThreadsModeration.load', err instanceof ApiError ? err.problem : err)) }, [load])

  const show = async (report: Report) => {
    setOpen({ report, post: (await get(`/admin/threads/posts/${report.postId}`)) as StaffPost })
  }

  const confirm = async () => {
    if (!open || !pending) return
    try {
      if (pending === 'upheld' || pending === 'dismissed') {
        await post(`/admin/threads/reports/${open.report.id}/resolve`, { outcome: pending, note: reason.trim() })
      } else {
        await post(`/admin/threads/posts/${open.post.id}/${pending}`, { reason: reason.trim() })
      }
      setPending(null); setReason(''); setOpen(null)
      await load()
    } catch (err) {
      console.error('ThreadsModeration.confirm', err instanceof ApiError ? err.problem : err)
    }
  }

  const state = (s: string) => (
    <StatusPill tone={STATE_TONE[s as keyof typeof STATE_TONE] ?? 'neutral'}>
      {t.threadsModeration.states[s as keyof typeof t.threadsModeration.states] ?? s}
    </StatusPill>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.threadsModeration.title} subtitle={t.threadsModeration.subtitle} />
      <Card title={t.threadsModeration.queue}>
        {reports.length === 0 ? <p className="text-[13px] text-text-muted">{t.threadsModeration.empty}</p> : (
          <ul className="divide-y divide-hairline">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-text">{r.postBody || '—'}</p>
                  <p className="text-[12px] text-text-muted">{t.threadsModeration.reason}: {r.reason} · {formatDateTime(r.createdAt, locale)}</p>
                </div>
                {state(r.postState)}
                <Button variant="secondary" onClick={() => void show(r)}>{t.threadsModeration.open}</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && (
        <Card title={t.threadsModeration.post}>
          <p className="text-[13px] text-text-muted">{open.post.authorDisplayName ?? '—'} · {formatDateTime(open.post.createdAt, locale)} · {state(open.post.state)}</p>
          <p className="whitespace-pre-wrap text-[14px] text-text">{open.post.body}</p>
          <MediaGrid media={open.post.media} />
          {open.post.quoted && (
            <div className="rounded-card border border-hairline p-3">
              <p className="text-[11px] font-semibold uppercase text-text-muted">{t.threadsModeration.quotedPost} · {state(open.post.quoted.state)}</p>
              <p className="whitespace-pre-wrap text-[13px] text-text">{open.post.quoted.body}</p>
              <MediaGrid media={open.post.quoted.media} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {open.post.state === 'visible' && <Button variant="secondary" onClick={() => setPending('hide')}>{t.threadsModeration.hide}</Button>}
            {open.post.state === 'hidden' && <Button variant="secondary" onClick={() => setPending('restore')}>{t.threadsModeration.restore}</Button>}
            {(open.post.state === 'visible' || open.post.state === 'hidden') && <Button variant="secondary" onClick={() => setPending('remove')}>{t.threadsModeration.remove}</Button>}
            <Button variant="quiet" onClick={() => setPending('upheld')}>{t.threadsModeration.upheld}</Button>
            <Button variant="quiet" onClick={() => setPending('dismissed')}>{t.threadsModeration.dismissed}</Button>
          </div>
          {pending && (
            <div className="flex flex-col gap-2 rounded-card bg-ground p-3">
              <Field label={t.threadsModeration.reasonLabel} value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-2">
                <Button disabled={reason.trim().length < 3} onClick={() => void confirm()}>{t.threadsModeration.confirm}</Button>
                <Button variant="quiet" onClick={() => { setPending(null); setReason('') }}>{t.threadsModeration.cancel}</Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

export default ThreadsModeration

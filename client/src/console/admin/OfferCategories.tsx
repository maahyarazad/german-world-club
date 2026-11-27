import { useEffect, useState } from 'react'
import type { OfferCategory } from '@gwc/contracts/offers'
import { hasGrant } from '@gwc/contracts/capabilities'
import { get, post, patch, ApiError } from '../../lib/api'
import { useCapabilities } from '../../lib/capabilities'
import { useLocale, useTranslations } from '../../i18n/index'
import RequireGrant from '../RequireGrant'
import PageHeader from '../../components/ui/PageHeader'
import PageLoader from '../../components/ui/PageLoader'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Field, { FormMessage } from '../../components/ui/Field'
import StatusPill from '../../components/ui/StatusPill'
import { useAction } from '../../lib/useAction'
import { useReveal } from '../../lib/useReveal'

/**
 * Staff management of offer categories (feature 035, US4): every category with
 * how many offers sit under it, renamed, reordered, hidden and shown, and added.
 * There is no delete: a category with offers cannot go, and hiding is enough.
 * Hiding keeps the category on its offers; it only stops merchants choosing it
 * for new ones.
 *
 * The write controls show only with the matching flag, absent rather than
 * disabled (RequireGrant.tsx); the server re-checks every one.
 */
export function OfferCategories() {
  return (
    <RequireGrant module="merchant_offers" flag="read">
      <Categories />
    </RequireGrant>
  )
}

function Categories() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { snapshot } = useCapabilities()
  const canAdd = hasGrant(snapshot, 'merchant_offers', 'write')
  const canEdit = hasGrant(snapshot, 'merchant_offers', 'edit')
  const [items, setItems] = useState<OfferCategory[] | null>(null)
  const [edits, setEdits] = useState<Record<string, { nameDe: string; nameEn: string }>>({})
  const [draft, setDraft] = useState({ slug: '', nameDe: '', nameEn: '' })
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  // Unlike the other pages this one does not clear its message between saves, so a second save
  // shows the same words on the same element: `useReveal` takes the message object, which is new
  // every time (feature 041). Above the loader's early return, like every hook.
  const messageRef = useReveal<HTMLDivElement>(message)

  const adopt = (list: OfferCategory[]) => {
    setItems(list)
    setEdits(Object.fromEntries(list.map((c) => [c.id, { nameDe: c.nameDe, nameEn: c.nameEn }])))
  }
  useEffect(() => {
    void (get('/admin/offer-categories') as Promise<{ items: OfferCategory[] }>).then((r) => adopt(r.items))
      .catch((err) => console.error('OfferCategories.load', err instanceof ApiError ? err.problem : err))
  }, [])

  const replace = (next: OfferCategory) => setItems((current) => current?.map((c) => (c.id === next.id ? next : c)).sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug)) ?? null)

  const [save] = useAction('OfferCategories.save', async (c: OfferCategory, changes: Partial<OfferCategory>) => {
    replace((await patch(`/admin/offer-categories/${c.id}`, changes)) as OfferCategory)
    setMessage({ tone: 'success', text: t.adminCategories.saved })
  })

  /** Swap this category's position with its neighbour's, in two requests. */
  const [move] = useAction('OfferCategories.move', async (c: OfferCategory, direction: -1 | 1) => {
    if (!items) return
    const index = items.findIndex((x) => x.id === c.id)
    const other = items[index + direction]
    if (!other) return
    const a = (await patch(`/admin/offer-categories/${c.id}`, { position: other.position })) as OfferCategory
    const b = (await patch(`/admin/offer-categories/${other.id}`, { position: c.position })) as OfferCategory
    setItems((current) => current?.map((x) => (x.id === a.id ? a : x.id === b.id ? b : x)).sort((p, q) => p.position - q.position || p.slug.localeCompare(q.slug)) ?? null)
  })

  const [add, adding] = useAction('OfferCategories.add', async () => {
    try {
      const created = (await post('/admin/offer-categories', {
        slug: draft.slug.trim(), nameDe: draft.nameDe.trim(), nameEn: draft.nameEn.trim(),
      })) as OfferCategory
      adopt([...(items ?? []), created])
      setDraft({ slug: '', nameDe: '', nameEn: '' })
      setMessage({ tone: 'success', text: t.adminCategories.saved })
    } catch (err) {
      // A taken identifier is the one refusal the person cannot proceed without knowing.
      if (err instanceof ApiError && err.status === 409) { setMessage({ tone: 'danger', text: t.adminCategories.slugTaken }); return }
      throw err
    }
  })

  if (!items) return <PageLoader />
  const valid = /^[a-z][a-z0-9-]{1,39}$/.test(draft.slug.trim()) && draft.nameDe.trim() !== '' && draft.nameEn.trim() !== ''

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.adminCategories.title} subtitle={t.adminCategories.subtitle} />
      {message && <FormMessage ref={messageRef} tone={message.tone}>{message.text}</FormMessage>}

      <Card>
        <ul className="flex flex-col divide-y divide-hairline">
          {items.map((c, index) => {
            const edit = edits[c.id] ?? { nameDe: c.nameDe, nameEn: c.nameEn }
            const dirty = edit.nameDe.trim() !== c.nameDe || edit.nameEn.trim() !== c.nameEn
            return (
              <li key={c.id} className="flex flex-wrap items-end gap-3 py-3">
                <div className="flex min-w-[10rem] flex-col">
                  <span className="font-mono text-[12px] text-text-muted">{c.slug}</span>
                  <span className="text-[12px] text-text-muted">{t.adminCategories.offers}: {c.offerCount}</span>
                  <StatusPill tone={c.visible ? 'success' : 'neutral'} className="mt-1 w-fit">{c.visible ? t.adminCategories.visible : t.adminCategories.hidden}</StatusPill>
                </div>
                <Field label={t.adminCategories.nameDe} value={edit.nameDe} disabled={!canEdit} maxLength={80}
                  onChange={(e) => setEdits({ ...edits, [c.id]: { ...edit, nameDe: e.target.value } })} />
                <Field label={t.adminCategories.nameEn} value={edit.nameEn} disabled={!canEdit} maxLength={80}
                  onChange={(e) => setEdits({ ...edits, [c.id]: { ...edit, nameEn: e.target.value } })} />
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={!dirty || !edit.nameDe.trim() || !edit.nameEn.trim()}
                      onClick={() => void save(c, { nameDe: edit.nameDe.trim(), nameEn: edit.nameEn.trim() })}>{t.adminCategories.save}</Button>
                    <Button variant="secondary" onClick={() => void save(c, { visible: !c.visible })}>{c.visible ? t.adminCategories.hide : t.adminCategories.show}</Button>
                    <Button variant="quiet" disabled={index === 0} aria-label={`${t.adminCategories.moveUp}: ${locale === 'en' ? c.nameEn : c.nameDe}`} onClick={() => void move(c, -1)}>↑</Button>
                    <Button variant="quiet" disabled={index === items.length - 1} aria-label={`${t.adminCategories.moveDown}: ${locale === 'en' ? c.nameEn : c.nameDe}`} onClick={() => void move(c, 1)}>↓</Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Card>

      {canAdd && (
        <Card title={t.adminCategories.adding}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t.adminCategories.slug} value={draft.slug} hint={t.adminCategories.slugHint} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
            <Field label={t.adminCategories.nameDe} value={draft.nameDe} maxLength={80} onChange={(e) => setDraft({ ...draft, nameDe: e.target.value })} />
            <Field label={t.adminCategories.nameEn} value={draft.nameEn} maxLength={80} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} />
          </div>
          <div className="mt-4"><Button loading={adding} disabled={!valid} onClick={() => void add()}>{t.adminCategories.add}</Button></div>
        </Card>
      )}
    </div>
  )
}

export default OfferCategories

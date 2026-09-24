import { del } from '../../lib/api'
import Button from '../../components/ui/Button'
import { useTranslations } from '../../i18n/index'
import { AuthorList } from '../threads/PostView'

/** Who you blocked and muted, with undo (US8). */
export function Privacy() {
  const t = useTranslations()
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <AuthorList url="/threads/blocks" title={t.memberProfile.blockedList} empty={t.memberProfile.noneBlocked}
        action={(author, drop) => (
          <Button variant="secondary" onClick={() => void del(`/threads/blocks/${author.id}`).then(drop)}>{t.memberProfile.unblock}</Button>
        )} />
      <AuthorList url="/threads/mutes" title={t.memberProfile.mutedList} empty={t.memberProfile.noneMuted}
        action={(author, drop) => (
          <Button variant="secondary" onClick={() => void del(`/threads/mutes/${author.id}`).then(drop)}>{t.memberProfile.unmute}</Button>
        )} />
    </div>
  )
}

export default Privacy

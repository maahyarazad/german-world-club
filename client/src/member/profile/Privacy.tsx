import { Link } from 'react-router'
import { del } from '../../lib/api'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import { useTranslations } from '../../i18n/index'
import { AuthorList } from '../threads/PostView'
import AsyncButton from '../../components/ui/AsyncButton'

/** Who you blocked and muted, with undo (US8). */
export function Privacy() {
  const t = useTranslations()
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <PageHeader title={t.memberProfile.privacy} actions={<Link to="/konsole/mitglied/profil" className="text-[13px] text-navy">← {t.memberThreads.back}</Link>} />
      <AuthorList url="/threads/blocks" title={t.memberProfile.blockedList} empty={t.memberProfile.noneBlocked}
        action={(author, drop) => (
          <AsyncButton name="Privacy.unblock" variant="secondary" onAction={() => del(`/threads/blocks/${author.id}`).then(drop)}>{t.memberProfile.unblock}</AsyncButton>
        )} />
      <AuthorList url="/threads/mutes" title={t.memberProfile.mutedList} empty={t.memberProfile.noneMuted}
        action={(author, drop) => (
          <AsyncButton name="Privacy.unmute" variant="secondary" onAction={() => del(`/threads/mutes/${author.id}`).then(drop)}>{t.memberProfile.unmute}</AsyncButton>
        )} />
    </div>
  )
}

export default Privacy

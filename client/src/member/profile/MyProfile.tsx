import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { MemberProfile } from '@gwc/contracts/profile'
import { get, ApiError } from '../../lib/api'
import Callout from '../../components/ui/Callout'
import { useTranslations } from '../../i18n/index'
import ProfileHeader from './ProfileHeader'
import ProfileTabs from './ProfileTabs'
import PageLoader from '../../components/ui/PageLoader'

/** Your own profile (US3). The same header others see, plus the way to edit it. */
export function MyProfile() {
  const t = useTranslations()
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    void get('/profile/me').then((p) => setProfile(p as MemberProfile)).catch((err) => {
      console.error('MyProfile.load', err instanceof ApiError ? err.problem : err)
      setFailed(true)
    })
  }, [])
  if (failed) return <Callout variant="gold" title={t.memberThreads.loadFailed}>{null}</Callout>
  if (!profile) return <PageLoader />
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <ProfileHeader
        profile={profile}
        actions={
          <span className="flex gap-3 text-[13px]">
            <Link to="/konsole/mitglied/profil/privatsphaere" className="rounded-card border border-hairline px-3 py-1.5 font-semibold text-text hover:bg-ground">{t.memberProfile.privacy}</Link>
            <Link to="/konsole/mitglied/profil/einstellungen" className="rounded-card border border-hairline px-3 py-1.5 font-semibold text-text hover:bg-ground">{t.memberProfile.settings}</Link>
            <Link to="/konsole/mitglied/profil/bearbeiten" className="rounded-card border border-hairline px-3 py-1.5 font-semibold text-text hover:bg-ground">
              {t.memberProfile.edit}
            </Link>
          </span>
        }
      />
      <ProfileTabs memberId={profile.id} />
    </div>
  )
}

export default MyProfile

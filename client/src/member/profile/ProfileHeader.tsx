import { Link } from 'react-router'
import type { ProfileLink } from '@gwc/contracts/profile'
import type { MediaItem } from '@gwc/contracts/media'
import StatusPill from '../../components/ui/StatusPill'
import { fill, formatNumber } from '../../lib/format'
import { useLocale, useTranslations } from '../../i18n/index'
import Avatar from '../threads/Avatar'

export type HeaderProfile = {
  id: string
  displayName: string | null
  handle: string | null
  avatar: MediaItem | null
  bio: string | null
  city: string | null
  countryOfResidence: string | null
  links: ProfileLink[]
  isInfluencer: boolean
  followers: number
  following: number
}

/** A member's profile header, the same for your own and anybody else's (US3/US4). */
export function ProfileHeader({ profile, actions }: { profile: HeaderProfile; actions?: React.ReactNode }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const base = `/konsole/mitglied/mitglieder/${profile.handle ?? profile.id}`
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold text-text">{profile.displayName ?? '—'}</h1>
          <p className="flex items-center gap-2 text-[14px] text-text-muted">
            {profile.handle ? `@${profile.handle}` : t.memberProfile.noHandle}
            {profile.isInfluencer && <StatusPill tone="info">{t.memberThreads.influencer}</StatusPill>}
          </p>
        </div>
        <Avatar author={profile} size={72} alt={fill(t.memberProfile.avatarAlt, { name: profile.displayName ?? '' })} />
      </div>
      {profile.bio && <p className="whitespace-pre-wrap text-[14px] text-text">{profile.bio}</p>}
      {(profile.city || profile.countryOfResidence) && (
        <p className="text-[13px] text-text-muted">{[profile.city, profile.countryOfResidence].filter(Boolean).join(', ')}</p>
      )}
      {profile.links.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {profile.links.map((link) => (
            <li key={link.url}>
              {/* https only (enforced by the server); noopener so the target cannot reach back. */}
              <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" className="text-navy hover:underline">
                {link.label ?? link.url.replace(/^https:\/\//, '')}
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex gap-4 text-[13px] text-text-muted">
          <Link to={`${base}/follower`} className="hover:underline">
            <strong className="text-text">{formatNumber(profile.followers, locale)}</strong> {t.memberProfile.followers}
          </Link>
          <Link to={`${base}/folgt`} className="hover:underline">
            <strong className="text-text">{formatNumber(profile.following, locale)}</strong> {t.memberProfile.followingCount}
          </Link>
        </p>
        {actions}
      </div>
    </header>
  )
}

export default ProfileHeader

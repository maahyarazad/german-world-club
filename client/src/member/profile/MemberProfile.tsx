import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import type { PublicMemberProfile } from '@gwc/contracts/profile'
import { del, get, put, ApiError } from '../../lib/api'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import { fill } from '../../lib/format'
import { useTranslations } from '../../i18n/index'
import ProfileHeader from './ProfileHeader'
import ProfileTabs from './ProfileTabs'
import { AuthorList } from '../threads/PostView'
import PageLoader from '../../components/ui/PageLoader'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `mitglieder/:ref` — a uuid or a handle; both resolve to the same profile on the server. */
function useProfile(ref: string | undefined) {
  const [profile, setProfile] = useState<PublicMemberProfile | null>(null)
  const [missing, setMissing] = useState(false)
  const load = useCallback(async () => {
    if (!ref) return
    const url = UUID.test(ref) ? `/profile/members/${ref}` : `/profile/handles/${encodeURIComponent(ref)}`
    try { setProfile((await get(url)) as PublicMemberProfile); setMissing(false) } catch (err) {
      console.error('useProfile.load', err instanceof ApiError ? err.problem : err)
      setMissing(true)
    }
  }, [ref])
  useEffect(() => { void load() }, [load])
  return { profile, missing, reload: load }
}

/**
 * Another member's profile (US4), with follow, mute and block (US8).
 *
 * A member who blocked you, a locked one and one who never existed are the
 * same 404 from the server, and the same "not available" here. Somebody YOU
 * blocked still opens — that is where you unblock them — but their posts do
 * not.
 */
export function MemberProfile() {
  const t = useTranslations()
  const { ref } = useParams()
  const { profile, missing, reload } = useProfile(ref)
  // Which action is running, so only that button shows the loader (feature 030).
  const [busy, setBusy] = useState<'follow' | 'mute' | 'block' | null>(null)

  if (missing) return <Callout variant="neutral" title={t.memberProfile.notFound}>{null}</Callout>
  if (!profile) return <PageLoader />

  const act = async (which: 'follow' | 'mute' | 'block', fn: () => Promise<unknown>) => {
    setBusy(which)
    try { await fn(); await reload() } finally { setBusy(null) }
  }

  const actions = profile.isSelf ? null : (
    <span className="flex flex-wrap gap-2">
      {!profile.isBlocked && (
        <Button disabled={busy !== null} loading={busy === 'follow'} variant={profile.isFollowing ? 'secondary' : 'primary'}
          onClick={() => act('follow', () => (profile.isFollowing ? del(`/threads/follows/${profile.id}`) : put(`/threads/follows/${profile.id}`)))}>
          {profile.isFollowing ? t.memberProfile.unfollow : t.memberProfile.follow}
        </Button>
      )}
      <Button disabled={busy !== null} loading={busy === 'mute'} variant="quiet"
        onClick={() => act('mute', () => (profile.isMuted ? del(`/threads/mutes/${profile.id}`) : put(`/threads/mutes/${profile.id}`)))}>
        {profile.isMuted ? t.memberProfile.unmute : t.memberProfile.mute}
      </Button>
      <Button disabled={busy !== null} loading={busy === 'block'} variant="quiet"
        onClick={() => {
          if (!profile.isBlocked && !window.confirm(t.memberProfile.blockConfirm)) return
          void act('block', () => (profile.isBlocked ? del(`/threads/blocks/${profile.id}`) : put(`/threads/blocks/${profile.id}`)))
        }}>
        {profile.isBlocked ? t.memberProfile.unblock : t.memberProfile.block}
      </Button>
    </span>
  )

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <ProfileHeader profile={profile} actions={actions} />
      {profile.isBlocked
        ? <Callout variant="neutral" title={t.memberProfile.blocked}>{null}</Callout>
        : <ProfileTabs memberId={profile.id} />}
    </div>
  )
}

/** `mitglieder/:ref/follower` and `…/folgt` (US4). */
export function FollowList({ direction }: { direction: 'followers' | 'following' }) {
  const t = useTranslations()
  const { ref } = useParams()
  const { profile, missing } = useProfile(ref)
  if (missing) return <Callout variant="neutral" title={t.memberProfile.notFound}>{null}</Callout>
  if (!profile) return <PageLoader />
  const name = profile.displayName ?? `@${profile.handle ?? ''}`
  return (
    <div className="mx-auto w-full max-w-2xl">
      <AuthorList
        url={`/threads/members/${profile.id}/${direction}`}
        title={fill(direction === 'followers' ? t.memberProfile.followersTitle : t.memberProfile.followingTitle, { name })}
        empty={t.memberThreads.empty}
      />
    </div>
  )
}

export default MemberProfile

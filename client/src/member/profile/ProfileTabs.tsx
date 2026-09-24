import { useState } from 'react'
import { PROFILE_TABS } from '@gwc/contracts/threads'
import type { ProfileTab, ThreadPost } from '@gwc/contracts/threads'
import { useTranslations } from '../../i18n/index'
import { usePaged } from '../threads/usePaged'
import PostList from '../threads/PostList'

/** A member's posts in Threads' four tabs (US3, FR-008). */
export function ProfileTabs({ memberId }: { memberId: string }) {
  const t = useTranslations()
  const [tab, setTab] = useState<ProfileTab>('threads')
  const list = usePaged<ThreadPost>(`/threads/members/${memberId}/posts?tab=${tab}`)
  return (
    <section className="flex flex-col">
      <div role="tablist" className="flex border-b border-hairline">
        {PROFILE_TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`flex-1 border-b-2 py-2.5 text-[13px] font-semibold ${tab === value ? 'border-navy text-text' : 'border-transparent text-text-muted'}`}
          >
            {t.memberProfile.tabs[value]}
          </button>
        ))}
      </div>
      <PostList
        entries={list.items.map((post) => ({ post, key: post.id }))}
        loading={list.loading} failed={list.failed} hasMore={list.hasMore} onMore={list.more} onRetry={list.reload}
        empty={t.memberThreads.empty}
        onUpdate={(post) => list.setItems((items) => items.map((p) => (p.id === post.id ? post : p)))}
        onRemove={(id) => list.setItems((items) => items.filter((p) => p.id !== id))}
      />
    </section>
  )
}

export default ProfileTabs

import { Link } from 'react-router'
import type { ThreadAuthor } from '@gwc/contracts/threads'
import StatusPill from '../../components/ui/StatusPill'
import { useTranslations } from '../../i18n/index'

/** Where a member's profile lives in the web member area. By handle when they have one. */
export const profilePath = (author: Pick<ThreadAuthor, 'id' | 'handle'>) =>
  `/konsole/mitglied/mitglieder/${author.handle ?? author.id}`

/** Name, @handle and the influencer badge, linking to the profile. */
export function AuthorLine({ author, children }: { author: ThreadAuthor; children?: React.ReactNode }) {
  const t = useTranslations()
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px]">
      <Link to={profilePath(author)} className="truncate font-semibold text-text hover:underline">
        {author.displayName ?? (author.handle ? `@${author.handle}` : '—')}
      </Link>
      {author.handle && <span className="truncate text-text-muted">@{author.handle}</span>}
      {author.isInfluencer && <StatusPill tone="info">{t.memberThreads.influencer}</StatusPill>}
      {children}
    </span>
  )
}

export default AuthorLine

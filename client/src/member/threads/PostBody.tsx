import { Fragment } from 'react'
import { Link } from 'react-router'
import { MENTION_PATTERN } from '@gwc/contracts/threads'

/**
 * A post's text with its mentions linked (US5, FR-006).
 *
 * The client does NOT decide who was mentioned. It finds `@…` spans only to
 * match them against `mentions`, the list the server resolved at post time; a
 * span with no entry is plain text — it named nobody, or somebody this viewer
 * cannot see. The body is immutable, so a span still reads as it was written
 * even after the member renamed themselves; the link follows the member.
 */
export function PostBody({ body, mentions }: { body: string; mentions: readonly { memberId: string; handle: string }[] }) {
  if (!body) return null
  const byHandle = new Map(mentions.map((m) => [m.handle.toLowerCase(), m.memberId]))
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of body.matchAll(new RegExp(MENTION_PATTERN.source, 'g'))) {
    const handle = match[1]!.replace(/\.+$/, '')
    const memberId = byHandle.get(handle.toLowerCase())
    if (!memberId) continue
    const start = match.index!
    parts.push(body.slice(last, start))
    parts.push(
      <Link key={start} to={`/konsole/mitglied/mitglieder/${memberId}`} className="text-navy hover:underline">
        @{handle}
      </Link>,
    )
    last = start + 1 + handle.length
  }
  parts.push(body.slice(last))
  return (
    <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text">
      {parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)}
    </p>
  )
}

export default PostBody

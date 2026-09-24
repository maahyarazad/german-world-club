import { THREAD_MENTIONS_MAX } from '@gwc/contracts/threads'
import { visibleMemberAs, notBlockedBetween } from '../../profile/application/profile.ts'

/**
 * @mentions (feature 010, research R7).
 *
 * Parsed and resolved on the server, at post time, into rows naming the
 * MEMBER. A client never decides who was mentioned: it links the spans the
 * server returns. Keying by member is what lets a mention survive the
 * mentioned member changing their handle; the body is immutable, so the text
 * keeps the handle as it was written.
 */

/**
 * `@` preceded by nothing that could make it part of a word or an address —
 * so `anna@example.org` is not a mention of `example.org`. The capture is the
 * widest a handle can be; resolution decides whether it names anybody.
 */
const MENTION = /(?<![A-Za-z0-9_.@])@([A-Za-z0-9._]{3,30})/g

/**
 * The first `THREAD_MENTIONS_MAX` distinct handles, in order, lowercased.
 *
 * The bound caps the fan-out a single post can cause in other members'
 * Activity; the text itself is never truncated. A trailing dot is sentence
 * punctuation ("thanks @anna."), never part of a handle — the handle format
 * forbids it — so it is dropped before matching.
 */
export function parseMentions(body: string): string[] {
  const seen = new Set<string>()
  for (const match of body.matchAll(MENTION)) {
    const handle = match[1]!.replace(/\.+$/, '').toLowerCase()
    if (handle.length < 3 || seen.has(handle)) continue
    seen.add(handle)
    if (seen.size === THREAD_MENTIONS_MAX) break
  }
  return [...seen]
}

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }

/**
 * Handles → members, keeping only members the author could see: active,
 * approved, and with no block between them in either direction. A mention of
 * somebody who blocked you notifies nobody and is recorded nowhere — otherwise
 * mentioning would be a way around the block. Self-mentions are dropped: they
 * would only put your own post in your own Activity.
 */
export async function resolveMentions(
  db: Queryable,
  { authorId, handles }: { authorId: string; handles: readonly string[] },
): Promise<{ memberId: string; handleAsWritten: string }[]> {
  if (handles.length === 0) return []
  const { rows } = await db.query(
    `SELECT m.id, m.handle
       FROM members m
      WHERE m.handle = ANY($2::citext[]) AND m.id <> $1
        AND ${visibleMemberAs('m')} AND ${notBlockedBetween('$1', 'm.id')}`,
    [authorId, handles],
  )
  const byHandle = new Map(rows.map((r) => [String(r.handle).toLowerCase(), String(r.id)]))
  return handles.flatMap((handle) => {
    const memberId = byHandle.get(handle)
    return memberId ? [{ memberId, handleAsWritten: handle }] : []
  })
}

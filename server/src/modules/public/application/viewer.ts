import { query } from '../../../db/query.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Who the landing page is rendered for (feature 022, research R2).
 *
 * A name, initials, and — for a member who has one — the avatar's smallest
 * usable derivative: the same URL the console shows, never the original
 * upload. Nothing else about the person reaches the page. Derived per request
 * and never stored.
 */
export type Viewer = {
  name: string
  initials: string
  avatar: { url: string; width: number; height: number } | null
}

/** The masthead circle is 40 CSS px; 64 covers a 1.5× screen without fetching a hero. */
const AVATAR_MIN_WIDTH = 64

const NAME_SQL: Readonly<Record<string, string>> = Object.freeze({
  member: 'SELECT display_name FROM members WHERE id = $1',
  admin: 'SELECT display_name FROM admin_users WHERE id = $1',
  merchant: 'SELECT display_name FROM organisation_users WHERE id = $1',
  partner: 'SELECT display_name FROM organisation_users WHERE id = $1',
})

/** Up to two initials from the name's first words; `?` when there is no name. */
export function initialsOf(name: string | null | undefined): string {
  const letters = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => /\p{L}|\p{N}/u.test(word))
    .slice(0, 2)
    .map((word) => [...word.replace(/^[^\p{L}\p{N}]+/u, '')][0] ?? '')
    .join('')
    .toLocaleUpperCase()
  return letters || '?'
}

export async function loadViewer(
  app: GwcApp,
  principal: { id: string; kind: string },
  { signal }: { signal?: AbortSignal } = {},
): Promise<Viewer | null> {
  const sql = NAME_SQL[principal.kind]
  if (!sql) return null
  const { rows } = await query(app.pg, sql, [principal.id], { signal })
  if (rows.length === 0) return null
  const name = String(rows[0]?.display_name ?? '').trim()

  let avatar: Viewer['avatar'] = null
  if (principal.kind === 'member') {
    const { rows: avatars } = await query(
      app.pg,
      'SELECT asset_id FROM member_avatars WHERE member_id = $1',
      [principal.id],
      { signal },
    )
    const assetId = avatars[0]?.asset_id ? String(avatars[0].asset_id) : null
    if (assetId) {
      const item = (await loadMediaItems(app.pg, [assetId])).get(assetId)
      // Still images only, and webp first: every browser that renders this
      // page decodes it, and it is the lightest of the three.
      const rank = (format: string) => ['webp', 'jpeg', 'png'].indexOf(format)
      const variants = [...(item?.variants ?? [])]
        .filter((v) => rank(v.format) >= 0)
        .sort((a, b) => a.width - b.width || rank(a.format) - rank(b.format))
      const chosen = variants.find((v) => v.width >= AVATAR_MIN_WIDTH) ?? variants[0]
      if (chosen) avatar = { url: chosen.url, width: chosen.width, height: chosen.height }
    }
  }

  return { name, initials: initialsOf(name), avatar }
}

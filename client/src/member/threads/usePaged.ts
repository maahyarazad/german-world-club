import { useCallback, useEffect, useRef, useState } from 'react'
import { get } from '../../lib/api'

/**
 * Keyset pagination against a Threads list endpoint: `{ items, nextCursor }`.
 *
 * The cursor is opaque — the server encodes it and a client only hands it
 * back. `reload` starts over (after posting, or switching a tab); `more`
 * appends the next page. A response that arrives for a URL no longer shown is
 * dropped, so switching tabs quickly cannot mix two lists.
 */
export function usePaged<T>(url: string | null) {
  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const current = useRef(url)

  const load = useCallback(async (from: string | null, append: boolean) => {
    if (!url) return
    setLoading(true)
    setFailed(false)
    try {
      const sep = url.includes('?') ? '&' : '?'
      const page = (await get(from ? `${url}${sep}cursor=${encodeURIComponent(from)}` : url)) as { items: T[]; nextCursor: string | null }
      if (current.current !== url) return
      setItems((prev) => (append ? [...prev, ...page.items] : page.items))
      setCursor(page.nextCursor)
    } catch {
      if (current.current === url) setFailed(true)
    } finally {
      if (current.current === url) setLoading(false)
    }
  }, [url])

  useEffect(() => {
    current.current = url
    setItems([])
    setCursor(null)
    void load(null, false)
  }, [url, load])

  return {
    items,
    setItems,
    loading,
    failed,
    hasMore: cursor !== null,
    more: () => load(cursor, true),
    reload: () => load(null, false),
  }
}

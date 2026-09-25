import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';

type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * A cursor-paged list: first load, pull-to-refresh, load-more.
 *
 * The server pages by keyset and hands back an opaque cursor; this never
 * builds one. `deps` restart the list from the top (a changed filter).
 */
export function usePaged<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadingMore = useRef(false);
  // Ignore answers to a request superseded by a newer reload.
  const generation = useRef(0);

  const reload = useCallback(async (asRefresh = false) => {
    const mine = ++generation.current;
    asRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const page = await fetchPage(null);
      if (mine !== generation.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (e) {
      console.error('usePaged.reload', e instanceof ApiError ? e.problem : e);
    } finally {
      if (mine === generation.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void reload(); }, [reload]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    const mine = generation.current;
    try {
      const page = await fetchPage(cursor);
      if (mine !== generation.current) return;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      console.error('usePaged.loadMore', e instanceof ApiError ? e.problem : e);
    } finally {
      loadingMore.current = false;
    }
  }, [cursor, fetchPage]);

  return { items, setItems, loading, refreshing, reload, loadMore };
}

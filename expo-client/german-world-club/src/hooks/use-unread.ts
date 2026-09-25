import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { threadsApi } from '@/api/endpoints';
import { ApiError } from '@/api/client';

/**
 * The Activity badge (010 US5). Polled while the app is in the foreground and
 * refreshed whenever it returns there: delivery is on read in 010, with no
 * push and no socket to be told by (research R8).
 */
export const UNREAD_POLL_MS = 60_000;

const listeners = new Set<(n: number) => void>();
/** Lets the Activity screen clear the badge the moment it marks items seen. */
export const publishUnread = (n: number) => listeners.forEach((l) => l(n));

export function useUnread() {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(() => {
    if (AppState.currentState !== 'active') return;
    threadsApi.unread().then((r) => setUnread(r.unread)).catch((e) => { console.error('useUnread.refresh', e instanceof ApiError ? e.problem : e); });
  }, []);
  useEffect(() => {
    refresh();
    listeners.add(setUnread);
    const timer = setInterval(refresh, UNREAD_POLL_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); sub.remove(); listeners.delete(setUnread); };
  }, [refresh]);
  return unread;
}

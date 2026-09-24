import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { useSession } from '@/session/session';

import { toHref } from './routes';

/**
 * Opens the screen a tapped notification points at (feature 011, US2,
 * research R10). Mounted once, beside the root stack, so it survives the route
 * groups switching underneath it.
 *
 *  - A cold start is `useLastNotificationResponse()`; a tap while the app runs
 *    is the response listener. Both feed one handler, deduplicated by the
 *    notification's identifier, so the same tap is never followed twice.
 *  - Nothing happens while the stored session is still loading.
 *  - Signed out, still an applicant, or an organisation login: the destination
 *    is held and replayed once the session becomes `member` (FR-011), then
 *    dropped.
 *  - `router.push` onto the tab that owns the screen, so Back returns to that
 *    tab's root (FR-009). An unknown type, `none` or `article` navigates
 *    nowhere (FR-010).
 */
export function NotificationRouter() {
  const { state } = useSession();
  const handled = useRef(new Set<string>());
  const held = useRef<Record<string, unknown> | null>(null);
  const status = state.status;
  const statusRef = useRef(status);
  statusRef.current = status;

  const go = useCallback((data: Record<string, unknown>) => {
    const href = toHref(data);
    if (!href) return;
    if (statusRef.current !== 'member') {
      held.current = data;
      return;
    }
    held.current = null;
    router.push(href);
  }, []);

  const take = useCallback((response: Notifications.NotificationResponse | null | undefined) => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
    const key = typeof data.nid === 'string' && data.nid ? data.nid : response.notification.request.identifier;
    if (handled.current.has(key)) return;
    handled.current.add(key);
    go(data);
  }, [go]);

  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (status === 'loading') return;
    take(last);
  }, [last, status, take]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(take);
    return () => subscription.remove();
  }, [take]);

  // Replay a held destination once the member is in.
  useEffect(() => {
    if (status === 'member' && held.current) go(held.current);
  }, [status, go]);

  return null;
}

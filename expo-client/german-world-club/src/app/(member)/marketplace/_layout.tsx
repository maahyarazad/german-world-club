import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { renderAppHeader } from '@/components/app-header';
import { useTranslations } from '@/i18n';

/**
 * How a screen opens in this stack (feature 039): the platform's own "open a screen"
 * transition, which is what Settings does on each.
 *   - iOS: `default` is the navigation controller's push, the new screen sliding in from
 *     the right while the old one shifts a little left.
 *   - Android 13 and later: `default` is the system's transition, react-native-screens'
 *     `rns_default_enter_in` for API 33: a 10% slide in from the right with a short fade,
 *     the old screen shifting 10% left (Material's shared axis, X).
 *   - Android 12 and earlier: `default` is a zoom (0.85 to 1), which is not a horizontal
 *     move, so those get `slide_from_right`, the nearest horizontal one. It slides the
 *     whole width and does not fade, which is why it is not used where `default` is right.
 * No screen sets its own: a screen that did would open differently from the rest.
 */
const PUSH_ANIMATION = Platform.OS === 'android' && Number(Platform.Version) < 33 ? 'slide_from_right' : 'default';

export default function MarketplaceLayout() {
  const { t } = useTranslations();
  // Every screen in every tab's stack gets the same header (feature 039): its title on the
  // left and the club's emblem in the middle, with whatever the screen puts in
  // `headerRight` on the right. The titles below are what it shows.
  return (
    <Stack screenOptions={{ header: renderAppHeader, animation: PUSH_ANIMATION }}>
      <Stack.Screen name="index" options={{ title: t.marketplace.title }} />
      <Stack.Screen name="listing/[id]" options={{ title: '' }} />
      {/* Feature 017: pushed cards that enter from the right, not modals, which would rise
          from the bottom (`PUSH_ANIMATION`, above). Back, the edge swipe and hardware
          back close them. */}
      {/* Feature 020: a request about a listing, and the conversations they start.
          Inside the marketplace stack because the five bottom-bar slots are full. */}
      <Stack.Screen name="request/[id]" options={{ title: t.requests.title }} />
      <Stack.Screen name="messages/index" options={{ title: t.messages.title }} />
      <Stack.Screen name="messages/[id]" options={{ title: '' }} />
      {/* Feature 037: your own listings, and editing one. Opens like every other screen here. */}
      <Stack.Screen name="mine" options={{ title: t.marketplace.myListings }} />
      <Stack.Screen name="edit/[id]" options={{ title: t.marketplace.editTitle, presentation: 'card' }} />
      <Stack.Screen name="new" options={{ title: t.marketplace.composeTitle, presentation: 'card' }} />
    </Stack>
  );
}

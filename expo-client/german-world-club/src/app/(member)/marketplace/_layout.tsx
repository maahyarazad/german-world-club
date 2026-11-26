import { Stack } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTranslations } from '@/i18n';

/**
 * A header title 20% smaller than the platform default, for the Requests,
 * Messages and My listings screens. The default is 17 pt on iOS and 20 sp on
 * Android, so the sizes are written out (13.6 and 16).
 *
 * Drawn by us through `headerTitle`, the documented way to customise a header
 * title, instead of `headerTitleStyle.fontSize`: the native header applies that
 * option itself and it did not take effect here. The text is still the screen's
 * own `title` option, passed in as `children`, so translating a title stays in
 * one place.
 */
function SmallTitle({ children }: { children: string }) {
  return <ThemedText style={styles.smallTitle} numberOfLines={1}>{children}</ThemedText>;
}
// Defined once at module level so React sees the same component on every render.
const renderSmallTitle = (props: { children: string }) => <SmallTitle {...props} />;
const smallTitle = { headerTitle: renderSmallTitle };

const styles = StyleSheet.create({
  smallTitle: { fontSize: Platform.select({ ios: 13.6, default: 16 }), fontWeight: '600' },
});

export default function MarketplaceLayout() {
  const { t } = useTranslations();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ title: t.marketplace.title }} />
      <Stack.Screen name="listing/[id]" options={{ title: '' }} />
      {/* "Slides in from the right" (feature 017): a pushed card, not a modal,
          which would rise from the bottom. On iOS `slide_from_right` falls back
          to the default push — which already enters from the right; the value
          is there for Android. Back, the edge swipe and hardware back close it. */}
      {/* Feature 020: a request about a listing, and the conversations they start.
          Inside the marketplace stack because the five bottom-bar slots are full. */}
      <Stack.Screen name="request/[id]" options={{ title: t.requests.title, ...smallTitle }} />
      <Stack.Screen name="messages/index" options={{ title: t.messages.title, ...smallTitle }} />
      <Stack.Screen name="messages/[id]" options={{ title: '' }} />
      {/* Feature 037: your own listings, and editing one. Same slide-in as a new listing. */}
      <Stack.Screen name="mine" options={{ title: t.marketplace.myListings, ...smallTitle }} />
      <Stack.Screen name="edit/[id]" options={{ title: t.marketplace.editTitle, presentation: 'card', animation: 'slide_from_right' }} />
      <Stack.Screen name="new" options={{ title: t.marketplace.composeTitle, presentation: 'card', animation: 'slide_from_right' }} />
    </Stack>
  );
}

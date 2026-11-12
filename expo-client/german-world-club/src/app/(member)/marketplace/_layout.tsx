import { Stack } from 'expo-router';

import { useTranslations } from '@/i18n';

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
      <Stack.Screen name="request/[id]" options={{ title: t.requests.title }} />
      <Stack.Screen name="messages/index" options={{ title: t.messages.title }} />
      <Stack.Screen name="messages/[id]" options={{ title: '' }} />
      <Stack.Screen name="new" options={{ title: t.marketplace.composeTitle, presentation: 'card', animation: 'slide_from_right' }} />
    </Stack>
  );
}

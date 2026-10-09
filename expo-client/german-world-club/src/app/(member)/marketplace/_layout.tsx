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
      <Stack.Screen name="new" options={{ title: t.marketplace.composeTitle, presentation: 'card', animation: 'slide_from_right' }} />
    </Stack>
  );
}

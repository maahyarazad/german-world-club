import { Stack } from 'expo-router';

import { useTranslations } from '@/i18n';

export default function EventsLayout() {
  const { t } = useTranslations();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ title: t.tabs.events }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}

import { Stack } from 'expo-router';

import { renderAppHeader } from '@/components/app-header';
import { useTranslations } from '@/i18n';

export default function EventsLayout() {
  const { t } = useTranslations();
  return (
    <Stack screenOptions={{ header: renderAppHeader }}>
      <Stack.Screen name="index" options={{ title: t.tabs.events }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}

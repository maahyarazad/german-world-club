import { Stack } from 'expo-router';

import { useTranslations } from '@/i18n';

export default function ThreadsLayout() {
  const { t } = useTranslations();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ title: t.tabs.threads }} />
      <Stack.Screen name="[id]" options={{ title: t.threads.thread }} />
      <Stack.Screen name="member/[id]" options={{ title: '' }} />
      <Stack.Screen name="compose" options={{ presentation: 'modal', title: t.threads.compose }} />
    </Stack>
  );
}

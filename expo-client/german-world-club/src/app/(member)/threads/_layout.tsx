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
      <Stack.Screen name="handle" options={{ presentation: 'modal', title: t.profile.handleTitle }} />
      <Stack.Screen name="people/[id]" options={{ title: '' }} />
      <Stack.Screen name="quotes/[id]" options={{ title: t.threads.quotes }} />
      <Stack.Screen name="organisation/[slug]" options={{ title: '' }} />
    </Stack>
  );
}

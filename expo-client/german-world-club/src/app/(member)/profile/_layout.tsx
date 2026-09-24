import { Stack } from 'expo-router';

import { useTranslations } from '@/i18n';

export default function ProfileLayout() {
  const { t } = useTranslations();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ title: t.profile.title }} />
      <Stack.Screen name="edit" options={{ presentation: 'modal', title: t.profile.edit }} />
      <Stack.Screen name="handle" options={{ presentation: 'modal', title: t.profile.handleTitle }} />
      <Stack.Screen name="privacy" options={{ title: t.profile.privacy }} />
      <Stack.Screen name="notifications" options={{ title: t.notifications.title }} />
    </Stack>
  );
}

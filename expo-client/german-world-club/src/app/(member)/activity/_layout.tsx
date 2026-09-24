import { Stack } from 'expo-router';

import { useTranslations } from '@/i18n';

export default function ActivityLayout() {
  const { t } = useTranslations();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ title: t.activity.title }} />
      {/* Where offer and listing notifications land (feature 011, research
          R10): "things that happened to me" is the Activity tab, and native
          tabs cannot hold screens that are not tabs. */}
      <Stack.Screen name="offer/[id]" options={{ title: '' }} />
      <Stack.Screen name="listing/[id]" options={{ title: '' }} />
    </Stack>
  );
}

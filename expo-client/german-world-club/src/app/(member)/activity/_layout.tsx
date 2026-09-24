import { Stack } from 'expo-router';

import { useTranslations } from '@/i18n';

export default function ActivityLayout() {
  const { t } = useTranslations();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t.activity.title }} />
    </Stack>
  );
}

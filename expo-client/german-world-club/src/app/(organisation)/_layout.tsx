import { Stack } from 'expo-router';

import { useTranslations } from '@/i18n';

/**
 * A merchant or partner (§5): a commercial counterparty, not a member, so none
 * of the member tabs. Their profile is what Phase 1 gives them here; offers
 * and redemptions arrive with Phase 2's Benefits.
 */
export default function OrganisationLayout() {
  const { t } = useTranslations();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t.profile.organisation }} />
    </Stack>
  );
}

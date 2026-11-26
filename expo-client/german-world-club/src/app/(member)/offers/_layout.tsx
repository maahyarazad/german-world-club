import { Stack } from 'expo-router';

import { renderAppHeader } from '@/components/app-header';
import { useTranslations } from '@/i18n';

/**
 * The Offers tab (feature 035 follow-up): merchant offers by category, one offer,
 * what this member redeemed, and the store behind an offer. It replaced the
 * Activity tab, which now lives under Profile. An offer notification lands on
 * `[id]` (`DESTINATION_ROUTES` in @gwc/contracts/push).
 */
export default function OffersLayout() {
  const { t } = useTranslations();
  return (
    <Stack screenOptions={{ header: renderAppHeader }}>
      <Stack.Screen name="index" options={{ title: t.clubOffers.title }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
      <Stack.Screen name="redemptions" options={{ title: t.clubOffers.myRedemptions }} />
      <Stack.Screen name="store/[slug]" options={{ title: '' }} />
    </Stack>
  );
}

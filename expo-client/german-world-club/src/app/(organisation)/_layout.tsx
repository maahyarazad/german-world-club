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
      <Stack.Screen name="public-profile" options={{ title: t.profile.publicProfile }} />
      <Stack.Screen name="referrals" options={{ title: t.referrals.title }} />
      {/* Merchant offers (feature 035): any account may redeem them, and a
          merchant keeps a store, offers and a report. A partner has no store. */}
      <Stack.Screen name="club-offers" options={{ title: t.clubOffers.title }} />
      <Stack.Screen name="club-offer/[id]" options={{ title: '' }} />
      <Stack.Screen name="club-redemptions" options={{ title: t.clubOffers.myRedemptions }} />
      <Stack.Screen name="store" options={{ title: t.merchant.storeEntry }} />
      <Stack.Screen name="my-offers" options={{ title: t.merchant.offers.title }} />
      <Stack.Screen name="my-offer/[id]" options={{ title: t.merchant.offers.edit }} />
      <Stack.Screen name="report" options={{ title: t.merchant.report.title }} />
    </Stack>
  );
}

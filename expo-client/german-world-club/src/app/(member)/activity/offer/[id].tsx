import { Stack, useLocalSearchParams } from 'expo-router';

import { ClubOfferDetail } from '@/components/club-offers';

/**
 * One merchant offer — where an offer notification lands (feature 011), and
 * where a tap on the list lands (feature 035). It shows the offer and lets an
 * active member redeem it; the server answers 404 for anything not visible, and
 * that is shown as "no longer available", the same state an event that has gone
 * away shows.
 */
export default function OfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ClubOfferDetail kind="member" id={id} />
    </>
  );
}

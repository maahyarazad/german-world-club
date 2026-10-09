import { Stack, useLocalSearchParams } from 'expo-router';

import { ListingDetail } from '@/components/listing-detail';

/** A listing opened from the Marketplace tab (feature 017). */
export default function MarketplaceListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ListingDetail id={id} />
    </>
  );
}

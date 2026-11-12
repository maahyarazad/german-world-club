import { Stack, useLocalSearchParams } from 'expo-router';

import { ListingDetail } from '@/components/listing-detail';

/**
 * Where a listing notification lands (feature 011, US2). The same detail the
 * Marketplace tab opens (feature 017); the component is shared because native
 * tabs cannot hold one screen in two stacks.
 */
export default function ActivityListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ListingDetail id={id} />
    </>
  );
}

import { useLocalSearchParams } from 'expo-router';

import { ClubStoreProfile } from '@/components/club-offers';

/** The store behind an offer: wide cover, description, opening hours and gallery. */
export default function StoreScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <ClubStoreProfile kind="member" slug={slug} />;
}

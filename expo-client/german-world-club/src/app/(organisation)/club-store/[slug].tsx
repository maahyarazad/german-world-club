import { Redirect, useLocalSearchParams } from 'expo-router';

import { ClubStoreProfile } from '@/components/club-offers';
import { useSession } from '@/session/session';

/** The store behind a club offer, as a merchant or partner user sees it. */
export default function ClubStore() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { state } = useSession();
  if (state.status !== 'organisation') return <Redirect href="/" />;
  return <ClubStoreProfile kind={state.principal.kind as 'merchant' | 'partner'} slug={slug} />;
}

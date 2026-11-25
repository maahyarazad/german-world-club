import { Redirect, useLocalSearchParams } from 'expo-router';

import { ClubOfferDetail } from '@/components/club-offers';
import { useSession } from '@/session/session';

/** One merchant offer, with Redeem. A merchant cannot redeem its own organisation's offers; the server says so (feature 035). */
export default function ClubOffer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useSession();
  if (state.status !== 'organisation') return <Redirect href="/" />;
  return <ClubOfferDetail kind={state.principal.kind as 'merchant' | 'partner'} id={id} storePath="/club-store/[slug]" />;
}

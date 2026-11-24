import { Redirect } from 'expo-router';

import { ClubRedemptions } from '@/components/club-offers';
import { useSession } from '@/session/session';

/** What this merchant or partner user has redeemed themselves (feature 035). */
export default function ClubRedemptionsScreen() {
  const { state } = useSession();
  if (state.status !== 'organisation') return <Redirect href="/" />;
  return <ClubRedemptions kind={state.principal.kind as 'merchant' | 'partner'} />;
}

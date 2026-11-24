import { Redirect } from 'expo-router';

import { ClubOffersList } from '@/components/club-offers';
import { useSession } from '@/session/session';

/** Merchant offers, for a merchant or partner user — any active account may redeem (feature 035). */
export default function ClubOffers() {
  const { state } = useSession();
  if (state.status !== 'organisation') return <Redirect href="/" />;
  return (
    <ClubOffersList
      kind={state.principal.kind as 'merchant' | 'partner'}
      detailPath="/club-offer/[id]"
      redemptionsPath="/club-redemptions"
    />
  );
}

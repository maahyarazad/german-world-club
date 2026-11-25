import { ClubOffersList } from '@/components/club-offers';

/** Merchant offers, by category (feature 035). The Offers tab's first screen. */
export default function Offers() {
  return <ClubOffersList kind="member" detailPath="/offers/[id]" redemptionsPath="/offers/redemptions" />;
}

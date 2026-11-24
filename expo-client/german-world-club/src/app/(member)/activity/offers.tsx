import { ClubOffersList } from '@/components/club-offers';

/** Merchant offers, by category (feature 035). */
export default function Offers() {
  return <ClubOffersList kind="member" detailPath="/activity/offer/[id]" redemptionsPath="/activity/redemptions" />;
}

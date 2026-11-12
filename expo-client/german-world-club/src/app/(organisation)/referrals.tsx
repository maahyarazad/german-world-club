import { ReferralsView } from '@/components/referrals-view';
import { Loading } from '@/components/ui';
import { useSession } from '@/session/session';

/**
 * Refer & earn for a merchant or partner user (feature 018). Their own XP, on
 * their own mount: the session says which kind they are, and a token for one
 * kind is refused on the other's mount anyway.
 */
export default function OrganisationReferrals() {
  const { state } = useSession();
  if (state.status !== 'organisation') return <Loading />;
  const kind = state.principal.kind as 'merchant' | 'partner';
  return <ReferralsView prefix={`/referrals/${kind}`} />;
}

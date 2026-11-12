import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { Loading } from '@/components/ui';
import { useRegistrationDraft } from '@/session/registration-draft';
import { useSession } from '@/session/session';

/**
 * A tapped referral link (feature 018, research R9): https://<host>/r/<code>
 * through iOS universal links / Android App Links, or germanworldclub://r/<code>
 * from the landing page's "Open in the app" button. Both arrive here.
 *
 * Signed out, the code goes into the registration draft and the person lands
 * on Register with it filled in. Signed in — anybody with an account — the code
 * is dropped: an existing account cannot be referred, and the server would
 * ignore it anyway. Nothing here decides whether the code is valid; the server
 * does, silently (FR-006).
 */
export default function ReferralLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { state } = useSession();
  const { update } = useRegistrationDraft();
  const signedOut = state.status === 'signedOut';

  useEffect(() => {
    if (signedOut && typeof code === 'string' && code) update({ referralCode: code });
    // The draft is written once per link; `update` changes identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOut, code]);

  if (state.status === 'loading') return <Loading />;
  return <Redirect href={signedOut ? '/register' : '/'} />;
}

import { Stack } from 'expo-router';

import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';

/**
 * An applicant holding a session: steps 4 and 5 of §6.1.
 *
 * Which screen is reachable follows the server's `step`, so confirming the
 * email moves the applicant to "waiting" by guard, and approval moves them out
 * of this group entirely (the root guard) without either screen navigating.
 */
export default function ApplicantLayout() {
  const { state } = useSession();
  const { t, format } = useTranslations();
  const step = state.status === 'applicant' ? state.onboarding.step : null;
  return (
    <Stack screenOptions={{ headerBackVisible: false, gestureEnabled: false }}>
      <Stack.Protected guard={step === 'verify_email'}>
        <Stack.Screen name="verify-email" options={{ title: format(t.register.stepOf, { step: 4 }) }} />
      </Stack.Protected>
      <Stack.Protected guard={step === 'awaiting_approval' || step === 'denied'}>
        <Stack.Screen name="waiting" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

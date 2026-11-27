import { Stack } from 'expo-router';

import { useTranslations } from '@/i18n';

/** Signed out: the welcome screen, sign-in, and the first three onboarding steps. */
export default function PublicLayout() {
  const { t, format } = useTranslations();
  const step = (n: number) => ({ title: format(t.register.stepOf, { step: n }) });
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: t.signIn.title }} />
      <Stack.Screen name="sign-in-code" options={{ title: t.signIn.otpTitle }} />
      {/* Feature 043: forgot password. Both are reachable signed out; the second is only ever opened by the first. */}
      <Stack.Screen name="forgot-password" options={{ title: t.passwordReset.title }} />
      <Stack.Screen name="reset-password" options={{ title: t.passwordReset.codeTitle }} />
      <Stack.Screen name="register" options={step(1)} />
      <Stack.Screen name="country" options={step(2)} />
      {/* No way back from here: the application exists once the code was sent. */}
      <Stack.Screen name="verify-mobile" options={{ ...step(3), headerBackVisible: false, gestureEnabled: false }} />
    </Stack>
  );
}

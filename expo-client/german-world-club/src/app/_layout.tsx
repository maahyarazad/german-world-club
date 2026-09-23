import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { I18nProvider } from '@/i18n';
import { RegistrationDraftProvider } from '@/session/registration-draft';
import { SessionProvider, useSession } from '@/session/session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <I18nProvider>
        <SessionProvider>
          <RegistrationDraftProvider>
            <RootStack />
          </RegistrationDraftProvider>
        </SessionProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

/**
 * Four audiences, four route groups, exactly one of them reachable at a time.
 *
 * `Stack.Protected` removes a group entirely while its guard is false and
 * redirects anybody on it, so signing out, being approved, or being denied
 * moves the member to the right place without a screen having to navigate.
 * The server re-checks every request regardless; these guards only make sure
 * nobody is shown a screen whose every request would be refused.
 */
function RootStack() {
  const { state } = useSession();

  useEffect(() => {
    if (state.status !== 'loading') SplashScreen.hideAsync();
  }, [state.status]);

  // The splash screen stays up while the stored session is checked, so the
  // welcome screen never flashes at somebody who is signed in.
  if (state.status === 'loading') return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={state.status === 'signedOut'}>
        <Stack.Screen name="(public)" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'applicant'}>
        <Stack.Screen name="(applicant)" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'member'}>
        <Stack.Screen name="(member)" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'organisation'}>
        <Stack.Screen name="(organisation)" />
      </Stack.Protected>
    </Stack>
  );
}

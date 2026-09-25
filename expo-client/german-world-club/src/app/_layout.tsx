import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { NotificationPrompt } from '@/components/notification-prompt';
import { I18nProvider } from '@/i18n';
import { NotificationRouter } from '@/notifications/notification-router';
import { useDeviceRegistration } from '@/notifications/registration';
// Module scope, for its side effect: the foreground handler must be set before
// the first notification can arrive (feature 011, research R9).
import '@/notifications/setup';
import { RegistrationDraftProvider } from '@/session/registration-draft';
import { SessionProvider, useSession } from '@/session/session';

SplashScreen.preventAutoHideAsync();

// An unhandled JS error is written with console.error, then handed to the
// handler that was there before, so LogBox and the red screen still appear.
// Chained, never replaced: replacing it would swallow the one error display
// React Native gives a developer. `ErrorUtils` is a React Native global; the
// Expo web build has none.
if (typeof ErrorUtils !== 'undefined') {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error(isFatal ? 'RootLayout: unhandled (fatal)' : 'RootLayout: unhandled', error);
    previous(error, isFatal);
  });
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <I18nProvider>
        <SessionProvider>
          <RegistrationDraftProvider>
            <RootStack />
            {/* Beside the stack, not inside a group, so a tap is followed
                across the switch from signed-out to member (FR-011). */}
            <NotificationRouter />
            <PushRegistration />
          </RegistrationDraftProvider>
        </SessionProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

/** Asks an approved member once, then keeps this phone's registration fresh (feature 011). */
function PushRegistration() {
  const { asking, allow, notNow } = useDeviceRegistration();
  return <NotificationPrompt visible={asking} onAllow={allow} onNotNow={notNow} />;
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

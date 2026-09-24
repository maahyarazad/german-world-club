import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { PushLocale } from '@gwc/contracts/push';

import { pushApi } from '@/api/endpoints';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';
import { loadPushAsked, savePushAsked, savePushDeviceId } from '@/session/storage';

import { ensureAndroidChannel } from './setup';

/**
 * Device registration (feature 011, US1, research R9).
 *
 * Only for a signed-in **member**: an applicant is never asked, and the server
 * refuses one anyway (the device routes carry no `onboarding` flag). The app
 * asks once — an explanation first, then the OS prompt — and remembers that it
 * asked. After a "Not now", the only way back is Profile → Notifications.
 *
 * While permission is granted it registers on every cold start, whenever the
 * token rotates and whenever the member changes language, because the server
 * picks each notification's language from what the device last said.
 *
 * Nothing on web (the web face is `client/`) or on a simulator that cannot
 * receive remote pushes.
 */

export const pushSupported = Platform.OS !== 'web' && Device.isDevice;

/** Fetch the Expo token and tell the server. Returns the server's device id. */
export async function registerThisDevice(locale: PushLocale): Promise<string | null> {
  if (!pushSupported) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const device = await pushApi.devices.register({
    token,
    // The app registers Expo tokens only; Android reaches FCM through Expo (R8).
    provider: 'expo',
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    locale,
  });
  await savePushDeviceId(device.id);
  return device.id;
}

/**
 * Ask for permission with the explanation already shown. Records that the app
 * asked whatever the answer, so the member is not asked again on next launch.
 */
export async function requestAndRegister(locale: PushLocale): Promise<boolean> {
  await ensureAndroidChannel();
  const result = await Notifications.requestPermissionsAsync();
  await savePushAsked();
  if (result.granted) await registerThisDevice(locale).catch(() => null);
  return result.granted;
}

export function useDeviceRegistration() {
  const { state } = useSession();
  const { locale } = useTranslations();
  const isMember = state.status === 'member';
  const [asking, setAsking] = useState(false);
  // The listener below outlives renders; it must read the current language.
  const localeRef = useRef(locale);
  localeRef.current = locale;

  useEffect(() => {
    if (!isMember || !pushSupported) return;
    let cancelled = false;
    (async () => {
      const permission = await Notifications.getPermissionsAsync();
      if (permission.granted) {
        // Cold start, sign-in or a language change: refresh the registration.
        await registerThisDevice(locale).catch(() => null);
        return;
      }
      if (!(await loadPushAsked()) && !cancelled) setAsking(true);
    })();
    return () => { cancelled = true; };
  }, [isMember, locale]);

  useEffect(() => {
    if (!isMember || !pushSupported) return;
    // The native token rotated (reinstall, OS restore). The Expo token is
    // derived from it, so fetch that again and re-register.
    const subscription = Notifications.addPushTokenListener(() => {
      void registerThisDevice(localeRef.current).catch(() => null);
    });
    return () => subscription.remove();
  }, [isMember]);

  const allow = useCallback(async () => {
    setAsking(false);
    await requestAndRegister(localeRef.current);
  }, []);

  const notNow = useCallback(async () => {
    setAsking(false);
    await savePushAsked();
  }, []);

  return { asking: isMember && asking, allow, notNow };
}

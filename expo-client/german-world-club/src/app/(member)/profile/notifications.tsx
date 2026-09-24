import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Switch, View } from 'react-native';

import type { Device, Preferences } from '@gwc/contracts/push';

import { pushApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, FormScreen, Loading, Message } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { pushSupported, registerThisDevice, requestAndRegister } from '@/notifications/registration';
import { loadPushDeviceId } from '@/session/storage';

/**
 * Profile → Notifications (feature 011, FR-002, FR-006).
 *
 * Three switches, three different owners:
 *  - **this phone** is the device row's `enabled`, and needs the OS permission
 *    underneath it. When the OS says "never ask again", the only honest button
 *    is one that opens the system settings;
 *  - **offers** and **club news** are the member's preferences, stored on the
 *    server and applied there — a notification the member switched off is
 *    never sent, rather than sent and hidden.
 */
export default function NotificationSettings() {
  const { t, locale, problemMessage } = useTranslations();
  const [permission, setPermission] = useState<Notifications.NotificationPermissionsStatus | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [status, preferences] = await Promise.all([
        pushSupported ? Notifications.getPermissionsAsync() : Promise.resolve(null),
        pushApi.preferences.get(),
      ]);
      setPermission(status);
      setPrefs(preferences);
      const id = await loadPushDeviceId();
      const { devices } = await pushApi.devices.list();
      setDevice(devices.find((d) => d.id === id) ?? null);
    } catch (e) {
      setError(problemMessage(e));
    }
  }, [problemMessage]);

  // On focus: the member may come back from the system settings with a
  // different answer than they left with.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!prefs) return error ? <FormScreen><Message text={error} /></FormScreen> : <Loading />;

  const granted = permission?.granted === true;
  const blocked = permission !== null && !granted && !permission.canAskAgain;

  const setThisPhone = async (on: boolean) => {
    setError(null);
    try {
      if (on && !granted) {
        if (blocked) {
          await Linking.openSettings();
          return;
        }
        await requestAndRegister(locale);
        await load();
        return;
      }
      let target = device;
      if (!target && on) {
        await registerThisDevice(locale);
        await load();
        return;
      }
      if (target) setDevice(await pushApi.devices.patch(target.id, { enabled: on }));
    } catch (e) {
      setError(problemMessage(e));
    }
  };

  const setPref = async (key: keyof Preferences, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      setPrefs(await pushApi.preferences.put(next));
    } catch (e) {
      setPrefs(prefs);
      setError(problemMessage(e));
    }
  };

  const row = (label: string, hint: string | null, value: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText>{label}</ThemedText>
        {hint ? <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );

  return (
    <FormScreen>
      {pushSupported ? (
        <Card>
          {row(t.notifications.thisDevice, null, granted && (device?.enabled ?? false), setThisPhone)}
          {blocked ? (
            <View style={{ gap: Spacing.two }}>
              <ThemedText type="small" themeColor="textSecondary">{t.notifications.systemDenied}</ThemedText>
              <Button label={t.notifications.openSettings} onPress={() => void Linking.openSettings()} variant="secondary" />
            </View>
          ) : null}
        </Card>
      ) : (
        <Message text={t.notifications.unsupported} tone="info" />
      )}
      <Card>
        {row(t.notifications.offers, t.notifications.offersHint, prefs.offers, (v) => setPref('offers', v))}
        {row(t.notifications.broadcasts, t.notifications.broadcastsHint, prefs.broadcasts, (v) => setPref('broadcasts', v))}
      </Card>
      <Message text={error} />
    </FormScreen>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';

import type { MemberDevice } from '@gwc/contracts/devices';

import { ApiError } from '@/api/client';
import { devicesApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Button, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/**
 * Where you are signed in (feature 026, US2 and US3).
 *
 * The server decides which devices exist and what ending one does; this screen
 * lists them and sends the request. A refusal goes to the console, not the
 * screen (CLAUDE.md). The state kept is only what changes behaviour: whether the
 * list could not load, and which row is waiting for its confirmation.
 */
export default function Devices() {
  const themed = useThemedStyles(makeStyles);
  const { t, format, formatDate } = useTranslations();
  const { signOut } = useSession();
  const [devices, setDevices] = useState<MemberDevice[] | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices((await devicesApi.list()).devices);
      setFailed(false);
    } catch (e) {
      console.error('Devices.load', e instanceof ApiError ? e.problem : e);
      setFailed(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const end = async (device: MemberDevice) => {
    setConfirming(null);
    // Ending this phone is signing out of it. `signOut` is the one path that
    // also stops this phone's notifications and forgets the tokens.
    if (device.current) {
      await signOut();
      return;
    }
    setEnding(device.id);
    try {
      await devicesApi.end(device.id);
    } catch (e) {
      console.error('Devices.end', e instanceof ApiError ? e.problem : e);
    } finally {
      setEnding(null);
    }
    await load();
  };

  if (failed) {
    return (
      <ScrollView style={themed.clear} contentContainerStyle={styles.paddingFour}>
        <ThemedText themeColor="textSecondary">{t.devices.loadFailed}</ThemedText>
      </ScrollView>
    );
  }
  if (!devices) return <Loading />;

  return (
    <ScrollView style={themed.clear} contentContainerStyle={styles.paddingFourGapThree}>
      <ThemedText themeColor="textSecondary">{t.devices.intro}</ThemedText>
      {devices.map((device) => (
        <View key={device.id} style={styles.gapTwo}>
          <ThemedText type="smallBold">
            {device.label}{device.current ? ` · ${t.devices.thisDevice}` : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {device.kind === 'mobile' ? t.devices.kindMobile : t.devices.kindWeb}
            {' · '}
            {format(t.devices.lastActive, { when: formatDate(device.lastSeenAt, true) })}
          </ThemedText>
          {confirming === device.id ? (
            <View style={styles.rowGapTwo}>
              <Button label={t.devices.confirmEnd} onPress={() => void end(device)} variant="secondary" />
              <Button label={t.devices.cancel} onPress={() => setConfirming(null)} variant="secondary" />
            </View>
          ) : (
            <Button
              label={device.current ? t.devices.signOutHere : t.devices.signOutDevice}
              onPress={() => setConfirming(device.id)}
              loading={ending === device.id}
              variant="secondary"
            />
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  paddingFour: { padding: Spacing.four },
  paddingFourGapThree: { padding: Spacing.four, gap: Spacing.three },
  gapTwo: { gap: Spacing.two },
  rowGapTwo: { flexDirection: 'row', gap: Spacing.two },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    clear: { backgroundColor: 'transparent' },
  });

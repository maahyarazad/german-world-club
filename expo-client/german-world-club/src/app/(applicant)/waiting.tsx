import { useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AsyncButton, Button, Centered } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';
import { ApiError } from '@/api/client';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/**
 * §6.1's "Waiting for approval" screen, and its denied counterpart.
 *
 * No polling: approval is a human decision that takes hours, and the applicant
 * is emailed when it happens. "Check again" re-asks the server; an approval
 * then moves them into the app by the root guard.
 */
export default function Waiting() {
  const themed = useThemedStyles(makeStyles);
  const { t } = useTranslations();
  const { state, refreshStatus, signOut } = useSession();
  const [busy, setBusy] = useState(false);

  if (state.status !== 'applicant') return null;
  const denied = state.onboarding.step === 'denied';

  const check = async () => {
    setBusy(true);
    try {
      await refreshStatus();
    } catch (e) {
      console.error('Waiting.check', e instanceof ApiError ? e.problem : e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered>
      <View style={[styles.width64Height4Radius2, denied ? themed.bgDanger : themed.bgAccent]} />
      <ThemedText type="title" style={styles.textCenterFont28Line34}>
        {denied ? t.waiting.deniedTitle : t.waiting.title}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.textCenter}>
        {denied ? t.waiting.deniedBody : t.waiting.body}
      </ThemedText>
      {denied && state.onboarding.denialReason ? (
        <View style={styles.gapOneSelfStretch}>
          <ThemedText type="smallBold">{t.waiting.reason}</ThemedText>
          {/* Staff wrote this for the applicant; it is shown as written. */}
          <ThemedText>{state.onboarding.denialReason}</ThemedText>
        </View>
      ) : null}
      <View style={styles.selfStretchGapTwo}>
        {denied ? null : <Button label={t.waiting.check} onPress={check} loading={busy} />}
        <AsyncButton name="Waiting.signOut" label={t.common.signOut} onAction={signOut} variant="secondary" />
      </View>
    </Centered>
  );
}

const styles = StyleSheet.create({
  width64Height4Radius2: { width: 64, height: 4, borderRadius: 2 },
  textCenterFont28Line34: { textAlign: 'center', fontSize: 28, lineHeight: 34 },
  textCenter: { textAlign: 'center' },
  gapOneSelfStretch: { gap: Spacing.one, alignSelf: 'stretch' },
  selfStretchGapTwo: { alignSelf: 'stretch', gap: Spacing.two },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    bgDanger: { backgroundColor: theme.danger },
    bgAccent: { backgroundColor: theme.accent },
  });

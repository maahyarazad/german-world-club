import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Centered } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';
import { ApiError } from '@/api/client';

/**
 * §6.1's "Waiting for approval" screen, and its denied counterpart.
 *
 * No polling: approval is a human decision that takes hours, and the applicant
 * is emailed when it happens. "Check again" re-asks the server; an approval
 * then moves them into the app by the root guard.
 */
export default function Waiting() {
  const theme = useTheme();
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
      <View style={{ width: 64, height: 4, borderRadius: 2, backgroundColor: denied ? theme.danger : theme.accent }} />
      <ThemedText type="title" style={{ textAlign: 'center', fontSize: 28, lineHeight: 34 }}>
        {denied ? t.waiting.deniedTitle : t.waiting.title}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
        {denied ? t.waiting.deniedBody : t.waiting.body}
      </ThemedText>
      {denied && state.onboarding.denialReason ? (
        <View style={{ gap: Spacing.one, alignSelf: 'stretch' }}>
          <ThemedText type="smallBold">{t.waiting.reason}</ThemedText>
          {/* Staff wrote this for the applicant; it is shown as written. */}
          <ThemedText>{state.onboarding.denialReason}</ThemedText>
        </View>
      ) : null}
      <View style={{ alignSelf: 'stretch', gap: Spacing.two }}>
        {denied ? null : <Button label={t.waiting.check} onPress={check} loading={busy} />}
        <Button label={t.common.signOut} onPress={signOut} variant="secondary" />
      </View>
    </Centered>
  );
}

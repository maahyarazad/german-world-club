import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RegisterRequest } from '@gwc/contracts/onboarding';

import { onboardingApi } from '@/api/endpoints';
import { CountryPicker } from '@/components/country-picker';
import { ThemedText } from '@/components/themed-text';
import { Button, Message } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';
import { useRegistrationDraft } from '@/session/registration-draft';
import { useSession } from '@/session/session';

/**
 * Onboarding step 2 (§6.1): primary country of residence — the value Phase 2
 * profiling branches on. Choosing it submits the whole registration, and the
 * server texts the verification code.
 */
export default function Country() {
  const theme = useTheme();
  const { t, problemMessage } = useTranslations();
  const { draft, update } = useRegistrationDraft();
  const { deviceId } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // Step 1 validated every field and cannot be skipped to reach here.
      const request = { ...draft, deviceId: deviceId! } as RegisterRequest;
      const sent = await onboardingApi.register(request);
      router.replace({ pathname: '/verify-mobile', params: { challengeId: sent.challengeId, sentTo: sent.sentTo } });
    } catch (e) {
      setError(problemMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, padding: Spacing.four, gap: Spacing.three }}>
        <ThemedText type="title" style={{ fontSize: 30, lineHeight: 36 }}>{t.register.countryTitle}</ThemedText>
        <ThemedText themeColor="textSecondary">{t.register.countryHint}</ThemedText>
        <CountryPicker selected={draft.countryOfResidence} onSelect={(code) => update({ countryOfResidence: code })} />
        <Message text={error} />
        <Button label={t.register.submit} onPress={submit} loading={busy} disabled={!draft.countryOfResidence} />
      </View>
    </SafeAreaView>
  );
}

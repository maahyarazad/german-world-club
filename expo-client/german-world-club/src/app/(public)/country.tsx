import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RegisterRequest } from '@gwc/contracts/onboarding';

import { onboardingApi } from '@/api/endpoints';
import { CountryPicker, countryName } from '@/components/country-picker';
import { RESIDENCE_SHORTCUTS } from '@gwc/contracts/onboarding';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';
import { useRegistrationDraft } from '@/session/registration-draft';
import { useSession } from '@/session/session';
import { ApiError } from '@/api/client';

/**
 * Onboarding step 2 (§6.1): primary country of residence — the value Phase 2
 * profiling branches on. Choosing it submits the whole registration, and the
 * server texts the verification code.
 */
export default function Country() {
  const theme = useTheme();
  const { t, locale } = useTranslations();
  const { draft, update } = useRegistrationDraft();
  // Germany, Austria and Switzerland are one tap; "Others" opens the full list.
  const shortcut = (RESIDENCE_SHORTCUTS as readonly string[]).includes(draft.countryOfResidence ?? '');
  const [others, setOthers] = useState(Boolean(draft.countryOfResidence) && !shortcut);
  const { deviceId } = useSession();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      // Step 1 validated every field and cannot be skipped to reach here.
      const request = { ...draft, deviceId: deviceId! } as RegisterRequest;
      const sent = await onboardingApi.register(request);
      router.replace({ pathname: '/verify-mobile', params: { challengeId: sent.challengeId, sentTo: sent.sentTo } });
    } catch (e) {
      console.error('Country.submit', e instanceof ApiError ? e.problem : e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, padding: Spacing.four, gap: Spacing.three }}>
        <ThemedText type="title" style={{ fontSize: 30, lineHeight: 36 }}>{t.register.countryTitle}</ThemedText>
        <ThemedText themeColor="textSecondary">{t.register.countryHint}</ThemedText>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {RESIDENCE_SHORTCUTS.map((code) => (
            <Chip
              key={code}
              label={countryName(code, locale)}
              selected={!others && draft.countryOfResidence === code}
              onPress={() => { setOthers(false); update({ countryOfResidence: code }); }}
            />
          ))}
          <Chip
            label={t.register.countryOthers}
            selected={others}
            onPress={() => { setOthers(true); if (shortcut) update({ countryOfResidence: undefined }); }}
          />
        </View>
        {others ? (
          <CountryPicker
            selected={draft.countryOfResidence}
            exclude={RESIDENCE_SHORTCUTS}
            onSelect={(code) => update({ countryOfResidence: code })}
          />
        ) : null}
        <Button label={t.register.submit} onPress={submit} loading={busy} disabled={!draft.countryOfResidence} />
      </View>
    </SafeAreaView>
  );
}

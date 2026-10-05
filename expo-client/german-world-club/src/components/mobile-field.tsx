import { useMemo, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COUNTRIES } from '@gwc/contracts/countries';
import { DIAL_CODES, dialLabel, hasDialCode, splitE164, toE164 } from '@gwc/contracts/dial-codes';

import { ThemedText } from '@/components/themed-text';
import { Button, TextField } from '@/components/ui';
import { CountryPicker } from '@/components/country-picker';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/**
 * A mobile number as a country (its calling code) plus the number itself, so
 * nobody has to know to type `+49` first. The parent still holds one string,
 * the E.164 number the server validates — empty until a number is typed. A
 * number typed with its own `+` is international and wins over the country.
 */
export function MobileField({ value, onChange, error, hint }: {
  /** E.164 (or empty); read once, to start the picker and the field. */
  value: string;
  onChange: (e164: string) => void;
  error?: string;
  hint?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslations();
  const initial = useMemo(() => splitE164(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [country, setCountry] = useState(initial?.country ?? 'DE');
  const [national, setNational] = useState(initial ? initial.national : value);
  const [picking, setPicking] = useState(false);

  // Countries with no calling code (Antarctica…) are not offered.
  const withoutCode = useMemo(() => COUNTRIES.filter((c) => !hasDialCode(c.code)).map((c) => c.code), []);
  const emit = (nextCountry: string, nextNational: string) =>
    onChange(nextNational.trim() === '' ? '' : toE164(nextCountry, nextNational));

  return (
    <View style={{ gap: Spacing.one }}>
      <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.register.mobileCountry}
          onPress={() => setPicking(true)}
          style={{
            marginTop: Spacing.four, minHeight: 48, paddingHorizontal: Spacing.three, justifyContent: 'center',
            borderWidth: 1, borderRadius: 10, borderColor: theme.border, backgroundColor: theme.backgroundElement,
          }}>
          <ThemedText>{`${country} +${DIAL_CODES[country]}`}</ThemedText>
        </Pressable>
        <View style={{ flex: 1 }}>
          <TextField
            label={t.register.mobile}
            value={national}
            onChangeText={(v) => { setNational(v); emit(country, v); }}
            keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
            placeholder={country === 'DE' ? '151 12345678' : undefined}
            hint={hint} error={error}
          />
        </View>
      </View>
      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={{ flex: 1, padding: Spacing.four, gap: Spacing.three }}>
            <ThemedText type="title" style={{ fontSize: 30, lineHeight: 36 }}>{t.register.mobileCountry}</ThemedText>
            <CountryPicker
              selected={country}
              exclude={withoutCode}
              label={(c, l) => dialLabel(c.code, l)}
              onSelect={(code) => { setCountry(code); setPicking(false); emit(code, national); }}
            />
            <Button label={t.common.cancel} variant="secondary" onPress={() => setPicking(false)} />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

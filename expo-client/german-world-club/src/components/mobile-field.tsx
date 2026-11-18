import { useMemo, useState, type Ref } from 'react';
import { Modal, Pressable, View, type ReturnKeyTypeOptions, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COUNTRIES } from '@gwc/contracts/countries';
import { DIAL_CODES, dialLabel, hasDialCode, splitE164, toE164 } from '@gwc/contracts/dial-codes';
import { checkMobile, formatMobile } from '@gwc/contracts/mobile';

import { ThemedText } from '@/components/themed-text';
import { Button, TextField } from '@/components/ui';
import { CountryPicker } from '@/components/country-picker';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';
import { mobileErrorText } from '@/lib/mobile-text';

/**
 * A mobile number as a country (its calling code) plus the number itself, so
 * nobody has to know to type `+49` first. The parent still holds one string,
 * the E.164 number the server validates — empty until a number is typed. A
 * number typed with its own `+` is international and wins over the country.
 *
 * Feature 031: checked as it is typed with the rule the server and the web share
 * (`checkMobile`). A number typed with its own country code but no `+` is read as the
 * international number it is, the picker follows, and the field says how it was read.
 */
export function MobileField({ value, onChange, error, hint, ref, returnKeyType, onSubmitEditing }: {
  /** E.164 (or empty); read once, to start the picker and the field. */
  value: string;
  onChange: (e164: string) => void;
  error?: string;
  hint?: string;
  /** The number input itself, so a form can focus it in its chain. */
  ref?: Ref<TextInputInstance>;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
}) {
  const theme = useTheme();
  const { t, format } = useTranslations();
  const initial = useMemo(() => splitE164(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [country, setCountry] = useState(initial?.country ?? 'DE');
  const [national, setNational] = useState(initial ? initial.national : value);
  const [picking, setPicking] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const [readAs, setReadAs] = useState<string | null>(null);

  // Countries with no calling code (Antarctica…) are not offered.
  const withoutCode = useMemo(() => COUNTRIES.filter((c) => !hasDialCode(c.code)).map((c) => c.code), []);
  const emit = (nextCountry: string, nextNational: string, announce: boolean) => {
    if (nextNational.trim() === '') { onChange(''); setReadAs(null); return; }
    const check = checkMobile(nextCountry, nextNational);
    if (!check.ok) { onChange(toE164(nextCountry, nextNational)); setReadAs(null); return; }
    onChange(check.e164);
    const named = check.corrected || /^\s*(\+|00)/.test(nextNational);
    const detected = splitE164(check.e164)?.country;
    // Only while typing: a person who PICKS a country has decided.
    if (announce && named && detected && detected !== nextCountry) setCountry(detected);
    setReadAs(announce && check.corrected ? check.e164 : null);
  };
  const own = national.trim() === '' ? null : checkMobile(country, national);
  const live = own && !own.ok ? mobileErrorText(t.validation, own.reason) : undefined;
  // The parent's error (submit, or the server's refusal) wins over the live one.
  const shownError = error ?? (blurred ? live : undefined);
  const shownHint = readAs && !shownError ? format(t.register.mobileCorrected, { number: formatMobile(readAs) }) : hint;

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
            onChangeText={(v) => { setNational(v); emit(country, v, true); }}
            onBlur={() => setBlurred(true)}
            keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
            placeholder={country === 'DE' ? '151 12345678' : undefined}
            hint={shownHint} error={shownError}
            ref={ref} returnKeyType={returnKeyType} onSubmitEditing={onSubmitEditing}
            // Keep the keyboard up when the submit only moves focus on.
            submitBehavior={onSubmitEditing ? 'submit' : undefined}
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
              onSelect={(code) => { setCountry(code); setPicking(false); emit(code, national, false); }}
            />
            <Button label={t.common.cancel} variant="secondary" onPress={() => setPicking(false)} />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

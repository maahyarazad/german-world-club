import { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TextField, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';

const digits = (v: string) => v.replace(/\D/g, '');

/**
 * A date as three number fields — day, month, year — giving `YYYY-MM-DD`, or
 * '' until all three are filled. Range checks are the server's.
 *
 * Not a date picker: the app has no picker dependency, and adding a native
 * module means a new EAS build for every installed client — a poor trade for
 * an optional expiry date. Members already know the pattern from Register's
 * birthday, whose inline fields were deliberately left alone (feature 016 had
 * just changed them).
 *
 * Uncontrolled after mount: the parts initialise from `value`, and the only
 * screen using this is popped after a publish rather than reset in place.
 */
export function DatePartsField({ label, value, onChange, hint }: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  hint?: string;
}) {
  const { t } = useTranslations();
  const [initialYyyy = '', initialMm = '', initialDd = ''] = value ? value.split('-') : [];
  const [dd, setDd] = useState(initialDd);
  const [mm, setMm] = useState(initialMm);
  const [yyyy, setYyyy] = useState(initialYyyy);
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  const emit = (d: string, m: string, y: string) =>
    onChange(d && m && y.length === 4 ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '');

  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 1 }}>
          {/* The iOS number pad has no return key, so a full day or month moves on by itself. */}
          <TextField label={t.marketplace.day} value={dd} keyboardType="number-pad" maxLength={2}
            onChangeText={(v) => { const d = digits(v); setDd(d); emit(d, mm, yyyy); if (d.length === 2) monthRef.current?.focus(); }}
            returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => monthRef.current?.focus()} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField ref={monthRef} label={t.marketplace.month} value={mm} keyboardType="number-pad" maxLength={2}
            onChangeText={(v) => { const m = digits(v); setMm(m); emit(dd, m, yyyy); if (m.length === 2) yearRef.current?.focus(); }}
            returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => yearRef.current?.focus()} />
        </View>
        <View style={{ flex: 2 }}>
          <TextField ref={yearRef} label={t.marketplace.year} value={yyyy} keyboardType="number-pad" maxLength={4}
            onChangeText={(v) => { const y = digits(v); setYyyy(y); emit(dd, mm, y); }}
            returnKeyType="done" submitBehavior="blurAndSubmit" />
        </View>
      </View>
      {hint ? <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText> : null}
    </View>
  );
}

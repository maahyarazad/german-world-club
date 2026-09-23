import type { ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The handful of primitives every screen is built from. Deliberately small:
 * a form screen, a button, a field, a message, a chip, a stepper. Screens
 * compose these rather than styling raw components, so the app looks like one
 * app in both colour schemes.
 */

/** A scrollable, keyboard-aware form screen with a title. */
export function FormScreen({ title, subtitle, children }: { title?: string; subtitle?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {title ? <ThemedText type="title" style={styles.title}>{title}</ThemedText> : null}
          {subtitle ? <ThemedText themeColor="textSecondary">{subtitle}</ThemedText> : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Button({
  label, onPress, variant = 'primary', loading = false, disabled = false, style,
}: {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  loading?: boolean
  disabled?: boolean
  style?: ViewStyle
}) {
  const theme = useTheme();
  const background = variant === 'primary' ? theme.tint : variant === 'danger' ? theme.danger : theme.backgroundElement;
  const foreground = variant === 'secondary' ? theme.text : theme.onTint;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}>
      {loading
        ? <ActivityIndicator color={foreground} />
        : <Text style={[styles.buttonLabel, { color: foreground }]}>{label}</Text>}
    </Pressable>
  );
}

export function TextField({
  label, error, hint, style, ...input
}: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={label}
        style={[
          styles.input,
          { color: theme.text, borderColor: error ? theme.danger : theme.border, backgroundColor: theme.backgroundElement },
          style,
        ]}
        {...input}
      />
      {error
        ? <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>
        : hint ? <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText> : null}
    </View>
  );
}

/** A one-time code: digits only, the platform's SMS autofill where it has one. */
export function CodeField({
  label, length, value, onChangeText, error,
}: { label: string; length: number; value: string; onChangeText: (v: string) => void; error?: string | null }) {
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={(v) => onChangeText(v.replace(/\D/g, '').slice(0, length))}
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete={length === 4 ? 'sms-otp' : 'one-time-code'}
      maxLength={length}
      autoFocus
      error={error}
      style={styles.code}
    />
  );
}

/** An error or notice under a form. Announced to screen readers when it appears. */
export function Message({ text, tone = 'danger' }: { text: string | null | undefined; tone?: 'danger' | 'info' | 'success' }) {
  const theme = useTheme();
  if (!text) return null;
  const color = tone === 'danger' ? theme.danger : tone === 'success' ? theme.success : theme.text;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.message, { borderColor: color }]}>
      <ThemedText style={{ color }}>{text}</ThemedText>
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, {
        backgroundColor: selected ? theme.tint : theme.backgroundElement,
        borderColor: selected ? theme.tint : theme.border,
      }]}>
      <Text style={{ color: selected ? theme.onTint : theme.text, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

export function Stepper({
  label, value, onChange, min = 0, max,
}: { label: string; value: number; onChange: (v: number) => void; min?: number; max: number }) {
  const theme = useTheme();
  const step = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  const round = (symbol: string, delta: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${symbol}`}
      disabled={disabled}
      onPress={() => step(delta)}
      style={[styles.stepperButton, { backgroundColor: theme.backgroundElement, opacity: disabled ? 0.4 : 1 }]}>
      <Text style={{ color: theme.text, fontSize: 20 }}>{symbol}</Text>
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
      {round('−', -1, value <= min)}
      <ThemedText type="smallBold" style={styles.stepperValue}>{value}</ThemedText>
      {round('+', 1, value >= max)}
    </View>
  );
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  const theme = useTheme();
  const body = <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>{children}</View>;
  return onPress
    ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{body}</Pressable>
    : body;
}

export function Centered({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.centered, { backgroundColor: theme.background }]}>{children}</View>;
}

export function Loading() {
  return <Centered><ActivityIndicator /></Centered>;
}

export const styles = StyleSheet.create({
  form: {
    padding: Spacing.four,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  title: { fontSize: 30, lineHeight: 36 },
  button: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  field: { gap: Spacing.one },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
  },
  code: { fontSize: 28, letterSpacing: 12, textAlign: 'center' },
  message: { borderLeftWidth: 3, paddingLeft: Spacing.three, paddingVertical: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  stepperButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 24, textAlign: 'center' },
  card: { borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});

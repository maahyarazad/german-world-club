import type { ReactNode, Ref } from 'react';
import {
    KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
    type TextInputProps, type ViewStyle, type StyleProp
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { memo, useCallback, useMemo } from 'react';
import { ThemedText } from '@/components/themed-text';
import { ScreenLoader } from '@/components/screen-loader';
import { Spinner } from '@/components/spinner';
import { useAction } from '@/hooks/use-action';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The handful of primitives every screen is built from. Deliberately small:
 * a form screen, a button, a field, a message, a chip, a stepper. Screens
 * compose these rather than styling raw components, so the app looks like one
 * app in both colour schemes.
 */

/**
 * A scrollable, keyboard-aware form screen with a title.
 *
 * Both vertical edges are protected (feature 033). The profiling and applicant
 * groups hide their navigation header, so with only the bottom edge protected the
 * title was drawn under the clock and Wi-Fi indicators. The library's native
 * `SafeAreaView` measures how much THIS view overlaps the status bar and cut-out,
 * so a screen laid out below a native header gets a top inset of 0 and gains no
 * gap, and no fixed height is guessed.
 */
export function FormScreen({ title, subtitle, children, vCentered = false }: {
    title?: ReactNode;
    subtitle?: string;
    children: ReactNode;
    /** Centre the form vertically, like a sign-in page: the content sits in the middle of the space below the header. */
    vCentered?: boolean;
}) {
    const theme = useTheme();
    return (
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.background }}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={[styles.form, vCentered && styles.formCentered]} keyboardShouldPersistTaps="handled">
                    {title ? <ThemedText type="title" style={styles.title}>{title}</ThemedText> : null}
                    {subtitle ? <ThemedText themeColor="textSecondary">{subtitle}</ThemedText> : null}
                    {children}
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

type ButtonProps = {
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'danger';
    loading?: boolean;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
};

export function Button({
    label,
    onPress,
    variant = 'primary',
    loading = false,
    disabled = false,
    style,
}: ButtonProps) {
    const theme = useTheme();

    const background =
        variant === 'primary' ? theme.tint : variant === 'danger' ? theme.danger : theme.backgroundElement;
    const foreground = variant === 'secondary' ? theme.text : theme.onTint;
    const inactive = disabled || loading;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: inactive, busy: loading }}
            disabled={inactive}
            onPress={onPress}
            style={({ pressed }) => [
                styles.button,
                { backgroundColor: background, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
                style,
            ]}
        >
            <Text style={[styles.buttonLabel, { color: foreground }, loading && styles.hidden]}>
                {label}
            </Text>
            {loading && (
                <View style={[StyleSheet.absoluteFill, styles.spinnerOverlay]}>
                    <Spinner size="xs" color={foreground} />
                </View>
            )}
        </Pressable>
    );
}

/**
 * A button whose press sends a request (feature 030): it shows the loader and
 * ignores further presses until the request ends. Failures are logged under
 * `name` and swallowed (`useAction`). A screen that already has a `busy` state
 * passes `loading` to `Button` directly.
 */
export function AsyncButton({ name, onAction, ...props }: Omit<ButtonProps, 'onPress' | 'loading'> & {
    name: string;
    onAction: () => Promise<unknown>;
}) {
    const [run, pending] = useAction(name, onAction);
    return <Button {...props} loading={pending} onPress={() => void run()} />;
}

// add to your StyleSheet
// hidden: { opacity: 0 },


type TextFieldProps = TextInputProps & {
    label: string;
    error?: string | null;
    hint?: string;
    /** React 19 passes `ref` through `memo` as a plain prop; it lands on the input so a form can move focus. */
    ref?: Ref<TextInput>;
};

export const TextField = memo(function TextField({
    label,
    error,
    hint,
    style,
    ref,
    ...input
}: TextFieldProps) {
    const theme = useTheme();

    const inputStyle = useMemo(
        () => [
            styles.input,
            {
                color: theme.text,
                borderColor: error ? theme.danger : theme.border,
                backgroundColor: theme.backgroundElement,
            },
            style,
        ],
        [theme, error, style],
    );

    const message = error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
        </ThemedText>
    ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary">
            {hint}
        </ThemedText>
    ) : null;

    return (
        <View style={styles.field}>
            <ThemedText type="smallBold">{label}</ThemedText>
            <TextInput
                ref={ref}
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel={label}
                style={inputStyle}
                {...input}
            />
            {message}
        </View>
    );
});

export const CodeField = memo(function CodeField({
    label,
    length,
    value,
    onChangeText,
    error,
}: {
    label: string;
    length: number;
    value: string;
    onChangeText: (v: string) => void;
    error?: string | null;
}) {
    const handleChange = useCallback(
        (v: string) => onChangeText(v.replace(/\D/g, '').slice(0, length)),
        [onChangeText, length],
    );

    return (
        <TextField
            label={label}
            value={value}
            onChangeText={handleChange}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete={length === 4 ? 'sms-otp' : 'one-time-code'}
            maxLength={length}
            autoFocus
            error={error}
            style={styles.code}
        />
    );
});

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
    // Top edge protected like FormScreen (feature 033): a centred message on a header-less
    // screen (the profiling outcome, `waiting`) must not sit under the status bar.
    return (
        <SafeAreaView edges={['top', 'bottom']} style={[styles.centered, { backgroundColor: theme.background }]}>
            {children}
        </SafeAreaView>
    );
}

/**
 * A screen waiting for its data (feature 030): the club's loader, large and
 * centred, after a short grace period so a fast response shows no flicker. Many
 * screens already render this, so changing it here changes them all.
 */
export function Loading() {
    return <Centered><ScreenLoader flex={false} /></Centered>;
}

export const styles = StyleSheet.create({
    hidden: { opacity: 0 },
    spinnerOverlay: { alignItems: 'center', justifyContent: 'center' },
    // The one layout every form screen shares, public onboarding included: the same side
    // and bottom padding, the same gap between fields, and a larger top padding so the
    // first element never sits tight under the native header (Stepper) or the status bar.
    form: {
        paddingHorizontal: Spacing.four,
        paddingTop: Spacing.five,
        paddingBottom: Spacing.four,
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
    // Fills the screen and centres the content in the space below the header. The bottom
    // padding is a little larger than the top so the form sits where the eye expects the
    // middle (just above the geometric centre, as on Google's sign-in) — no magic margin.
    formCentered: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingTop: Spacing.four,
        paddingBottom: Spacing.six,
    },
});

import type { ReactNode, Ref } from 'react';
import {
    KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
    type TextInputProps, type ViewStyle, type StyleProp
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { memo, useCallback } from 'react';
import { ThemedText } from '@/components/themed-text';
import { ScreenLoader } from '@/components/screen-loader';
import { Spinner } from '@/components/spinner';
import { useAction } from '@/hooks/use-action';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

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
    const themed = useThemedStyles(makeStyles);
    return (
        <SafeAreaView edges={['top', 'bottom']} style={themed.flex1Clear}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex1}>
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
    const themed = useThemedStyles(makeStyles);

    const background =
        variant === 'primary' ? themed.bgPrimary : variant === 'danger' ? themed.bgDanger : themed.bgBackgroundElement;
    // The label colour is also the loader's colour, which is a prop and not a style.
    const foreground = variant === 'secondary' ? theme.text : theme.onTint;
    const labelColor = variant === 'secondary' ? themed.colorText : themed.colorOnTint;
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
                background,
                inactive ? styles.opacityInactive : pressed ? styles.opacityPressed : null,
                style,
            ]}
        >
            <Text style={[styles.buttonLabel, labelColor, loading && styles.hidden]}>
                {label}
            </Text>
            {loading && (
                <View style={[StyleSheet.absoluteFill, styles.spinnerOverlay]}>
                    <Spinner size="sm" color={foreground} />
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
    const themed = useThemedStyles(makeStyles);
    const theme = useTheme();

    const inputStyle = [styles.input, themed.input, error ? themed.borderDanger : themed.borderDefault, style];

    const message = error ? (
        <ThemedText type="small" style={themed.colorDanger}>
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
    const themed = useThemedStyles(makeStyles);
    if (!text) return null;
    const border = tone === 'danger' ? themed.borderDanger : tone === 'success' ? themed.borderSuccess : themed.borderText;
    const color = tone === 'danger' ? themed.colorDanger : tone === 'success' ? themed.colorSuccess : themed.colorText;
    return (
        <View accessibilityLiveRegion="polite" style={[styles.message, border]}>
            <ThemedText style={color}>{text}</ThemedText>
        </View>
    );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
    const themed = useThemedStyles(makeStyles);
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={onPress}
            style={[styles.chip, selected ? themed.chipSelected : themed.chipIdle]}>
            <Text style={[styles.weight500, selected ? themed.colorOnTint : themed.colorText]}>{label}</Text>
        </Pressable>
    );
}

export function Stepper({
    label, value, onChange, min = 0, max,
}: { label: string; value: number; onChange: (v: number) => void; min?: number; max: number }) {
    const themed = useThemedStyles(makeStyles);
    const step = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
    const round = (symbol: string, delta: number, disabled: boolean) => (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label} ${symbol}`}
            disabled={disabled}
            onPress={() => step(delta)}
            style={[styles.stepperButton, themed.bgBackgroundElement, disabled && styles.opacityDisabled]}>
            <Text style={themed.colorTextFont20}>{symbol}</Text>
        </Pressable>
    );
    return (
        <View style={styles.stepper}>
            <ThemedText style={styles.flex1}>{label}</ThemedText>
            {round('−', -1, value <= min)}
            <ThemedText type="smallBold" style={styles.stepperValue}>{value}</ThemedText>
            {round('+', 1, value >= max)}
        </View>
    );
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
    const themed = useThemedStyles(makeStyles);
    const body = <View style={[styles.card, themed.bgBackgroundElement]}>{children}</View>;
    return onPress
        ? <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.opacityPressed : null)}>{body}</Pressable>
        : body;
}

export function Centered({ children }: { children: ReactNode }) {
    const themed = useThemedStyles(makeStyles);
    // Top edge protected like FormScreen (feature 033): a centred message on a header-less
    // screen (the profiling outcome, `waiting`) must not sit under the status bar.
    return (
        <SafeAreaView edges={['top', 'bottom']} style={[styles.centered, themed.clear]}>
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
    opacityInactive: { opacity: 0.5 },
    opacityPressed: { opacity: 0.85 },
    opacityDisabled: { opacity: 0.4 },
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
    flex1: { flex: 1 },
    weight500: { fontWeight: '500' },
});

const makeStyles = (theme: AppTheme) =>
    StyleSheet.create({
        flex1Clear: { flex: 1, backgroundColor: 'transparent' },
        colorDanger: { color: theme.danger },
        bgBackgroundElement: { backgroundColor: theme.backgroundElement },
        colorTextFont20: { color: theme.text, fontSize: 20 },
        clear: { backgroundColor: 'transparent' },
        bgPrimary: { backgroundColor: theme.primary },
        bgDanger: { backgroundColor: theme.danger },
        colorText: { color: theme.text },
        colorOnTint: { color: theme.onTint },
        colorSuccess: { color: theme.success },
        borderDanger: { borderColor: theme.danger },
        borderSuccess: { borderColor: theme.success },
        borderText: { borderColor: theme.text },
        borderDefault: { borderColor: theme.border },
        input: { color: theme.text, backgroundColor: theme.backgroundElement },
        chipSelected: { backgroundColor: theme.tint, borderColor: theme.tint },
        chipIdle: { backgroundColor: theme.backgroundElement, borderColor: theme.border },
    });
